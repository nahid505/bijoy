// Self-service registration end-to-end through the real server actions (Next's request headers /
// cookies are replaced by an in-memory stand-in), against the test database.
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

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/session";
import defaults from "@/lib/business-defaults.json";
import { loginAction, registerAction } from "@/server/actions/auth";
import { BUSINESS_COOKIE, getContext, getCurrentUser } from "@/server/auth";
import { systemAccounts } from "@/server/services/accounting";
import { saveParty, saveProduct } from "@/server/services/master";
import { saveTradeVoucher } from "@/server/services/voucher";
import { trialBalance } from "@/server/services/report";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const PASSWORD = "Dokan-2026x";

let n = 0;
/** unique, valid Bangladeshi mobile for each test (01[3-9] + 8 digits) */
const freshMobile = () => `019${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}${String(++n % 100).padStart(2, "0")}`;

type Result = { ok: true; redirectTo: string } | { ok: false; message: string; errors?: Record<string, string[]> };
async function register(fields: Partial<Record<string, string>>, xff?: string): Promise<Result> {
  req.headers = new Headers({ "user-agent": "vitest", ...(xff ? { "x-forwarded-for": xff } : {}) });
  const fd = new FormData();
  const all = { businessName: "নতুন দোকান", ownerName: "করিম মিয়া", mobile: freshMobile(), email: "", password: PASSWORD, confirmPassword: PASSWORD, ...fields };
  for (const [k, v] of Object.entries(all)) if (v !== undefined) fd.set(k, v);
  try {
    const r = await registerAction(null, fd);
    return { ok: false, message: r?.message ?? "", errors: r?.errors };
  } catch (e) {
    if ((e as Error).message === "NEXT_REDIRECT") return { ok: true, redirectTo: (e as { url: string }).url };
    throw e;
  }
}
async function login(identifier: string, password: string) {
  req.headers = new Headers({ "user-agent": "vitest" });
  const fd = new FormData();
  fd.set("email", identifier);
  fd.set("password", password);
  fd.set("next", "/dashboard");
  try {
    const r = await loginAction(null, fd);
    return { ok: false, message: r?.message ?? "" };
  } catch (e) {
    if ((e as Error).message === "NEXT_REDIRECT") return { ok: true, message: "" };
    throw e;
  }
}

