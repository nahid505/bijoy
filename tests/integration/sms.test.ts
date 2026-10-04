// SMS system end-to-end: real server actions (Next request APIs replaced by an in-memory stand-in),
// real services and the test database, with a programmable test gateway.
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

import { prisma } from "@/lib/db";
import { SESSION_COOKIE, createSessionToken } from "@/lib/session";
import { loginAction, registerAction, requestPasswordResetAction, requestRegistrationOtpAction, resetPasswordAction } from "@/server/actions/auth";
import { deleteVoucherAction, saveVoucherAction } from "@/server/actions/vouchers";
import { refreshSmsBalanceAction, retrySmsAction, saveSmsSettingsAction, saveSmsTemplateAction, sendManualSmsAction, sendTestSmsAction } from "@/server/actions/sms";
import { BUSINESS_COOKIE, getContext, getCurrentUser } from "@/server/auth";
import { systemAccounts } from "@/server/services/accounting";
import { saveParty, saveProduct } from "@/server/services/master";
import { createSession } from "@/server/services/sessions";
import { runDailyChecks } from "@/server/services/notifications";
import { registerSmsProvider, SmsProviderError, type OutgoingSms } from "@/server/sms/providers";
import { enqueueSms, processSmsQueue, refreshDeliveryStatus, smsQueueIdle } from "@/server/sms/queue";
import { issueOtp, verifyOtp } from "@/server/sms/otp";
import { GET as dlrGet } from "@/app/api/sms/dlr/route";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const PASSWORD = "Dokan-2026x";

// ── programmable test gateway
const gw = vi.hoisted(() => ({ sent: [] as { to: string; text: string; encoding: string }[], mode: "ok" as "ok" | "temporary" | "permanent", balance: 50, delivered: new Set<string>() }));
let seq = 0;
registerSmsProvider("test", () => ({
  id: "test",
  async send(m: OutgoingSms) {
    if (gw.mode === "temporary") throw new SmsProviderError("gateway busy", true, "BUSY");
    if (gw.mode === "permanent") throw new SmsProviderError("invalid number", false, "INVALID");
    gw.sent.push({ to: m.to, text: m.text, encoding: m.encoding });
    return { requestId: `t-${++seq}-${Math.random().toString(36).slice(2)}`, status: "SENT", cost: m.encoding === "UCS2" ? 0.35 : 0.25 };
  },
  async balance() {
    return gw.balance;
  },
  async status(id: string) {
    return gw.delivered.has(id) ? "DELIVERED" : "SENT";
  },
}));

let n = 0;
const freshMobile = () => `017${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}${String(++n % 100).padStart(2, "0")}`;
const lastCode = (to: string) => gw.sent.filter((s) => s.to === to).at(-1)?.text.match(/\d{6}/)?.[0] ?? "";

async function call<T>(fn: () => Promise<T>) {
  try {
    return { value: await fn(), redirect: null as string | null };
  } catch (e) {
    if ((e as Error).message === "NEXT_REDIRECT") return { value: null, redirect: (e as { url: string }).url };
    throw e;
  }
}
const form = (o: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
};

/** Registers a new owner + business (OTP off for this helper) and leaves them signed in. */
async function newBusiness(name: string) {
  const prev = process.env.REGISTRATION_OTP;
  process.env.REGISTRATION_OTP = "false";
  req.cookies.clear();
  const mobile = freshMobile();
  const r = await call(() => registerAction(null, form({ businessName: name, ownerName: "মালিক", mobile, email: "", password: PASSWORD, confirmPassword: PASSWORD })));
  if (prev === undefined) delete process.env.REGISTRATION_OTP;
  else process.env.REGISTRATION_OTP = prev;
  expect(r.redirect).toBe("/dashboard");
  const ctx = (await getContext())!;
  return { ctx, ownerMobile: mobile, cookies: new Map(req.cookies) };
}
const useSession = (cookies: Map<string, string>) => {
  req.cookies = new Map(cookies);
};

async function enableSms(extra: Record<string, string | string[]> = {}) {
  const r = await saveSmsSettingsAction(null, form({
    enabled: "on", provider: "test", apiKey: "secret-key-987654", senderId: "BIJOY", lowBalanceThreshold: "100",
    events: ["SALE_INVOICE", "PAYMENT_RECEIVED", "SALES_RETURN", "INVOICE_CANCELLED", "DUE_REMINDER", "PURCHASE", "SUPPLIER_PAYMENT", "PURCHASE_RETURN", "SUPPLIER_DUE", "LOW_STOCK", "EXPIRY_WARNING", "EXPIRED"],
    alertMobiles: "", expiryAlertDays: ["90", "60", "30", "15", "7"], dueReminderEveryDays: "7", ...extra,
  }));
  expect(r?.ok).toBe(true);
}

