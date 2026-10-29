// Feature & module management against the test database: defaults, activation (admin only, audit,
// log), enforcement on the server (actions, API routes, permissions, warehouses, expiry), data kept
// while a feature is off, Multi User, and backup of the choices.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const req = vi.hoisted(() => ({ headers: new Headers(), cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  headers: async () => req.headers,
  cookies: async () => ({
    get: (name: string) => (req.cookies.has(name) ? { name, value: req.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void req.cookies.set(name, value),
    delete: (name: string) => void req.cookies.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hasPermission, RICE_MILL_PERMISSIONS } from "@/lib/permissions";
import { SESSION_COOKIE, createSessionToken } from "@/lib/session";
import { registerAction } from "@/server/actions/auth";
import { saveCatalogAction } from "@/server/actions/masters";
import { calculatePayrollAction } from "@/server/actions/payroll";
import { saveVoucherAction } from "@/server/actions/vouchers";
import { writeOffExpiredAction } from "@/server/actions/expiry";
import { BUSINESS_COOKIE, getContext } from "@/server/auth";
import { FEATURES, type FeatureDef } from "@/lib/features";
import { setFeatureOverride } from "@/server/services/platform-admin";
import { exportBusiness, restoreBackup } from "@/server/services/backup";
import { saveProduct } from "@/server/services/master";
import { ensurePayrollSetup, saveEmployee } from "@/server/services/payroll";
import { systemAccounts } from "@/server/services/accounting";
import { createSession } from "@/server/services/sessions";
import { loadEnabledFeatures } from "@/server/services/feature-state";
import { GET as lookupGet } from "@/app/api/lookup/[kind]/route";
import { GET as reportGet } from "@/app/api/reports/[slug]/route";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const PASSWORD = "Dokan-2026x";
let n = 0;
const freshMobile = () => `015${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}${String(++n % 100).padStart(2, "0")}`;
const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.append(k, v);
  return fd;
};
async function call(fn: () => Promise<unknown>) {
  try {
    return { value: await fn(), redirect: null as string | null };
  } catch (e) {
    if ((e as Error).message === "NEXT_REDIRECT") return { value: null, redirect: (e as { url: string }).url };
    throw e;
  }
}
async function newBusiness(name: string) {
  const prev = process.env.REGISTRATION_OTP;
  process.env.REGISTRATION_OTP = "false";
  req.cookies.clear();
  await call(() => registerAction(null, form({ businessName: name, ownerName: "মালিক", mobile: freshMobile(), email: "", password: PASSWORD, confirmPassword: PASSWORD })));
  if (prev === undefined) delete process.env.REGISTRATION_OTP;
  else process.env.REGISTRATION_OTP = prev;
  const ctx = (await getContext())!;
  return { ctx, cookies: new Map(req.cookies) };
}
async function member(businessId: string, roleName: string) {
  const role = await prisma.role.findFirstOrThrow({ where: { businessId, name: roleName } });
  const user = await prisma.user.create({ data: { name: roleName, mobile: freshMobile(), passwordHash: "x" } });
  await prisma.membership.create({ data: { userId: user.id, businessId, roleId: role.id } });
  const s = await createSession(prisma, user.id);
  return new Map([[SESSION_COOKIE, await createSessionToken(user.id, s.id)], [BUSINESS_COOKIE, businessId]]);
}
/** Modules are switched by the platform administrator (per-company override); companies no longer switch them. */
let adminUserId = "";
const toggle = (businessId: string, key: string, enabled: boolean) => setFeatureOverride(businessId, key, enabled ? null : false, adminUserId);
const ctxNow = async () => (await getContext())!;
const exportReport = async (slug: string) => (await reportGet(new NextRequest(`http://localhost/api/reports/${slug}`), { params: Promise.resolve({ slug }) })).status;

run("feature management", () => {
  let A: Awaited<ReturnType<typeof newBusiness>>;
  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret-for-vitest-only-0123456789abcdef";
    process.env.REGISTRATION_HOURLY_LIMIT = "100000";
    A = await newBusiness("ফিচার টেস্ট স্টোর");
    adminUserId = (await prisma.user.create({ data: { name: "প্ল্যাটফর্ম", mobile: freshMobile(), passwordHash: "x", isSuperAdmin: true } })).id;
  });
  beforeEach(() => {
    req.cookies = new Map(A.cookies);
  });

  it("defaults: every available module is on, coming-soon modules are off; catalogue synced with permissions", async () => {
    const defs = FEATURES as readonly FeatureDef[];
    expect(defs.length).toBe(20);
    const on = await loadEnabledFeatures(A.ctx.business.id);
    expect(defs.filter((f) => f.status === "AVAILABLE").every((f) => on.has(f.key as never))).toBe(true);
    expect(defs.filter((f) => f.status === "COMING_SOON").every((f) => !on.has(f.key as never))).toBe(true);
    const owned = await prisma.featurePermission.findMany({ where: { featureKey: "HRM", owned: true }, select: { permission: true } });
    expect(new Set(owned.map((o) => o.permission)).size).toBe(5); // one row per action, five distinct payroll permissions
    const ctx = await ctxNow();
    expect(ctx.features).toEqual(expect.arrayContaining(["HRM", "PRODUCT_EXPIRY", "MULTI_USER", "MULTI_WAREHOUSE"]));
    // no feature blocks; only the rice-mill keys, refused outside a rice-mill business
    expect(ctx.permissions.filter((p) => p.startsWith("!")).map((p) => p.slice(1))).toEqual(RICE_MILL_PERMISSIONS);
  });

  it("HRM off: payroll permissions refused everywhere (actions, API), data kept; on again restores access", async () => {
    const biz = A.ctx.business.id;
    await ensurePayrollSetup(biz);
    await saveEmployee(A.ctx.svc, { code: null, name: "ফিচার কর্মী", mobile: null, email: null, address: null, nid: null, tin: null, departmentId: null, designation: null, joiningDate: new Date("2026-01-01"), exitDate: null, status: "ACTIVE", basicSalary: 10000, overtimeEligible: true, overtimeRate: null, paymentMethod: null, bankName: null, bankAccountNo: null, notes: null, components: [], revisionNote: null, effectiveFrom: null });
    const employees = await prisma.employee.count({ where: { businessId: biz } });
    expect(employees).toBeGreaterThan(0);

    await toggle(biz, "HRM", false);
    const ctx = await ctxNow();
    expect(ctx.features).not.toContain("HRM");
    expect(ctx.permissions).toContain("!payroll:view");
    expect(hasPermission(ctx.permissions, "payroll:view")).toBe(false);
    expect(hasPermission(ctx.permissions, "sales:view")).toBe(true); // nothing else affected
    expect((await calculatePayrollAction(null, form({ period: "2026-09", kind: "REGULAR", postingDate: "2026-09-30" })))?.ok).toBe(false);
    expect((await lookupGet(new Request("http://localhost/api/lookup/employees?q=a"), { params: Promise.resolve({ kind: "employees" }) })).status).toBe(403);
    expect(await exportReport("payroll-monthly")).toBe(403);
    expect(await prisma.employee.count({ where: { businessId: biz } })).toBe(employees); // data kept

    await toggle(biz, "HRM", true);
    expect(hasPermission((await ctxNow()).permissions, "payroll:view")).toBe(true);
    expect((await lookupGet(new Request("http://localhost/api/lookup/employees?q=a"), { params: Promise.resolve({ kind: "employees" }) })).status).toBe(200);
  });

  it("companies no longer switch modules: a stored company choice is ignored, the plan and the platform administrator decide", async () => {
    const biz = A.ctx.business.id;
    await prisma.businessFeature.upsert({
      where: { businessId_featureKey: { businessId: biz, featureKey: "HRM" } },
      create: { businessId: biz, featureKey: "HRM", enabled: false, changedById: A.ctx.user.id },
      update: { enabled: false },
    });
    expect((await loadEnabledFeatures(biz)).has("HRM")).toBe(true); // former "off" choice not applied
    expect(hasPermission((await ctxNow()).permissions, "payroll:view")).toBe(true);
    await toggle(biz, "MEMO_ENTRY", true); // a coming-soon module never turns on
    expect((await loadEnabledFeatures(biz)).has("MEMO_ENTRY")).toBe(false);
    await expect(toggle(biz, "NOPE", false)).rejects.toThrow(/পাওয়া যায়নি/);
  });

  it("Advanced Reporting off: its report exports refused, core books unaffected", async () => {
    await toggle(A.ctx.business.id, "ADVANCED_REPORTING", false);
    expect(await exportReport("cash-flow")).toBe(403);
    expect(await exportReport("stock-valuation")).toBe(403);
    expect(await exportReport("trial-balance")).toBe(200);
    expect(await exportReport("ledger")).toBe(200);
    await toggle(A.ctx.business.id, "ADVANCED_REPORTING", true);
    expect(await exportReport("cash-flow")).toBe(200);
  });

  it("Multi Warehouse off: no warehouse management; new vouchers go to the main warehouse", async () => {
    const biz = A.ctx.business.id;
    const ok = await call(() => saveCatalogAction("warehouse", null, null, form({ name: "দ্বিতীয় গুদাম", address: "" })));
    expect(ok.redirect ?? (ok.value as { ok: boolean })?.ok).toBeTruthy();
    const second = await prisma.warehouse.findFirstOrThrow({ where: { businessId: biz, name: "দ্বিতীয় গুদাম" } });
    const main = await prisma.warehouse.findFirstOrThrow({ where: { businessId: biz, isDefault: true } });
    const unit = await prisma.unit.findFirstOrThrow({ where: { businessId: biz, name: "পিস" } });
    const product = await saveProduct(A.ctx.svc, { name: "ফিচার পণ্য", code: `FP-${n}`, barcode: null, categoryId: null, brandId: null, unitId: unit.id, purchasePrice: 10, salePrice: 12, wholesalePrice: 0, minStock: 0, openingStock: 0, openingRate: 0, trackBatch: false });
    const cash = (await prisma.$transaction((tx) => systemAccounts(tx, biz))).CASH;

    await toggle(biz, "MULTI_WAREHOUSE", false);
    const refused = await call(() => saveCatalogAction("warehouse", null, null, form({ name: "তৃতীয় গুদাম", address: "" })));
    expect((refused.value as { ok: boolean; message: string }).message).toMatch(/প্ল্যানে নেই/);
    const purchase = { date: "2026-10-01", reference: null, narration: null, partyAccountId: null, warehouseId: second.id, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0, payments: [{ accountId: cash, amount: 50, reference: null }], items: [{ productId: product, unitId: null, quantity: 5, rate: 10, discount: 0 }] };
    const saved = await call(() => saveVoucherAction("PURCHASE", null, null, form({ payload: JSON.stringify(purchase) })));
    expect(saved.redirect).toMatch(/\/vouchers\/v\//);
    const v = await prisma.voucher.findFirstOrThrow({ where: { businessId: biz, type: "PURCHASE" }, orderBy: { createdAt: "desc" } });
    expect(v.warehouseId).toBe(main.id); // the chosen second warehouse was ignored
    expect(await prisma.warehouse.count({ where: { businessId: biz } })).toBe(2); // nothing deleted

    await toggle(biz, "MULTI_WAREHOUSE", true);
    await call(() => saveVoucherAction("PURCHASE", null, null, form({ payload: JSON.stringify(purchase) })));
    const v2 = await prisma.voucher.findFirstOrThrow({ where: { businessId: biz, type: "PURCHASE" }, orderBy: { createdAt: "desc" } });
    expect(v2.warehouseId).toBe(second.id);
  });

  it("Product Expiry off: write-off refused and expiry reports closed; on again restores", async () => {
    await toggle(A.ctx.business.id, "PRODUCT_EXPIRY", false);
    const r = await writeOffExpiredAction(null, form({ batchId: "x" }));
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/মেয়াদ/);
    expect(await exportReport("expiry-value")).toBe(403);
    await toggle(A.ctx.business.id, "PRODUCT_EXPIRY", true);
    expect(await exportReport("expiry-value")).toBe(200);
  });

  it("Multi User off (platform administrator): only the owner gets in, user management closed; members kept", async () => {
    const biz = A.ctx.business.id;
    const sales = await member(biz, "বিক্রয়কর্মী (Salesperson)");
    await toggle(biz, "MULTI_USER", false);
    req.cookies = new Map(A.cookies);
    const owner = await ctxNow();
    expect(hasPermission(owner.permissions, "sales:create")).toBe(true);
    expect(hasPermission(owner.permissions, "users:manage")).toBe(false);
    req.cookies = sales;
    expect((await ctxNow()).permissions).toEqual([]);
    expect(await prisma.membership.count({ where: { businessId: biz } })).toBeGreaterThanOrEqual(2); // members kept
    await toggle(biz, "MULTI_USER", true);
    expect(hasPermission((await ctxNow()).permissions, "sales:create")).toBe(true);
  });

  it("backups still restore; the restored business gets the modules of its plan", async () => {
    const biz = A.ctx.business.id;
    const file = JSON.parse(JSON.stringify(await exportBusiness(biz)));
    const { businessId } = await restoreBackup(file, A.ctx.user.id);
    const on = await loadEnabledFeatures(businessId);
    expect(on.has("HRM")).toBe(true);
    expect(on.has("ADVANCED_CUSTOMER")).toBe(true);
  });
});