run("self-service registration", () => {
  beforeAll(() => {
    process.env.AUTH_SECRET ??= "test-secret-for-vitest-only-0123456789abcdef";
  });
  beforeEach(() => {
    req.cookies.clear();
    delete process.env.TRUSTED_PROXY_HOPS;
    process.env.REGISTRATION_HOURLY_LIMIT = "100000"; // the site-wide ceiling has its own test
  });

  it("valid registration creates the owner, an isolated business with full defaults, and signs in", async () => {
    const mobile = freshMobile();
    const email = `Karim${Date.now()}@Example.com`;
    const r = await register({ businessName: "করিম ট্রেডার্স", ownerName: "করিম", mobile: `+88${mobile}`, email });
    expect(r).toEqual({ ok: true, redirectTo: "/dashboard" });

    // user: hashed password, normalised identifiers
    const user = await prisma.user.findUniqueOrThrow({ where: { mobile } });
    expect(user.email).toBe(email.toLowerCase());
    expect(user.passwordHash).not.toContain(PASSWORD);
    expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/); // bcrypt, cost 12
    expect(await bcrypt.compare(PASSWORD, user.passwordHash)).toBe(true);

    // business with the owner role
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: user.id }, include: { role: true, business: true } });
    expect(m.business.name).toBe("করিম ট্রেডার্স");
    expect(m.business.mobile).toBe(mobile);
    expect(m.role.permissions).toEqual(["*"]);
    expect(m.role.isSystem).toBe(true);
    const businessId = m.businessId;

    // default chart of accounts, system ledgers, units, warehouse, roles, settings
    expect(await prisma.accountGroup.count({ where: { businessId } })).toBe(defaults.groups.length);
    expect(await prisma.account.count({ where: { businessId } })).toBe(defaults.accounts.length);
    const sys = await prisma.$transaction((tx) => systemAccounts(tx, businessId));
    expect(Object.values(sys).every(Boolean)).toBe(true);
    expect(await prisma.account.count({ where: { businessId, systemKey: "EXPIRY_LOSS" } })).toBe(1);
    expect(await prisma.unit.count({ where: { businessId } })).toBe(defaults.units.length);
    expect(await prisma.warehouse.count({ where: { businessId, isDefault: true } })).toBe(1);
    expect(await prisma.role.count({ where: { businessId } })).toBe(defaults.roles.length);
    expect(m.business.fiscalYearStartMonth).toBe(7);
    expect(m.business.currencySymbol).toBe("৳");
    expect(m.business.expiryWarningDays).toEqual([60, 30, 15, 7]);
    expect(m.business.allowExpiredSale).toBe(false);
    const tb = await trialBalance(businessId, {});
    expect(tb.balanced).toBe(true);
    expect(tb.totals.debit).toBe(0); // brand-new books

    // signed in, working in the new business
    expect(req.cookies.get(BUSINESS_COOKIE)).toBe(businessId);
    expect((await getCurrentUser())?.id).toBe(user.id);
    expect((await getContext())?.business.id).toBe(businessId);
    expect(await prisma.auditLog.count({ where: { businessId, entity: "Registration" } })).toBe(1);
  });

  it("refuses a duplicate mobile number in any format, and a duplicate e-mail", async () => {
    const mobile = freshMobile();
    expect((await register({ mobile })).ok).toBe(true);
    req.cookies.clear();
    for (const variant of [mobile, `+88${mobile}`, `${mobile.slice(0, 5)}-${mobile.slice(5)}`]) {
      const dup = await register({ mobile: variant });
      expect(dup.ok).toBe(false);
      expect(dup.ok ? "" : dup.message).toContain("এই মোবাইল নম্বর দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে");
    }
    expect(await prisma.user.count({ where: { mobile } })).toBe(1);

    const email = `dup${Date.now()}@example.com`;
    expect((await register({ email })).ok).toBe(true);
    req.cookies.clear();
    const dupMail = await register({ email: email.toUpperCase() });
    expect(dupMail.ok ? "" : dupMail.message).toContain("ইমেইল দিয়ে আগেই");
  });

  it("is race-safe: two simultaneous sign-ups with the same mobile create one account", async () => {
    const mobile = freshMobile();
    const results = await Promise.all([register({ mobile }), register({ mobile })]);
    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(await prisma.user.count({ where: { mobile } })).toBe(1);
    expect(await prisma.business.count({ where: { mobile } })).toBe(1); // the losing transaction left no business behind
  });

  it("rejects invalid mobile, weak password and password mismatch with Bangla messages — nothing is created", async () => {
    const before = await prisma.user.count();
    const bad = await register({ mobile: "12345" });
    expect(bad.ok ? {} : bad.errors?.mobile?.[0]).toContain("সঠিক মোবাইল নম্বর");
    const weak = await register({ password: "abc", confirmPassword: "abc" });
    expect(weak.ok ? {} : weak.errors?.password?.[0]).toContain("৮ অক্ষর");
    const common = await register({ password: "password123", confirmPassword: "password123" });
    expect(common.ok ? {} : common.errors?.password?.[0]).toContain("সহজ");
    const mismatch = await register({ confirmPassword: "Dokan-2026y" });
    expect(mismatch.ok ? {} : mismatch.errors?.confirmPassword?.[0]).toBe("পাসওয়ার্ড দুটি মিলছে না");
    const noMobile = await register({ mobile: "" });
    expect(noMobile.ok ? {} : noMobile.errors?.mobile?.[0]).toBe("মোবাইল নম্বর আবশ্যক");
    expect(await prisma.user.count()).toBe(before);
  });

  it("refuses bots that fill the hidden honeypot field", async () => {
    const mobile = freshMobile();
    const r = await register({ mobile, website: "http://spam.example" });
    expect(r.ok).toBe(false);
    expect(await prisma.user.count({ where: { mobile } })).toBe(0);
  });

  it("the new owner can log in with the mobile (any format) or e-mail; a wrong password fails", async () => {
    const mobile = freshMobile();
    const email = `login${Date.now()}@example.com`;
    expect((await register({ mobile, email })).ok).toBe(true);
    for (const id of [mobile, `+88${mobile}`, email.toUpperCase()]) {
      req.cookies.clear();
      expect((await login(id, PASSWORD)).ok).toBe(true);
      expect((await getCurrentUser())?.mobile).toBe(mobile);
    }
    req.cookies.clear();
    expect((await login(mobile, "Wrong-pass-1")).message).toBe("মোবাইল/ইমেইল বা পাসওয়ার্ড সঠিক নয়");
  });

  it("switching between e-mail and mobile does not double the allowed login attempts", async () => {
    const mobile = freshMobile();
    const email = `switch${Date.now()}@example.com`;
    expect((await register({ mobile, email })).ok).toBe(true);
    req.cookies.clear();
    for (let i = 0; i < 5; i++) await login(i % 2 ? mobile : email, `Wrong-${i}x`);
    expect((await login(email, PASSWORD)).message).toContain("অনেকবার");
    expect((await login(mobile, PASSWORD)).message).toContain("অনেকবার");
  });

  it("new businesses are fully isolated from each other and from existing ones", async () => {
    const a = freshMobile();
    const b = freshMobile();
    expect((await register({ mobile: a, businessName: "ব্যবসা ক" })).ok).toBe(true);
    const ctxA = (await getContext())!;
    req.cookies.clear();
    expect((await register({ mobile: b, businessName: "ব্যবসা খ" })).ok).toBe(true);
    const ctxB = (await getContext())!;
    expect(ctxA.business.id).not.toBe(ctxB.business.id);

    // data created in A
    const unitA = await prisma.unit.findFirstOrThrow({ where: { businessId: ctxA.business.id, name: "পিস" } });
    const productA = await saveProduct(ctxA.svc, { name: "গোপন পণ্য", code: "SECRET", barcode: null, categoryId: null, brandId: null, unitId: unitA.id, purchasePrice: 10, salePrice: 12, wholesalePrice: 0, minStock: 0, openingStock: 5, openingRate: 10, trackBatch: false });
    const custA = await saveParty(ctxA.svc, "CUSTOMER", { name: "ক এর কাস্টমার", mobile: null, email: null, address: null, notes: null, openingBalance: 100, creditLimit: 0, creditDays: 0 });

    // B sees none of it and cannot use it
    expect(ctxB.businesses.map((x) => x.id)).toEqual([ctxB.business.id]);
    for (const model of ["customer", "supplier", "product", "voucher", "journalEntry", "stockMovement"] as const) {
      expect(await (prisma[model] as unknown as { count: (a: unknown) => Promise<number> }).count({ where: { businessId: ctxB.business.id } })).toBe(0);
    }
    const sysB = await prisma.$transaction((tx) => systemAccounts(tx, ctxB.business.id));
    await expect(
      saveTradeVoucher(ctxB.svc, "SALES", {
        date: new Date(), reference: null, narration: null, partyAccountId: custA.accountId, warehouseId: null, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0,
        payments: [{ accountId: sysB.CASH, amount: 12, reference: null }], items: [{ productId: productA, quantity: 1, rate: 12, unitId: null, discount: 0, batchNo: null, expiryDate: null, mfgDate: null }],
      }),
    ).rejects.toThrow(/পাওয়া যায়নি/);
    expect((await trialBalance(ctxB.business.id, {})).totals.debit).toBe(0);

    // B forging A's business cookie still works in B only (membership is checked)
    req.cookies.set(BUSINESS_COOKIE, ctxA.business.id);
    expect((await getContext())?.business.id).toBe(ctxB.business.id);

    // and the new owner has no access to any pre-existing business
    const userB = await prisma.user.findUniqueOrThrow({ where: { mobile: b } });
    expect(await prisma.membership.count({ where: { userId: userB.id } })).toBe(1);
  });

  it("an unauthenticated request has no user or business context", async () => {
    req.cookies.clear();
    expect(await getCurrentUser()).toBeNull();
    expect(await getContext()).toBeNull();
    req.cookies.set(SESSION_COOKIE, "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4Iiwic2lkIjoieCJ9.forged");
    expect(await getCurrentUser()).toBeNull();
  });

  it("rate limits sign-ups: per client address (behind a trusted proxy), per mobile, and site-wide", async () => {
    // per address: 5 per hour, rightmost (proxy-appended) address counts, spoofed left part ignored
    process.env.TRUSTED_PROXY_HOPS = "1";
    const ip = `198.18.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`; // random: throttle rows outlive a run
    for (let i = 0; i < 5; i++) {
      req.cookies.clear();
      expect((await register({}, `10.0.0.${i}, ${ip}`)).ok).toBe(true);
    }
    req.cookies.clear();
    const blocked = await register({}, `10.9.9.9, ${ip}`);
    expect(blocked.ok ? "" : blocked.message).toContain("অনেকবার অ্যাকাউন্ট তৈরির চেষ্টা");
    delete process.env.TRUSTED_PROXY_HOPS;

    // per mobile: hammering one number with valid submissions is cut off after 5 tries
    // (submissions that fail validation never reach the database and are not counted)
    const mobile = freshMobile();
    expect((await register({ mobile })).ok).toBe(true);
    for (let i = 0; i < 4; i++) {
      req.cookies.clear();
      expect(JSON.stringify(await register({ mobile }))).toContain("আগেই অ্যাকাউন্ট");
    }
    req.cookies.clear();
    const hammered = await register({ mobile });
    expect(hammered.ok ? "" : hammered.message).toContain("অনেকবার");

    // site-wide ceiling holds even when the client address is unknown / spoofed
    await prisma.authThrottle.deleteMany({ where: { key: "register:site" } });
    process.env.REGISTRATION_HOURLY_LIMIT = "3";
    for (let i = 0; i < 3; i++) {
      req.cookies.clear();
      expect((await register({}, `198.51.100.${i}`)).ok).toBe(true);
    }
    req.cookies.clear();
    const ceiling = await register({}, "192.0.2.77");
    expect(ceiling.ok ? "" : ceiling.message).toContain("অনেকবার");
    await prisma.authThrottle.deleteMany({ where: { key: "register:site" } });
  });

  it("registration can be switched off", async () => {
    process.env.REGISTRATION_ENABLED = "false";
    const r = await register({});
    delete process.env.REGISTRATION_ENABLED;
    expect(r.ok ? "" : r.message).toContain("বন্ধ");
  });
});