/** waits for background worker runs (started by actions) and then processes the queue itself */
async function drain(opts: { now?: Date } = {}) {
  await smsQueueIdle();
  await processSmsQueue(prisma, opts);
  await smsQueueIdle();
}

const today = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
const day = (offset: number) => new Date(today().getTime() + offset * 86_400_000);

run("SMS system", () => {
  let A: Awaited<ReturnType<typeof newBusiness>>;
  let customer: { id: string; accountId: string; mobile: string };
  let supplier: { id: string; accountId: string; mobile: string };
  let product: string;
  let cash: string;

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret-for-vitest-only-0123456789abcdef";
    process.env.SMS_PROVIDER = "test"; // platform gateway for security codes
    process.env.REGISTRATION_HOURLY_LIMIT = "100000";
    A = await newBusiness("এসএমএস টেস্ট স্টোর");
    await enableSms();
    const unit = await prisma.unit.findFirstOrThrow({ where: { businessId: A.ctx.business.id, name: "পিস" } });
    product = await saveProduct(A.ctx.svc, { name: "চিনি", code: "SUGAR", barcode: null, categoryId: null, brandId: null, unitId: unit.id, purchasePrice: 100, salePrice: 130, wholesalePrice: 0, minStock: 20, openingStock: 50, openingRate: 100, trackBatch: false });
    const party = (name: string, mobile: string) => ({ name, mobile, email: null, address: null, notes: null, openingBalance: 0, creditLimit: 0, creditDays: 0 });
    const cm = freshMobile();
    const sm = freshMobile();
    customer = { ...(await saveParty(A.ctx.svc, "CUSTOMER", party("রহিম", cm))), mobile: cm };
    supplier = { ...(await saveParty(A.ctx.svc, "SUPPLIER", party("মেঘনা", sm))), mobile: sm };
    cash = (await prisma.$transaction((tx) => systemAccounts(tx, A.ctx.business.id))).CASH;
  });
  beforeEach(() => {
    gw.mode = "ok";
    useSession(A.cookies);
  });

  const sale = (qty: number, paid: number, extra: Record<string, unknown> = {}) =>
    call(() => saveVoucherAction("SALES", null, null, form({ payload: JSON.stringify({ date: today().toISOString().slice(0, 10), reference: null, narration: null, partyAccountId: customer.accountId, warehouseId: null, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0, payments: paid ? [{ accountId: cash, amount: paid, reference: null }] : [], items: [{ productId: product, unitId: null, quantity: qty, rate: 130, discount: 0, batchNo: null, expiryDate: null }], ...extra }) })));
  const voucherIdOf = (redirect: string | null) => redirect!.split("/").pop()!;
  const smsFor = (voucherId: string) => prisma.smsMessage.findMany({ where: { voucherId } });

  it("settings: API key is stored encrypted and never in plain text", async () => {
    const s = await prisma.smsSettings.findUniqueOrThrow({ where: { businessId: A.ctx.business.id } });
    expect(s.apiKeyEnc).not.toContain("secret-key-987654");
    expect(s.apiKeyHint).toBe("••••7654");
    const auditRow = await prisma.auditLog.findFirstOrThrow({ where: { businessId: A.ctx.business.id, entity: "SmsSettings" }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(auditRow.details)).not.toContain("secret-key-987654");
  });

  it("provider connection: test SMS is sent and logged; balance is read", async () => {
    const to = freshMobile();
    const r = await sendTestSmsAction(null, form({ testMobile: to }));
    expect(r?.ok).toBe(true);
    expect(gw.sent.at(-1)).toMatchObject({ to, encoding: "UCS2" });
    const m = await prisma.smsMessage.findFirstOrThrow({ where: { businessId: A.ctx.business.id, event: "TEST", recipient: to } });
    expect(m).toMatchObject({ status: "SENT", provider: "test", attempts: 1 });
    expect(m.requestId).toMatch(/^t-/);
    expect(Number(m.cost)).toBe(0.35);
    expect(m.sentAt).not.toBeNull();
    const b = await refreshSmsBalanceAction();
    expect(b?.message).toContain("50");
    // 50 < threshold 100 → low-balance alert in the notification centre
    expect(await prisma.notification.count({ where: { businessId: A.ctx.business.id, kind: "SMS_BALANCE_LOW", resolvedAt: null } })).toBe(1);
  });

  it("customer invoice SMS: queued after the sale commits, Bangla text with invoice, total, paid, due", async () => {
    const r = await sale(4, 200);
    const vid = voucherIdOf(r.redirect);
    await drain();
    const [m] = await smsFor(vid);
    expect(m).toMatchObject({ event: "SALE_INVOICE", recipient: customer.mobile, status: "SENT", customerId: customer.id, encoding: "UCS2" });
    expect(m.body).toContain("রহিম");
    expect(m.body).toMatch(/INV-\d{6}/);
    expect(m.body).toContain("৫২০"); // total 4 × 130
    expect(m.body).toContain("৩২০"); // due
    expect(m.parts).toBeGreaterThanOrEqual(1);
  });

  it("editing a voucher does not send a second SMS (duplicate prevention)", async () => {
    const r = await sale(1, 130);
    const vid = voucherIdOf(r.redirect);
    await drain();
    expect((await smsFor(vid)).length).toBe(1);
    // an accidental second enqueue of the same event is refused by the unique dedupe key
    const again = await enqueueSms(prisma, { businessId: A.ctx.business.id, event: "SALE_INVOICE", recipient: customer.mobile, body: "x", dedupeKey: `${A.ctx.business.id}:voucher:${vid}:SALE_INVOICE` });
    expect(again.status).toBe("duplicate");
  });

  it("SMS failure NEVER rolls back the sale: gateway down → sale saved, SMS retried later", async () => {
    gw.mode = "temporary";
    const before = Number((await prisma.product.findUniqueOrThrow({ where: { id: product } })).stock);
    const r = await sale(2, 260);
    expect(r.redirect).toMatch(/^\/vouchers\/v\//); // the action succeeded
    const vid = voucherIdOf(r.redirect);
    expect(await prisma.voucher.count({ where: { id: vid } })).toBe(1);
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: product } })).stock)).toBe(before - 2);
    await drain();
    let [m] = await smsFor(vid);
    expect(m.status).toBe("QUEUED"); // temporary failure → scheduled retry
    expect(m.attempts).toBe(1);
    expect(m.lastError).toContain("পুনরায় চেষ্টা");
    expect(m.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    // gateway recovers → controlled retry succeeds
    gw.mode = "ok";
    await drain({ now: new Date(Date.now() + 2 * 60_000) });
    [m] = await smsFor(vid);
    expect(m.status).toBe("SENT");
    expect(m.attempts).toBe(2);
  });

  it("permanent failures are not retried; temporary ones stop after max attempts", async () => {
    gw.mode = "permanent";
    const p = await enqueueSms(prisma, { businessId: A.ctx.business.id, event: "MANUAL", recipient: freshMobile(), body: "permanent" });
    await drain();
    const pm = await prisma.smsMessage.findUniqueOrThrow({ where: { id: (p as { id: string }).id } });
    expect(pm).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(pm.lastError).toContain("invalid number");

    gw.mode = "temporary";
    const t = await enqueueSms(prisma, { businessId: A.ctx.business.id, event: "MANUAL", recipient: freshMobile(), body: "temporary", maxAttempts: 3 });
    let clock = Date.now();
    for (let i = 0; i < 5; i++) {
      await drain({ now: new Date(clock) });
      clock += 4 * 60 * 60_000;
    }
    const tm = await prisma.smsMessage.findUniqueOrThrow({ where: { id: (t as { id: string }).id } });
    expect(tm).toMatchObject({ status: "FAILED", attempts: 3 });

    // manual retry of a failed SMS
    gw.mode = "ok";
    expect((await retrySmsAction(tm.id))?.ok).toBe(true);
    await drain();
    expect((await prisma.smsMessage.findUniqueOrThrow({ where: { id: tm.id } })).status).toBe("SENT");
  });

  it("parallel workers never send the same SMS twice (FOR UPDATE SKIP LOCKED)", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push(((await enqueueSms(prisma, { businessId: A.ctx.business.id, event: "MANUAL", recipient: freshMobile(), body: `parallel ${i}` })) as { id: string }).id);
    const before = gw.sent.length;
    await Promise.all([processSmsQueue(prisma), processSmsQueue(prisma), processSmsQueue(prisma)]);
    const texts = gw.sent.slice(before).map((s) => s.text).filter((t) => t.startsWith("parallel"));
    expect(texts.length).toBe(12);
    expect(new Set(texts).size).toBe(12);
  });

  it("payment received, sales return and invoice cancellation SMS", async () => {
    const pay = await call(() => saveVoucherAction("RECEIPT", null, null, form({ payload: JSON.stringify({ date: today().toISOString().slice(0, 10), reference: null, narration: null, cashAccountId: cash, lines: [{ accountId: customer.accountId, amount: 100, narration: null }] }) })));
    const s = await sale(3, 0);
    const saleId = voucherIdOf(s.redirect);
    const ret = await call(() => saveVoucherAction("SALES_RETURN", null, null, form({ payload: JSON.stringify({ date: today().toISOString().slice(0, 10), reference: null, narration: null, partyAccountId: customer.accountId, warehouseId: null, returnOfId: saleId, dueDate: null, discount: 0, vatPercent: 0, payments: [], items: [{ productId: product, unitId: null, quantity: 1, rate: 130, discount: 0, batchNo: null, expiryDate: null }] }) })));
    const s2 = await sale(1, 0);
    const s2Id = voucherIdOf(s2.redirect);
    const del = await call(() => deleteVoucherAction(s2Id, null, new FormData()));
    expect(del.redirect).toBeTruthy();
    await drain();
    expect((await smsFor(voucherIdOf(pay.redirect)))[0]).toMatchObject({ event: "PAYMENT_RECEIVED", status: "SENT", recipient: customer.mobile });
    expect((await smsFor(voucherIdOf(ret.redirect)))[0]).toMatchObject({ event: "SALES_RETURN", status: "SENT" });
    const cancel = await prisma.smsMessage.findFirstOrThrow({ where: { businessId: A.ctx.business.id, event: "INVOICE_CANCELLED" } });
    expect(cancel).toMatchObject({ status: "SENT", recipient: customer.mobile });
    expect(cancel.body).toContain("বাতিল");
    expect(cancel.voucherNo).toMatch(/INV-/);
  });

  it("supplier SMS: purchase, purchase return and supplier payment", async () => {
    const date = today().toISOString().slice(0, 10);
    const pur = await call(() => saveVoucherAction("PURCHASE", null, null, form({ payload: JSON.stringify({ date, reference: null, narration: null, partyAccountId: supplier.accountId, warehouseId: null, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0, payments: [], items: [{ productId: product, unitId: null, quantity: 10, rate: 100, discount: 0, batchNo: null, expiryDate: null }] }) })));
    const purId = voucherIdOf(pur.redirect);
    const pret = await call(() => saveVoucherAction("PURCHASE_RETURN", null, null, form({ payload: JSON.stringify({ date, reference: null, narration: null, partyAccountId: supplier.accountId, warehouseId: null, returnOfId: purId, dueDate: null, discount: 0, vatPercent: 0, payments: [], items: [{ productId: product, unitId: null, quantity: 2, rate: 100, discount: 0, batchNo: null, expiryDate: null }] }) })));
    const pay = await call(() => saveVoucherAction("PAYMENT", null, null, form({ payload: JSON.stringify({ date, reference: null, narration: null, cashAccountId: cash, lines: [{ accountId: supplier.accountId, amount: 300, narration: null }] }) })));
    await drain();
    const p = (await smsFor(purId))[0];
    expect(p).toMatchObject({ event: "PURCHASE", recipient: supplier.mobile, status: "SENT", supplierId: supplier.id });
    expect(p.body).toContain("১,০০০");
    expect((await smsFor(voucherIdOf(pret.redirect)))[0]).toMatchObject({ event: "PURCHASE_RETURN", status: "SENT" });
    const sp = (await smsFor(voucherIdOf(pay.redirect)))[0];
    expect(sp).toMatchObject({ event: "SUPPLIER_PAYMENT", status: "SENT" });
    expect(sp.body).toContain("৫০০"); // remaining payable 800 − 300
  });

  it("customised templates are used", async () => {
    expect((await saveSmsTemplateAction("SALE_INVOICE", null, form({ body: "ধন্যবাদ {customer_name}! বিল {invoice_no}, বাকি {due}" })))?.ok).toBe(true);
    const r = await sale(1, 130);
    await drain();
    expect((await smsFor(voucherIdOf(r.redirect)))[0].body).toMatch(/^ধন্যবাদ রহিম! বিল INV-\d{6}, বাকি /);
  });

  it("daily: due reminder (once per period), supplier due, low stock and expiry alerts at 90/60/30/15/7 days", async () => {
    const biz = A.ctx.business.id;
    // overdue invoice (due yesterday) for a second customer
    const om = freshMobile();
    const late = await saveParty(A.ctx.svc, "CUSTOMER", { name: "দেরি", mobile: om, email: null, address: null, notes: null, openingBalance: 0, creditLimit: 0, creditDays: 0 });
    await call(() => saveVoucherAction("SALES", null, null, form({ payload: JSON.stringify({ date: day(-10).toISOString().slice(0, 10), reference: null, narration: null, partyAccountId: late.accountId, warehouseId: null, returnOfId: null, dueDate: day(-1).toISOString().slice(0, 10), discount: 0, vatPercent: 0, payments: [], items: [{ productId: product, unitId: null, quantity: 1, rate: 130, discount: 0, batchNo: null, expiryDate: null }] }) })));
    // batch-tracked product with lots at different distances from expiry
    const unit = await prisma.unit.findFirstOrThrow({ where: { businessId: biz, name: "পিস" } });
    const med = await saveProduct(A.ctx.svc, { name: "নাপা", code: "NAPA", barcode: null, categoryId: null, brandId: null, unitId: unit.id, purchasePrice: 10, salePrice: 12, wholesalePrice: 0, minStock: 0, openingStock: 0, openingRate: 0, trackBatch: true });
    const lots = [["L5", 5], ["L12", 12], ["L25", 25], ["L50", 50], ["L80", 80], ["L200", 200], ["LX", -3]] as const;
    await call(() => saveVoucherAction("PURCHASE", null, null, form({ payload: JSON.stringify({ date: day(-5).toISOString().slice(0, 10), reference: null, narration: null, partyAccountId: supplier.accountId, warehouseId: null, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0, payments: [], items: lots.map(([b, d]) => ({ productId: med, unitId: null, quantity: 5, rate: 10, discount: 0, batchNo: b, expiryDate: day(d).toISOString().slice(0, 10), mfgDate: null })) }) })));
    // low stock: SUGAR minStock 20 — sell down
    const stock = Number((await prisma.product.findUniqueOrThrow({ where: { id: product } })).stock);
    if (stock > 20) await sale(stock - 15, (stock - 15) * 130);

    await runDailyChecks(biz, { today: today(), force: true });
    await drain();
    const owner = A.ownerMobile; // alerts go to the business mobile by default
    const got = await prisma.smsMessage.findMany({ where: { businessId: biz, createdAt: { gte: new Date(Date.now() - 60_000) } } });
    const due = got.filter((m) => m.event === "DUE_REMINDER");
    expect(due.map((m) => m.recipient)).toContain(om);
    expect(due.find((m) => m.recipient === om)!.body).toContain("১৩০");
    expect(got.some((m) => m.event === "SUPPLIER_DUE" && m.recipient === supplier.mobile)).toBe(true);
    expect(got.some((m) => m.event === "LOW_STOCK" && m.recipient === owner && m.body.includes("চিনি"))).toBe(true);
    const exp = got.filter((m) => m.event === "EXPIRY_WARNING" && m.recipient === owner).map((m) => m.dedupeKey!.split(":")[3]).sort();
    expect(exp).toEqual(["d15", "d30", "d60", "d7", "d90"].sort()); // L5→7, L12→15, L25→30, L50→60, L80→90; L200 none
    expect(got.some((m) => m.event === "EXPIRED" && m.body.includes("LX"))).toBe(true);

    // running again the same day / within the reminder period sends nothing new
    const count = await prisma.smsMessage.count({ where: { businessId: biz } });
    await runDailyChecks(biz, { today: today(), force: true });
    await runDailyChecks(biz, { today: day(1), force: true });
    const newer = await prisma.smsMessage.findMany({ where: { businessId: biz }, orderBy: { createdAt: "desc" }, take: (await prisma.smsMessage.count({ where: { businessId: biz } })) - count });
    // the customer reminded yesterday is not reminded again within the period; stock / expiry alerts are not repeated
    // (a customer whose invoice only became overdue today legitimately gets a first reminder)
    expect(newer.filter((m) => m.event === "DUE_REMINDER" && m.recipient === om)).toEqual([]);
    expect(newer.filter((m) => m.event === "LOW_STOCK" || m.event === "EXPIRED" || m.event === "EXPIRY_WARNING").map((m) => m.dedupeKey)).toEqual([]);
    // and a week later the overdue customer is reminded again
    await runDailyChecks(biz, { today: day(7), force: true });
    expect(await prisma.smsMessage.count({ where: { businessId: biz, event: "DUE_REMINDER", recipient: om } })).toBe(2);
  });

  it("delivery reports: polling and webhook move SENT → DELIVERED", async () => {
    const m = await prisma.smsMessage.findFirstOrThrow({ where: { businessId: A.ctx.business.id, status: "SENT" } });
    gw.delivered.add(m.requestId!);
    // round-robin polling: every pending message is reached within a bounded number of rounds,
    // however many older unconfirmed messages exist
    const pending = await prisma.smsMessage.count({ where: { status: "SENT", sentAt: { gte: new Date(Date.now() - 2 * 86_400_000) } } });
    let rounds = 0;
    while ((await prisma.smsMessage.findUniqueOrThrow({ where: { id: m.id } })).status !== "DELIVERED" && rounds <= Math.ceil(pending / 200) + 1) {
      await refreshDeliveryStatus(prisma);
      rounds++;
    }
    expect((await prisma.smsMessage.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("DELIVERED");
    expect(rounds).toBeLessThanOrEqual(Math.ceil(pending / 200) + 1);

    const m2 = await prisma.smsMessage.findFirstOrThrow({ where: { businessId: A.ctx.business.id, status: "SENT" } });
    process.env.SMS_WEBHOOK_SECRET = "dlr-secret-0123456789";
    expect((await dlrGet(new Request(`http://x/api/sms/dlr?token=wrong-secret-01234567&message_id=${m2.requestId}&status=DELIVRD`))).status).toBe(401);
    const ok = await dlrGet(new Request(`http://x/api/sms/dlr?token=dlr-secret-0123456789&message_id=${m2.requestId}&status=DELIVRD`));
    expect(await ok.json()).toEqual({ ok: true, updated: 1 });
    const after = await prisma.smsMessage.findUniqueOrThrow({ where: { id: m2.id } });
    expect(after.status).toBe("DELIVERED");
    expect(after.deliveredAt).not.toBeNull();
  });

  it("manual SMS: single customer, selected customers, group and segment — with confirmation, dedupe and logging", async () => {
    const biz = A.ctx.business.id;
    await prisma.customer.update({ where: { id: customer.id }, data: { groupName: "পাইকারি" } });
    const msg = "প্রিয় {customer_name}, নতুন অফার! — {business_name}";
    // wrong confirmation count is refused
    const bad = await sendManualSmsAction(null, form({ targetKind: "customers", customerIds: customer.id, message: msg, confirmCount: "9" }));
    expect(bad?.ok).toBe(false);
    const one = await sendManualSmsAction(null, form({ targetKind: "customers", customerIds: customer.id, message: msg, confirmCount: "1" }));
    expect(one?.message).toContain("১ টি");
    // the same text to the same number on the same day is not sent again
    const dup = await sendManualSmsAction(null, form({ targetKind: "customers", customerIds: customer.id, message: msg, confirmCount: "1" }));
    expect(dup?.message).toContain("আগেই পাঠানো");
    const group = await sendManualSmsAction(null, form({ targetKind: "group", group: "পাইকারি", message: "গ্রুপ বার্তা {customer_name}", confirmCount: "1" }));
    expect(group?.ok).toBe(true);
    const allCount = await prisma.customer.count({ where: { businessId: biz, isActive: true } });
    const seg = await sendManualSmsAction(null, form({ targetKind: "segment", segment: "all", message: "সবার জন্য বার্তা", confirmCount: String(allCount) }));
    expect(seg?.ok).toBe(true);
    await drain();
    const manual = await prisma.smsMessage.findMany({ where: { businessId: biz, event: "MANUAL", body: { contains: "অফার" } } });
    expect(manual.length).toBe(1);
    expect(manual[0].body).toContain("রহিম");
    expect(await prisma.auditLog.count({ where: { businessId: biz, entity: { in: ["Sms", "BulkSms"] } } })).toBeGreaterThanOrEqual(3);
  });

  it("permissions: Salesperson may send to one customer but not bulk, not settings, not retry", async () => {
    const biz = A.ctx.business.id;
    const role = await prisma.role.findFirstOrThrow({ where: { businessId: biz, name: "বিক্রয়কর্মী (Salesperson)" } });
    const user = await prisma.user.create({ data: { name: "সেলস", mobile: freshMobile(), passwordHash: "x" } });
    await prisma.membership.create({ data: { userId: user.id, businessId: biz, roleId: role.id } });
    const s = await createSession(prisma, user.id);
    req.cookies = new Map([[SESSION_COOKIE, await createSessionToken(user.id, s.id)], [BUSINESS_COOKIE, biz]]);
    expect((await sendManualSmsAction(null, form({ targetKind: "customers", customerIds: customer.id, message: "একক বার্তা {customer_name}", confirmCount: "1" })))?.ok).toBe(true);
    const bulk = await sendManualSmsAction(null, form({ targetKind: "segment", segment: "all", message: "বাল্ক", confirmCount: "1" }));
    expect(bulk?.ok).toBe(false);
    expect((await saveSmsSettingsAction(null, form({ enabled: "on", provider: "mock", events: [], alertMobiles: "", lowBalanceThreshold: "0", dueReminderEveryDays: "7" })))?.ok).toBe(false);
    const failed = await prisma.smsMessage.findFirstOrThrow({ where: { businessId: biz, status: "FAILED" } }).catch(() => null);
    if (failed) expect((await retrySmsAction(failed.id))?.ok).toBe(false);
  });

  it("multi-business isolation: B cannot see, retry or reuse A's SMS, settings or customers", async () => {
    const B = await newBusiness("অন্য ব্যবসা");
    useSession(B.cookies);
    expect(await prisma.smsSettings.findUnique({ where: { businessId: B.ctx.business.id } })).toBeNull();
    // B's SMS is off, so a test SMS is refused; A's settings are untouched
    expect((await sendTestSmsAction(null, form({ testMobile: freshMobile() })))?.ok).toBe(false);
    expect((await prisma.smsSettings.findUniqueOrThrow({ where: { businessId: A.ctx.business.id } })).enabled).toBe(true);
    await enableSms();
    const aMsg = await prisma.smsMessage.findFirstOrThrow({ where: { businessId: A.ctx.business.id, status: { in: ["SENT", "DELIVERED"] } } });
    const aFailed = await prisma.smsMessage.findFirst({ where: { businessId: A.ctx.business.id, status: "FAILED" } });
    if (aFailed) expect((await retrySmsAction(aFailed.id))?.ok).toBe(false);
    // A's customer id used from B → no recipient found
    const r = await sendManualSmsAction(null, form({ targetKind: "customers", customerIds: customer.id, message: "x", confirmCount: "0" }));
    expect(r?.ok).toBe(false);
    expect(await prisma.smsMessage.count({ where: { businessId: B.ctx.business.id, customerId: customer.id } })).toBe(0);
    expect(aMsg.businessId).toBe(A.ctx.business.id);
    // B's own settings hold B's own key
    expect((await prisma.smsSettings.findUniqueOrThrow({ where: { businessId: B.ctx.business.id } })).apiKeyEnc).not.toBe((await prisma.smsSettings.findUniqueOrThrow({ where: { businessId: A.ctx.business.id } })).apiKeyEnc);
  });

  it("SMS switched off → no automatic SMS, sales still work", async () => {
    useSession(A.cookies);
    await saveSmsSettingsAction(null, form({ provider: "test", events: [], alertMobiles: "", lowBalanceThreshold: "0", dueReminderEveryDays: "7" }));
    const r = await sale(1, 130);
    expect(r.redirect).toMatch(/^\/vouchers\/v\//);
    expect((await smsFor(voucherIdOf(r.redirect))).length).toBe(0);
    await enableSms();
  });
});

run("OTP and security SMS", () => {
  beforeAll(() => {
    process.env.AUTH_SECRET ??= "test-secret-for-vitest-only-0123456789abcdef";
    process.env.SMS_PROVIDER = "test";
    process.env.REGISTRATION_HOURLY_LIMIT = "100000";
  });
  beforeEach(() => {
    gw.mode = "ok";
    req.cookies.clear();
    req.headers = new Headers({ "user-agent": "vitest" });
  });

  it("OTP: random 6 digits, stored only as a hash, expires, single use, limited attempts", async () => {
    const mobile = freshMobile();
    const t0 = new Date();
    await issueOtp(prisma, "LOGIN", mobile, {}, t0);
    const code = lastCode(mobile);
    expect(code).toMatch(/^\d{6}$/);
    const row = await prisma.smsOtp.findFirstOrThrow({ where: { mobile, purpose: "LOGIN" }, orderBy: { createdAt: "desc" } });
    expect(row.codeHash).not.toContain(code);
    const log = await prisma.smsMessage.findFirstOrThrow({ where: { recipient: mobile, event: "LOGIN_OTP" } });
    expect(log.body).not.toContain(code); // the log keeps a redacted text
    expect(log.status).toBe("SENT");

    expect(await verifyOtp(prisma, "PASSWORD_RESET", mobile, code)).toBe(false); // bound to its purpose
    expect(await verifyOtp(prisma, "LOGIN", mobile, code)).toBe(true);
    expect(await verifyOtp(prisma, "LOGIN", mobile, code)).toBe(false); // used once

    // expiry
    const m2 = freshMobile();
    await issueOtp(prisma, "LOGIN", m2);
    expect(await verifyOtp(prisma, "LOGIN", m2, lastCode(m2), new Date(Date.now() + 6 * 60_000))).toBe(false);

    // 5 wrong tries kill the code even if the right one comes next
    const m3 = freshMobile();
    await issueOtp(prisma, "LOGIN", m3);
    const right = lastCode(m3);
    for (let i = 0; i < 5; i++) expect(await verifyOtp(prisma, "LOGIN", m3, right === "000000" ? "111111" : "000000")).toBe(false);
    expect(await verifyOtp(prisma, "LOGIN", m3, right)).toBe(false);
  });

  it("OTP rate limits: 60 s resend cooldown and 3 codes per 15 minutes per number", async () => {
    const mobile = freshMobile();
    const t = Date.now();
    await issueOtp(prisma, "REGISTRATION", mobile, {}, new Date(t));
    await expect(issueOtp(prisma, "REGISTRATION", mobile, {}, new Date(t + 10_000))).rejects.toThrow(/অপেক্ষা/);
    await issueOtp(prisma, "REGISTRATION", mobile, {}, new Date(t + 61_000));
    await issueOtp(prisma, "REGISTRATION", mobile, {}, new Date(t + 122_000));
    await expect(issueOtp(prisma, "REGISTRATION", mobile, {}, new Date(t + 183_000))).rejects.toThrow(/অনেকবার/);
  });

  it("registration requires the SMS code when SMS is configured", async () => {
    const mobile = freshMobile();
    const fields = { businessName: "ওটিপি দোকান", ownerName: "মালিক", mobile, email: "", password: PASSWORD, confirmPassword: PASSWORD };
    const noCode = await call(() => registerAction(null, form({ ...fields, otp: "123456" })));
    expect(noCode.value?.errors?.otp?.[0]).toContain("কোড");
    expect((await requestRegistrationOtpAction(null, form({ mobile })))?.ok).toBe(true);
    const ok = await call(() => registerAction(null, form({ ...fields, otp: lastCode(mobile) })));
    expect(ok.redirect).toBe("/dashboard");
    expect(await prisma.user.count({ where: { mobile } })).toBe(1);
  });

  it("login OTP (when enabled) and new-login alert", async () => {
    const mobile = freshMobile();
    await requestRegistrationOtpAction(null, form({ mobile }));
    await call(() => registerAction(null, form({ businessName: "লগইন ওটিপি", ownerName: "মালিক", mobile, email: "", password: PASSWORD, confirmPassword: PASSWORD, otp: lastCode(mobile) })));
    await prisma.user.update({ where: { mobile }, data: { loginOtpEnabled: true, loginAlertEnabled: true } });
    req.cookies.clear();

    const step1 = await call(() => loginAction(null, form({ email: mobile, password: PASSWORD, next: "/dashboard" })));
    expect(step1.redirect).toBeNull(); // no session yet
    expect(step1.value?.data?.step).toBe("otp");
    expect(await getCurrentUser()).toBeNull();
    const challenge = step1.value!.data!.challenge;
    const wrong = await call(() => loginAction(null, form({ challenge, otp: "000001", next: "/dashboard" })));
    expect(wrong.value?.errors?.otp?.[0]).toContain("সঠিক নয়");
    const step2 = await call(() => loginAction(null, form({ challenge, otp: lastCode(mobile), next: "/dashboard" })));
    expect(step2.redirect).toBe("/dashboard");
    expect((await getCurrentUser())?.mobile).toBe(mobile);
    // a forged challenge is refused
    const forged = await call(() => loginAction(null, form({ challenge: "eyJhbGciOiJIUzI1NiJ9.e30.x", otp: "123456", next: "/dashboard" })));
    expect(forged.value?.ok).toBe(false);

    await drain();
    const alert = await prisma.smsMessage.findFirstOrThrow({ where: { recipient: mobile, event: "NEW_LOGIN_ALERT" } });
    expect(alert.status).toBe("SENT");
    expect(alert.body).toContain("নতুন লগইন");
  });

  it("password reset by SMS: generic answer, new password works, all sessions end", async () => {
    const mobile = freshMobile();
    await requestRegistrationOtpAction(null, form({ mobile }));
    await call(() => registerAction(null, form({ businessName: "রিসেট", ownerName: "মালিক", mobile, email: "", password: PASSWORD, confirmPassword: PASSWORD, otp: lastCode(mobile) })));
    const oldCookies = new Map(req.cookies);
    req.cookies.clear();

    const unknown = await requestPasswordResetAction(null, form({ mobile: freshMobile() }));
    const known = await requestPasswordResetAction(null, form({ mobile }));
    expect(unknown?.message).toBe(known?.message); // no account enumeration
    const bad = await call(() => resetPasswordAction(null, form({ mobile, otp: "000000", newPassword: "Naya-Pass-2026", confirmPassword: "Naya-Pass-2026" })));
    expect(bad.value?.ok).toBe(false);
    const done = await call(() => resetPasswordAction(null, form({ mobile, otp: lastCode(mobile), newPassword: "Naya-Pass-2026", confirmPassword: "Naya-Pass-2026" })));
    expect(done.redirect).toBe("/login");

    useSession(oldCookies);
    expect(await getCurrentUser()).toBeNull(); // the earlier session was revoked
    req.cookies.clear();
    expect((await call(() => loginAction(null, form({ email: mobile, password: PASSWORD, next: "/dashboard" })))).value?.message).toContain("সঠিক নয়");
    expect((await call(() => loginAction(null, form({ email: mobile, password: "Naya-Pass-2026", next: "/dashboard" })))).redirect).toBe("/dashboard");
  });

  it("security SMS never store the code in the queue/log and failed sending is reported", async () => {
    gw.mode = "temporary";
    const mobile = freshMobile();
    await expect(issueOtp(prisma, "LOGIN", mobile)).rejects.toThrow(/পাঠানো যায়নি/);
    const log = await prisma.smsMessage.findFirstOrThrow({ where: { recipient: mobile, event: "LOGIN_OTP" } });
    expect(log.status).toBe("FAILED");
    expect(await prisma.smsOtp.count({ where: { mobile, consumedAt: null } })).toBe(0); // the unsent code cannot be used
  });
});
