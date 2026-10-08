// Multi-tenant SaaS against the test database: registration trial, plan entitlements, expiry with
// grace and fallback, suspension, checkout → gateway webhook → activation + invoice (idempotent,
// signature- and amount-checked), manual payments, user limits, super admin authorisation, plan CRUD,
// tenant isolation and reminder de-duplication. Global platform settings are never changed here.
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
import { hasPermission } from "@/lib/permissions";
import { addDays, startOfDay } from "@/lib/subscription";
import { SESSION_COOKIE, createSessionToken } from "@/lib/session";
import { registerAction } from "@/server/actions/auth";
import { adminApprovePaymentAction, adminRefundPaymentAction, adminChangePlanAction, adminDeletePlanAction, adminExtendAction, adminFeatureOverrideAction, adminRejectPaymentAction, adminSavePlanAction, adminSuspendAction } from "@/server/actions/admin";
import { setFeatureAction } from "@/server/actions/features";
import { BUSINESS_COOKIE, getContext } from "@/server/auth";
import { processProviderResult, startCheckout, submitManualReference } from "@/server/billing/checkout";
import { mockSignature } from "@/server/billing/providers";
import { requireSuperAdmin } from "@/server/super-admin";
import { createSession } from "@/server/services/sessions";
import { assertUserSlot, subscriptionDailyCheck, userUsage } from "@/server/services/subscriptions";
import { companyList, revenueReport } from "@/server/services/platform-admin";
import { POST as webhook } from "@/app/api/billing/webhook/[provider]/route";
import { jsonKey } from "@/lib/dialect";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const PASSWORD = "Dokan-2026x";
let n = 0;
const freshMobile = () => `016${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}${String(++n % 100).padStart(2, "0")}`;
const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.append(k, v);
  return fd;
};
async function call<T>(fn: () => Promise<T>) {
  try {
    return { value: await fn(), redirect: null as string | null };
  } catch (e) {
    if ((e as Error).message === "NEXT_REDIRECT") return { value: null, redirect: (e as { url: string }).url };
    throw e;
  }
}
async function newBusiness(name: string, extra: Record<string, string> = {}) {
  process.env.REGISTRATION_OTP = "false";
  req.cookies.clear();
  const r = await call(() => registerAction(null, form({ businessName: name, ownerName: "মালিক", mobile: freshMobile(), email: "", password: PASSWORD, confirmPassword: PASSWORD, ...extra })));
  expect(r.redirect).toBe("/dashboard");
  const ctx = (await getContext())!;
  return { ctx, id: ctx.business.id, cookies: new Map(req.cookies) };
}
async function sessionFor(userId: string, businessId?: string) {
  const s = await createSession(prisma, userId);
  const m = new Map([[SESSION_COOKIE, await createSessionToken(userId, s.id)]]);
  if (businessId) m.set(BUSINESS_COOKIE, businessId);
  return m;
}
const sub = (businessId: string) => prisma.subscription.findUniqueOrThrow({ where: { businessId }, include: { plan: true } });
const planId = async (code: string) => (await prisma.plan.findUniqueOrThrow({ where: { code } })).id;
const ctxNow = async () => (await getContext())!;
const mockWebhook = (fields: { txn: string; outcome: string; trx: string; amount: string }, sig = mockSignature(fields)) =>
  webhook(new NextRequest("http://localhost/api/billing/webhook/mock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...fields, sig }) }), { params: Promise.resolve({ provider: "mock" }) });

run("SaaS subscriptions & billing", () => {
  let A: Awaited<ReturnType<typeof newBusiness>>;
  let superCookies: Map<string, string>;
  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret-for-vitest-only-0123456789abcdef";
    process.env.REGISTRATION_HOURLY_LIMIT = "100000";
    process.env.BILLING_MOCK = "true";
    A = await newBusiness("সাস টেস্ট স্টোর", { businessType: "PHARMACY", address: "ঢাকা" });
    const admin = await prisma.user.create({ data: { name: "প্ল্যাটফর্ম অ্যাডমিন", mobile: freshMobile(), passwordHash: "x", isSuperAdmin: true } });
    superCookies = await sessionFor(admin.id);
  });
  beforeEach(() => {
    req.cookies = new Map(A.cookies);
  });

  it("registration creates the tenant with an Owner, business type, address and a trial on the trial plan", async () => {
    const s = await sub(A.id);
    expect(s.status).toBe("TRIAL");
    expect(s.plan.code).toBe("PREMIUM");
    expect(s.trialEndsAt!.getTime()).toBe(addDays(startOfDay(new Date()), 14).getTime());
    const b = await prisma.business.findUniqueOrThrow({ where: { id: A.id } });
    expect(b.businessType).toBe("PHARMACY");
    expect(b.address).toBe("ঢাকা");
    expect(await prisma.subscriptionEvent.count({ where: { businessId: A.id, type: "TRIAL_STARTED" } })).toBe(1);
    const ctx = await ctxNow();
    expect(ctx.permissions).toContain("*");
    expect(ctx.subscription?.status).toBe("TRIAL");
    expect(ctx.features).toEqual(expect.arrayContaining(["ACCOUNTING", "POS", "HRM"]));
  });

  it("a chosen public plan is honoured at sign-up; a hidden plan code is ignored", async () => {
    const basic = await newBusiness("বেসিক স্টোর", { plan: "BASIC" });
    expect((await sub(basic.id)).plan.code).toBe("BASIC");
    const hidden = await prisma.plan.create({ data: { code: `HID${n}`, nameBn: "গোপন", nameEn: "Hidden", priceMonthly: 1, priceYearly: 10, isPublic: false } });
    const h = await newBusiness("গোপন প্ল্যান স্টোর", { plan: hidden.code });
    expect((await sub(h.id)).plan.code).toBe("PREMIUM");
    await prisma.plan.delete({ where: { id: hidden.id } });
  });

  it("plan entitlements: features outside the plan are closed on the server and cannot be switched on", async () => {
    const B = await newBusiness("প্ল্যান সীমা স্টোর", { plan: "BASIC" });
    req.cookies = new Map(B.cookies);
    const ctx = await ctxNow();
    expect(ctx.entitled).not.toContain("HRM");
    expect(ctx.features).not.toContain("HRM");
    expect(hasPermission(ctx.permissions, "payroll:view")).toBe(false);
    expect(hasPermission(ctx.permissions, "purchases:view")).toBe(true);
    const r = await call(() => setFeatureAction("HRM", true, null, form({})));
    expect((r.value as { ok: boolean; message: string }).message).toMatch(/প্ল্যানে নেই/);
  });

  it("expiry: grace keeps the plan, then the free plan's features only — data is kept; reminders are de-duplicated", async () => {
    const B = await newBusiness("মেয়াদ টেস্ট স্টোর");
    const today = startOfDay(new Date());
    // 7 days before the end: exactly one reminder, however often the check runs
    await prisma.subscription.update({ where: { businessId: B.id }, data: { status: "ACTIVE", endDate: addDays(today, 7), trialEndsAt: null } });
    expect((await subscriptionDailyCheck(B.id)).reminded).toBe(1);
    expect((await subscriptionDailyCheck(B.id)).reminded).toBe(0);
    expect(await prisma.notification.count({ where: { businessId: B.id, kind: "SUBSCRIPTION_EXPIRING" } })).toBe(1);

    // ended yesterday: inside the 3-day grace period, still the full plan
    await prisma.subscription.update({ where: { businessId: B.id }, data: { endDate: addDays(today, -1) } });
    req.cookies = new Map(B.cookies);
    let ctx = await ctxNow();
    expect(ctx.subscription).toMatchObject({ inGrace: true, blocked: false });
    expect(ctx.features).toContain("HRM");
    expect((await subscriptionDailyCheck(B.id)).expired).toBe(false);

    // past the grace period: EXPIRED, free plan features only, nothing deleted
    const accounts = await prisma.account.count({ where: { businessId: B.id } });
    await prisma.subscription.update({ where: { businessId: B.id }, data: { endDate: addDays(today, -10) } });
    expect((await subscriptionDailyCheck(B.id)).expired).toBe(true);
    expect((await sub(B.id)).status).toBe("EXPIRED");
    expect(await prisma.notification.count({ where: { businessId: B.id, kind: "SUBSCRIPTION_EXPIRED" } })).toBe(1);
    ctx = await ctxNow();
    expect(ctx.subscription?.status).toBe("EXPIRED");
    expect([...ctx.entitled].sort()).toEqual(["ACCOUNTING", "CUSTOMER", "INVENTORY", "SALES"]);
    expect(hasPermission(ctx.permissions, "purchases:view")).toBe(false);
    expect(hasPermission(ctx.permissions, "sales:view")).toBe(true);
    expect(await prisma.account.count({ where: { businessId: B.id } })).toBe(accounts);
    // the free plan allows one user
    expect(await userUsage(B.id)).toEqual({ used: 1, limit: 1 });
    await expect(assertUserSlot(B.id)).rejects.toThrow(/সর্বোচ্চ/);
  });

  it("mock gateway: checkout → signed webhook → active plan + invoice; replay is idempotent; tampering refused", async () => {
    const B = await newBusiness("পেমেন্ট টেস্ট স্টোর");
    const business = await planId("BUSINESS");
    const c1 = await startCheckout({ businessId: B.id, userId: B.ctx.user.id, planId: business, cycle: "MONTHLY", provider: "mock", baseUrl: "http://localhost" });
    const c2 = await startCheckout({ businessId: B.id, userId: B.ctx.user.id, planId: business, cycle: "MONTHLY", provider: "mock", baseUrl: "http://localhost" });
    expect(c2.transaction.id).toBe(c1.transaction.id); // open checkout reused, no duplicate
    expect(c1.redirectUrl).toContain("/billing/mock-gateway?txn=");
    const txn = c1.transaction.id;
    const amount = String(Number(c1.transaction.amount));
    const TRX = `MOCK${Date.now()}`;

    // forged signature / altered amount → 400, nothing activated
    expect((await mockWebhook({ txn, outcome: "SUCCESS", trx: TRX, amount }, "forged")).status).toBe(400);
    expect((await mockWebhook({ txn, outcome: "SUCCESS", trx: TRX, amount }, mockSignature({ txn, outcome: "SUCCESS", trx: TRX, amount: "1" }))).status).toBe(400);
    expect((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: txn } })).status).toBe("INITIATED");

    const ok = await mockWebhook({ txn, outcome: "SUCCESS", trx: TRX, amount });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, outcome: "SUCCESS" });
    const s = await sub(B.id);
    expect(s).toMatchObject({ status: "ACTIVE", billingCycle: "MONTHLY" });
    expect(s.plan.code).toBe("BUSINESS");
    const inv = await prisma.invoice.findMany({ where: { businessId: B.id } });
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ status: "PAID", paymentMethod: "mock", transactionRef: TRX });
    expect(inv[0].number).toMatch(/^[A-Za-z0-9-]+-\d{4}-\d{6}$/);
    expect(await prisma.notification.count({ where: { businessId: B.id, kind: "PAYMENT_SUCCESS" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { businessId: B.id, entity: "Payment", details: jsonKey("event", { equals: "payment-success" }) } })).toBe(1);

    // gateway retry → no second invoice / period
    expect((await mockWebhook({ txn, outcome: "SUCCESS", trx: TRX, amount })).status).toBe(200);
    expect(await prisma.invoice.count({ where: { businessId: B.id } })).toBe(1);
    expect((await sub(B.id)).endDate!.getTime()).toBe(s.endDate!.getTime());
    req.cookies = new Map(B.cookies);
    expect((await ctxNow()).subscription?.status).toBe("ACTIVE");

    // the same gateway receipt replayed for a different checkout is refused and recorded
    const c3 = await startCheckout({ businessId: B.id, userId: B.ctx.user.id, planId: await planId("PREMIUM"), cycle: "MONTHLY", provider: "mock", baseUrl: "http://localhost" });
    const t3 = c3.transaction.id;
    const a3 = String(Number(c3.transaction.amount));
    const replay = await mockWebhook({ txn: t3, outcome: "SUCCESS", trx: TRX, amount: a3 });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ outcome: "FAILED" });
    expect((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: t3 } })).failureReason).toMatch(/duplicate gateway transaction/);
    expect((await sub(B.id)).plan.code).toBe("BUSINESS");
  });

  it("amount mismatch is recorded as FAILED and activates nothing; failed/cancelled payments change nothing", async () => {
    const B = await newBusiness("অমিল টেস্ট স্টোর");
    const before = await sub(B.id);
    const c = await startCheckout({ businessId: B.id, userId: B.ctx.user.id, planId: await planId("BASIC"), cycle: "YEARLY", provider: "mock", baseUrl: "http://localhost" });
    const txn = c.transaction.id;
    const trx = `MOCKX${Date.now()}`;
    const r = await processProviderResult("mock", { txn, outcome: "SUCCESS", trx, amount: "1", sig: mockSignature({ txn, outcome: "SUCCESS", trx, amount: "1" }) });
    expect(r.outcome).toBe("FAILED");
    const t = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: txn } });
    expect(t.status).toBe("FAILED");
    expect(t.failureReason).toMatch(/amount mismatch/);
    expect((await sub(B.id)).planId).toBe(before.planId);
    expect(await prisma.invoice.count({ where: { businessId: B.id } })).toBe(0);

    const c2 = await startCheckout({ businessId: B.id, userId: B.ctx.user.id, planId: await planId("BASIC"), cycle: "MONTHLY", provider: "mock", baseUrl: "http://localhost" });
    const t2 = c2.transaction.id;
    const amt = String(Number(c2.transaction.amount));
    expect((await processProviderResult("mock", { txn: t2, outcome: "CANCELLED", trx: "", amount: amt, sig: mockSignature({ txn: t2, outcome: "CANCELLED", trx: "", amount: amt }) })).outcome).toBe("CANCELLED");
    expect((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: t2 } })).status).toBe("CANCELLED");
    expect((await sub(B.id)).status).toBe("TRIAL");
  });

  it("manual transfer: TrxID → PENDING → only a super admin approves; TrxID reuse and tenant crossing refused", async () => {
    const B = await newBusiness("ম্যানুয়াল টেস্ট স্টোর");
    const C = await newBusiness("অন্য কোম্পানি");
    const c = await startCheckout({ businessId: B.id, userId: B.ctx.user.id, planId: await planId("BASIC"), cycle: "MONTHLY", provider: "manual", baseUrl: "http://localhost" });
    expect(c.redirectUrl).toBe(`/billing/manual?txn=${c.transaction.id}`);
    await expect(submitManualReference(C.id, c.transaction.id, "BK12345678")).rejects.toThrow(/পাওয়া যায়নি/); // another tenant
    const ref = `BK${Date.now()}`;
    await submitManualReference(B.id, c.transaction.id, ref);
    expect((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: c.transaction.id } })).status).toBe("PENDING");
    const c2 = await startCheckout({ businessId: C.id, userId: C.ctx.user.id, planId: await planId("BASIC"), cycle: "MONTHLY", provider: "manual", baseUrl: "http://localhost" });
    await expect(submitManualReference(C.id, c2.transaction.id, ref)).rejects.toThrow(/আগেই ব্যবহার/);

    // the company owner (not a super admin) cannot approve its own payment
    req.cookies = new Map(B.cookies);
    expect((await adminApprovePaymentAction(c.transaction.id, null, form({})))?.ok).toBe(false);
    expect((await sub(B.id)).status).toBe("TRIAL");

    req.cookies = new Map(superCookies);
    expect((await adminApprovePaymentAction(c.transaction.id, null, form({})))?.ok).toBe(true);
    expect((await sub(B.id)).plan.code).toBe("BASIC");
    expect((await prisma.invoice.findFirstOrThrow({ where: { businessId: B.id } })).transactionRef).toBe(ref);
    expect(await prisma.auditLog.count({ where: { entity: "Payment", entityId: c.transaction.id, details: jsonKey("event", { equals: "admin-approve" }) } })).toBe(1);
    expect((await adminApprovePaymentAction(c.transaction.id, null, form({})))?.ok).toBe(false); // not twice

    // rejection
    const c3 = await startCheckout({ businessId: C.id, userId: C.ctx.user.id, planId: await planId("BUSINESS"), cycle: "MONTHLY", provider: "manual", baseUrl: "http://localhost" });
    await submitManualReference(C.id, c3.transaction.id, `NG${Date.now()}`);
    expect((await adminRejectPaymentAction(c3.transaction.id, null, form({ reason: "টাকা পাওয়া যায়নি" })))?.ok).toBe(true);
    expect((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: c3.transaction.id } })).status).toBe("FAILED");
    expect((await sub(C.id)).status).toBe("TRIAL");
  });

  it("super admin only: panel 404 and actions forbidden for company owners; every super-admin change is audited", async () => {
    const B = await newBusiness("অ্যাডমিন টেস্ট স্টোর");
    req.cookies = new Map(B.cookies); // an Owner (all business permissions) is still not a platform admin
    await expect(requireSuperAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await adminExtendAction(B.id, null, form({ days: "365" })))?.ok).toBe(false);
    expect((await adminChangePlanAction(B.id, null, form({ planId: await planId("PREMIUM"), cycle: "YEARLY" })))?.ok).toBe(false);
    expect((await adminSuspendAction(B.id, true, null, form({})))?.ok).toBe(false);
    expect((await sub(B.id)).status).toBe("TRIAL");

    req.cookies = new Map(superCookies);
    expect((await requireSuperAdmin()).isSuperAdmin).toBe(true);
    // change plan, extend, feature override, suspend, resume
    const basicId = await planId("BASIC");
    expect((await call(() => adminChangePlanAction(B.id, null, form({ planId: basicId, cycle: "MONTHLY", endDate: "2030-01-31" })))).redirect).toBe(`/admin/companies/${B.id}`);
    let s = await sub(B.id);
    expect(s).toMatchObject({ status: "ACTIVE" });
    expect(s.plan.code).toBe("BASIC");
    expect((await call(() => adminExtendAction(B.id, null, form({ days: "10" })))).redirect).toBeTruthy();
    expect((await sub(B.id)).endDate!.toISOString().slice(0, 10)).toBe("2030-02-10");
    expect((await adminFeatureOverrideAction(B.id, "HRM", "on", null, form({})))?.ok).toBe(true);
    req.cookies = new Map(B.cookies);
    expect((await ctxNow()).entitled).toContain("HRM"); // granted beyond the plan
    req.cookies = new Map(superCookies);
    expect((await call(() => adminSuspendAction(B.id, true, null, form({ reason: "পরীক্ষা" })))).redirect).toBeTruthy();
    req.cookies = new Map(B.cookies);
    const ctx = await ctxNow();
    expect(ctx.subscription?.blocked).toBe(true);
    expect(hasPermission(ctx.permissions, "sales:view")).toBe(false);
    expect(hasPermission(ctx.permissions, "billing:view")).toBe(true);
    req.cookies = new Map(superCookies);
    await call(() => adminSuspendAction(B.id, false, null, form({})));
    req.cookies = new Map(B.cookies);
    expect(hasPermission((await ctxNow()).permissions, "sales:view")).toBe(true);
    s = await sub(B.id);
    expect(s.status).toBe("ACTIVE");
    const events = (await prisma.auditLog.findMany({ where: { businessId: B.id, entity: { in: ["Subscription", "Feature"] } } })).map((a) => (a.details as { event?: string }).event);
    expect(events).toEqual(expect.arrayContaining(["admin-plan-change", "admin-extend", "admin-override", "admin-suspend", "admin-resume"]));
  });

  it("plan management: create, edit price / user limit / features, protected plans, delete unused", async () => {
    req.cookies = new Map(superCookies);
    const code = `TEST${Date.now() % 100000}`;
    const payload = (o: Record<string, unknown> = {}) => form({ payload: JSON.stringify({ code, nameBn: "টেস্ট", nameEn: "Test", descriptionBn: null, descriptionEn: null, priceMonthly: 100, priceYearly: 1000, userLimit: 2, isActive: true, isPublic: false, sortOrder: 500, features: ["ACCOUNTING", "POS"], ...o }) });
    expect((await call(() => adminSavePlanAction(null, null, payload()))).redirect).toBe("/admin/plans");
    const p = await prisma.plan.findUniqueOrThrow({ where: { code }, include: { features: true } });
    expect(p.features.map((f) => f.featureKey).sort()).toEqual(["ACCOUNTING", "POS"]);
    expect(((await adminSavePlanAction(p.id, null, payload({ features: ["ACCOUNTING", "NOT_A_FEATURE"] }))) as { message: string }).message).toMatch(/অজানা ফিচার/);
    expect((await call(() => adminSavePlanAction(p.id, null, payload({ priceMonthly: 150, userLimit: null, features: ["ACCOUNTING", "HRM"] })))).redirect).toBe("/admin/plans");
    const p2 = await prisma.plan.findUniqueOrThrow({ where: { code }, include: { features: true } });
    expect(Number(p2.priceMonthly)).toBe(150);
    expect(p2.userLimit).toBeNull();
    expect(p2.features.map((f) => f.featureKey).sort()).toEqual(["ACCOUNTING", "HRM"]);
    // the fallback (free) plan cannot be deleted; an unused plan can
    expect((await adminDeletePlanAction(await planId("FREE"), null, form({})))?.ok).toBe(false);
    expect((await call(() => adminDeletePlanAction(p.id, null, form({})))).redirect).toBe("/admin/plans");
    expect(await prisma.plan.findUnique({ where: { code } })).toBeNull();
    // a company owner cannot manage plans
    req.cookies = new Map(A.cookies);
    expect((await adminSavePlanAction(null, null, payload()))?.ok).toBe(false);
  });

  it("tenant isolation: a user cannot switch into another company or read its billing records", async () => {
    const B = await newBusiness("আইসোলেশন স্টোর");
    // A's owner forges B's business cookie → falls back to a business they belong to
    req.cookies = new Map(A.cookies);
    req.cookies.set(BUSINESS_COOKIE, B.id);
    const ctx = await ctxNow();
    expect(ctx.business.id).not.toBe(B.id);
    // billing pages / actions always filter by the caller's business
    const c = await startCheckout({ businessId: B.id, userId: B.ctx.user.id, planId: await planId("BASIC"), cycle: "MONTHLY", provider: "manual", baseUrl: "http://localhost" });
    expect(await prisma.paymentTransaction.findFirst({ where: { id: c.transaction.id, businessId: ctx.business.id } })).toBeNull();
    await expect(submitManualReference(ctx.business.id, c.transaction.id, "BK99999999")).rejects.toThrow(/পাওয়া যায়নি/);
  });

  it("registration: 'trial started' notice; duplicate mobile / e-mail refused; nothing half-created", async () => {
    expect(await prisma.notification.count({ where: { businessId: A.id, kind: "TRIAL_STARTED" } })).toBe(1);
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: A.ctx.user.id } });
    const businesses = await prisma.business.count();
    req.cookies.clear();
    const dupMobile = await call(() => registerAction(null, form({ businessName: "নকল", ownerName: "x", mobile: owner.mobile!, email: "", password: PASSWORD, confirmPassword: PASSWORD })));
    expect((dupMobile.value as { errors?: Record<string, string[]> })?.errors?.mobile?.[0]).toMatch(/আগেই/);
    const B = await newBusiness("ইমেইল স্টোর", { email: `saas${Date.now()}@test.local` });
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: B.ctx.user.id } })).email!;
    req.cookies.clear();
    const dupEmail = await call(() => registerAction(null, form({ businessName: "নকল ২", ownerName: "x", mobile: freshMobile(), email, password: PASSWORD, confirmPassword: PASSWORD })));
    expect((dupEmail.value as { errors?: Record<string, string[]> })?.errors?.email?.[0]).toMatch(/আগেই/);
    expect(await prisma.business.count()).toBe(businesses + 1); // only the legitimate one
    expect(await prisma.auditLog.count({ where: { businessId: B.id, entity: "Registration" } })).toBe(1);
  });

  it("payment updates the subscription's amount / payment status and raises 'subscription activated' / 'upgraded'", async () => {
    const B = await newBusiness("অ্যাক্টিভেশন স্টোর", { plan: "BASIC" });
    const c = await startCheckout({ businessId: B.id, userId: B.ctx.user.id, planId: await planId("BUSINESS"), cycle: "YEARLY", provider: "mock", baseUrl: "http://localhost" });
    const txn = c.transaction.id;
    const amount = String(Number(c.transaction.amount));
    const trx = `MOCKA${Date.now()}`;
    await processProviderResult("mock", { txn, outcome: "SUCCESS", trx, amount, sig: mockSignature({ txn, outcome: "SUCCESS", trx, amount }) });
    const s = await sub(B.id);
    expect(Number(s.amount)).toBe(Number(amount));
    expect(s.paymentStatus).toBe("SUCCESS");
    const n = await prisma.notification.findFirstOrThrow({ where: { businessId: B.id, kind: "SUBSCRIPTION_ACTIVATED" } });
    expect(n.title).toMatch(/সাবস্ক্রিপশন চালু/); // trial → first paid period
    // a paid BUSINESS period → PREMIUM is an upgrade
    const c2 = await startCheckout({ businessId: B.id, userId: B.ctx.user.id, planId: await planId("PREMIUM"), cycle: "MONTHLY", provider: "mock", baseUrl: "http://localhost" });
    const t2 = c2.transaction.id;
    const a2 = String(Number(c2.transaction.amount));
    const trx2 = `MOCKU${Date.now()}`;
    await processProviderResult("mock", { txn: t2, outcome: "SUCCESS", trx: trx2, amount: a2, sig: mockSignature({ txn: t2, outcome: "SUCCESS", trx: trx2, amount: a2 }) });
    expect((await prisma.notification.findFirstOrThrow({ where: { businessId: B.id, kind: "SUBSCRIPTION_ACTIVATED", title: { contains: "প্রিমিয়াম" } } })).title).toMatch(/আপগ্রেড/);
    expect(await prisma.subscriptionEvent.count({ where: { businessId: B.id, type: "UPGRADED" } })).toBe(1);
    req.cookies = new Map(B.cookies);
    const ctx = await ctxNow();
    expect(ctx.features).toEqual(expect.arrayContaining(["HRM", "POS", "PRODUCT_EXPIRY"])); // paid features on
    expect(hasPermission(ctx.permissions, "payroll:view")).toBe(true);
  });

  it("refund (super admin only): payment and invoice REFUNDED, audited, never twice; revenue and search see it", async () => {
    const B = await newBusiness("রিফান্ড স্টোর");
    const c = await startCheckout({ businessId: B.id, userId: B.ctx.user.id, planId: await planId("BASIC"), cycle: "MONTHLY", provider: "mock", baseUrl: "http://localhost" });
    const txn = c.transaction.id;
    const amount = String(Number(c.transaction.amount));
    const trx = `MOCKR${Date.now()}`;
    await processProviderResult("mock", { txn, outcome: "SUCCESS", trx, amount, sig: mockSignature({ txn, outcome: "SUCCESS", trx, amount }) });
    const today = new Date().toISOString().slice(0, 10);
    const before = await revenueReport({ from: today, to: today, plan: "BASIC" });
    expect(before.total).toBeGreaterThanOrEqual(Number(amount));

    req.cookies = new Map(B.cookies);
    expect((await adminRefundPaymentAction(txn, null, form({ reason: "গ্রাহকের অনুরোধ" })))?.ok).toBe(false); // owner cannot
    req.cookies = new Map(superCookies);
    expect((await adminRefundPaymentAction(txn, null, form({ reason: "" })))?.ok).toBe(false); // reason required
    expect((await adminRefundPaymentAction(txn, null, form({ reason: "গ্রাহকের অনুরোধ" })))?.ok).toBe(true);
    expect((await adminRefundPaymentAction(txn, null, form({ reason: "আবার" })))?.ok).toBe(false);
    expect((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: txn } })).status).toBe("REFUNDED");
    expect((await prisma.invoice.findFirstOrThrow({ where: { businessId: B.id } })).status).toBe("REFUNDED");
    expect((await sub(B.id)).paymentStatus).toBe("REFUNDED");
    expect(await prisma.auditLog.count({ where: { entity: "Payment", entityId: txn, details: jsonKey("event", { equals: "admin-refund" }) } })).toBe(1);
    const after = await revenueReport({ from: today, to: today, plan: "BASIC" });
    expect(after.total).toBeCloseTo(before.total - Number(amount), 2);
    expect(after.refunded).toBeGreaterThanOrEqual(Number(amount));

    // company search by the owner's mobile, payment status filter
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: B.ctx.user.id } });
    const found = await companyList({ search: owner.mobile!, paymentStatus: "REFUNDED", skip: 0, take: 25 });
    expect(found.rows.map((r) => r.id)).toContain(B.id);
    expect(found.rows[0].memberships[0]?.user.mobile).toBe(owner.mobile);
  });

  it("INVENTORY is a plan feature: a company that switches it off loses product pages / permissions, sales still pick products", async () => {
    const B = await newBusiness("ইনভেন্টরি স্টোর");
    req.cookies = new Map(B.cookies);
    expect((await ctxNow()).features).toContain("INVENTORY");
    const r = await call(() => setFeatureAction("INVENTORY", false, null, form({})));
    expect(r.redirect).toBe("/features");
    const ctx = await ctxNow();
    expect(hasPermission(ctx.permissions, "inventory:view")).toBe(false);
    expect(hasPermission(ctx.permissions, "sales:create")).toBe(true);
    await call(() => setFeatureAction("INVENTORY", true, null, form({})));
    expect(hasPermission((await ctxNow()).permissions, "inventory:view")).toBe(true);
  });
});
