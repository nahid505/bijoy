// SubscriptionService — plans, trials, entitlement, renewals, expiry and payment finalisation.
// Plain Prisma (no Next.js imports): used by registration, the seed, the scheduler, server actions,
// payment callbacks and the Super Admin panel. All writes that change money or access run in one
// transaction and leave a SubscriptionEvent (history) behind.
import type { BillingCycle, Prisma, PrismaClient } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { formatDate, formatMoney, toBnDigits } from "@/lib/format";
import {
  addDays, daysUntil, effectiveStatus, entitledFeatures, invoiceAmounts, nextPeriod, planChangeKind, planPrice, startOfDay,
  type Cycle, type Effective,
} from "@/lib/subscription";
import { notifyBusiness } from "./billing-notify";
import { intList } from "@/lib/dialect";

type Db = PrismaClient | Prisma.TransactionClient;
const TX = { timeout: 60_000, maxWait: 10_000 };

// ───────────────────────── settings & plans ─────────────────────────

export async function platformSettings(db: Db = prisma) {
  const s = await db.platformSetting.upsert({ where: { id: "platform" }, create: { id: "platform" }, update: {} });
  const reminderDays = intList(s.reminderDays, [7, 3, 1]);
  return { ...s, reminderDays, vatPercent: num(s.vatPercent), reminderWindow: Math.max(0, ...reminderDays, 0) };
}

export async function planByCode(db: Db, code: string) {
  return db.plan.findUnique({ where: { code }, include: { features: { select: { featureKey: true } } } });
}

export const planView = (p: { priceMonthly: unknown; priceYearly: unknown }) => ({ priceMonthly: num(p.priceMonthly as never), priceYearly: num(p.priceYearly as never) });

// ───────────────────────── start ─────────────────────────

/**
 * Starts the subscription of a new business: a paid plan (or the platform's trial plan) as a trial
 * of `trialDays`, or the free plan without an end date. Idempotent: an existing subscription stays.
 */
export async function startSubscription(tx: Db, businessId: string, opts: { planCode?: string | null; actorUserId?: string | null; now?: Date } = {}) {
  const existing = await tx.subscription.findUnique({ where: { businessId } });
  if (existing) return existing;
  const now = opts.now ?? new Date();
  const s = await platformSettings(tx);
  const wanted = opts.planCode ? await tx.plan.findFirst({ where: { code: opts.planCode, isActive: true, isPublic: true } }) : null;
  const plan = wanted ?? (await tx.plan.findUnique({ where: { code: s.trialPlanCode } })) ?? (await tx.plan.findFirst({ where: { isActive: true }, orderBy: { sortOrder: "desc" } }));
  if (!plan) throw new Error("No subscription plans configured");
  const free = num(plan.priceMonthly) === 0 && num(plan.priceYearly) === 0;
  const trialEnd = free ? null : addDays(startOfDay(now), s.trialDays);
  const sub = await tx.subscription.create({
    data: { businessId, planId: plan.id, status: free ? "ACTIVE" : "TRIAL", billingCycle: "MONTHLY", startDate: startOfDay(now), endDate: trialEnd, trialEndsAt: trialEnd },
  });
  await tx.subscriptionEvent.create({
    data: { businessId, subscriptionId: sub.id, type: free ? "CREATED" : "TRIAL_STARTED", toPlanCode: plan.code, toStatus: sub.status, actorUserId: opts.actorUserId ?? null, details: trialEnd ? { trialEndsAt: trialEnd.toISOString(), trialDays: s.trialDays } : undefined },
  });
  await notifyBusiness(tx, businessId, {
    kind: "TRIAL_STARTED", key: `sub:${sub.id}:started`,
    title: free ? `রেজিস্ট্রেশন সফল — ${plan.nameBn} প্ল্যান` : `রেজিস্ট্রেশন সফল — ${toBnDigits(s.trialDays)} দিনের ফ্রি ট্রায়াল শুরু`,
    message: trialEnd ? `${plan.nameBn} প্ল্যানের সব ফিচার ${formatDate(trialEnd)} পর্যন্ত ফ্রি ব্যবহার করুন। এরপর প্ল্যান নির্বাচন করে পেমেন্ট করলে সব চালু থাকবে।` : `${plan.nameBn} প্ল্যান চালু হয়েছে।`,
    link: "/billing",
  });
  return sub;
}

// ───────────────────────── state & entitlement ─────────────────────────

export async function subscriptionState(businessId: string, now = new Date(), db: Db = prisma) {
  const [sub, s] = await Promise.all([
    db.subscription.findUnique({ where: { businessId }, include: { plan: { include: { features: { select: { featureKey: true } } } } } }),
    platformSettings(db),
  ]);
  if (!sub) return null;
  const effective = effectiveStatus({ status: sub.status, endDate: sub.endDate, trialEndsAt: sub.trialEndsAt }, now, { graceDays: s.graceDays, reminderDays: s.reminderWindow });
  return { sub, plan: sub.plan, effective, settings: s };
}

/**
 * Features the business may use right now (plan or fallback plan, super-admin overrides). A business
 * without a subscription (should not happen after the migration) gets the fallback plan only.
 */
export async function entitlements(businessId: string, now = new Date()): Promise<{ keys: Set<string>; effective: Effective | null }> {
  const [state, overrides] = await Promise.all([
    subscriptionState(businessId, now),
    prisma.businessFeature.findMany({ where: { businessId, adminOverride: { not: null } }, select: { featureKey: true, adminOverride: true } }),
  ]);
  const s = state?.settings ?? (await platformSettings());
  const fallback = await planByCode(prisma, s.fallbackPlanCode);
  const effective: Effective = state?.effective ?? { status: "EXPIRED", planAccess: false, blocked: false, inGrace: false, accessUntil: null, daysLeft: null };
  const keys = entitledFeatures({
    effective,
    planFeatures: state?.plan.features.map((f) => f.featureKey) ?? [],
    fallbackFeatures: fallback?.features.map((f) => f.featureKey) ?? [],
    overrides: new Map(overrides.map((o) => [o.featureKey, o.adminOverride!])),
  });
  return { keys, effective: state ? effective : null };
}

/** Active members against the plan's user limit (null = unlimited). */
export async function userUsage(businessId: string, db: Db = prisma) {
  const [state, used] = await Promise.all([subscriptionState(businessId, new Date(), db), db.membership.count({ where: { businessId, isActive: true } })]);
  const limit = state ? (state.effective.planAccess ? state.plan.userLimit : (await planByCode(db, state.settings.fallbackPlanCode))?.userLimit ?? 1) : 1;
  return { used, limit };
}

export async function assertUserSlot(businessId: string, db: Db = prisma) {
  const { used, limit } = await userUsage(businessId, db);
  if (limit !== null && used >= limit) {
    throw new UserError(`আপনার প্ল্যানে সর্বোচ্চ ${toBnDigits(limit)} জন ব্যবহারকারী — আরও ব্যবহারকারী যোগ করতে প্ল্যান আপগ্রেড করুন`);
  }
}

// ───────────────────────── changes (super admin / free plan) ─────────────────────────

async function event(tx: Db, sub: { id: string; businessId: string }, data: Omit<Prisma.SubscriptionEventUncheckedCreateInput, "subscriptionId" | "businessId">) {
  return tx.subscriptionEvent.create({ data: { ...data, subscriptionId: sub.id, businessId: sub.businessId } });
}

/** Moves a business to another plan without payment (super admin, or a switch to a free plan). */
export async function changePlan(businessId: string, planId: string, opts: { cycle?: Cycle; endDate?: Date | null; actorUserId: string; note?: string | null; now?: Date }) {
  const now = opts.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { businessId }, include: { plan: true } });
    if (!sub) throw new UserError("সাবস্ক্রিপশন পাওয়া যায়নি");
    const plan = await tx.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new UserError("প্ল্যান পাওয়া যায়নি");
    const free = num(plan.priceMonthly) === 0 && num(plan.priceYearly) === 0;
    const endDate = opts.endDate !== undefined ? opts.endDate : free ? null : sub.endDate && sub.endDate > now ? sub.endDate : addDays(startOfDay(now), 30);
    const updated = await tx.subscription.update({
      where: { businessId },
      data: { planId, billingCycle: opts.cycle ?? sub.billingCycle, status: "ACTIVE", endDate, trialEndsAt: null, cancelledAt: null, suspendedAt: null, suspendReason: null, ...(free ? { amount: null } : {}) },
    });
    const kind = planChangeKind(planView(sub.plan), planView(plan));
    await event(tx, sub, { type: kind, fromPlanCode: sub.plan.code, toPlanCode: plan.code, fromStatus: sub.status, toStatus: "ACTIVE", actorUserId: opts.actorUserId, note: opts.note ?? null, details: { endDate: endDate?.toISOString() ?? null } });
    await notifyBusiness(tx, businessId, { kind: "PLAN_CHANGED", key: `plan:${updated.id}:${Date.now()}`, title: `${kind === "UPGRADED" ? "প্ল্যান আপগ্রেড" : kind === "DOWNGRADED" ? "প্ল্যান ডাউনগ্রেড" : "প্ল্যান পরিবর্তন"}: ${plan.nameBn}`, message: `${sub.plan.nameBn} → ${plan.nameBn}${endDate ? ` (মেয়াদ ${formatDate(endDate)} পর্যন্ত)` : ""}`, link: "/billing" });
    return updated;
  }, TX);
}

export async function extendSubscription(businessId: string, days: number, opts: { actorUserId: string; note?: string | null; now?: Date }) {
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new UserError("১ থেকে ৩৬৫০ দিনের মধ্যে দিন");
  const now = opts.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { businessId } });
    if (!sub) throw new UserError("সাবস্ক্রিপশন পাওয়া যায়নি");
    const base = sub.status === "TRIAL" ? sub.trialEndsAt ?? sub.endDate : sub.endDate;
    const from = base && base > now ? base : startOfDay(now);
    const end = addDays(from, days);
    const updated = await tx.subscription.update({
      where: { businessId },
      data: sub.status === "TRIAL" ? { endDate: end, trialEndsAt: end } : { endDate: end, status: sub.status === "EXPIRED" ? "ACTIVE" : sub.status },
    });
    await event(tx, sub, { type: "EXTENDED", fromStatus: sub.status, toStatus: updated.status, actorUserId: opts.actorUserId, note: opts.note ?? null, details: { days, from: base?.toISOString() ?? null, to: end.toISOString() } });
    return updated;
  }, TX);
}

export async function suspendSubscription(businessId: string, suspend: boolean, opts: { actorUserId: string; reason?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { businessId } });
    if (!sub) throw new UserError("সাবস্ক্রিপশন পাওয়া যায়নি");
    if (suspend === (sub.status === "SUSPENDED")) throw new UserError(suspend ? "ইতিমধ্যে স্থগিত" : "স্থগিত নয়");
    // on resume the stored status returns to what the dates say (trial / active / expired)
    const resumed = sub.trialEndsAt && sub.trialEndsAt > new Date() ? "TRIAL" : sub.endDate && sub.endDate <= new Date() ? "EXPIRED" : "ACTIVE";
    const updated = await tx.subscription.update({
      where: { businessId },
      data: suspend ? { status: "SUSPENDED", suspendedAt: new Date(), suspendReason: opts.reason ?? null } : { status: resumed, suspendedAt: null, suspendReason: null },
    });
    await event(tx, sub, { type: suspend ? "SUSPENDED" : "RESUMED", fromStatus: sub.status, toStatus: updated.status, actorUserId: opts.actorUserId, note: opts.reason ?? null });
    return updated;
  }, TX);
}

/** Company side: turn automatic renewal on/off (cancel = will not renew, access until the end). */
export async function setAutoRenew(businessId: string, autoRenew: boolean, actorUserId: string) {
  return prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { businessId } });
    if (!sub) throw new UserError("সাবস্ক্রিপশন পাওয়া যায়নি");
    const updated = await tx.subscription.update({ where: { businessId }, data: { autoRenew, ...(autoRenew ? { cancelledAt: null } : {}) } });
    await event(tx, sub, { type: autoRenew ? "AUTO_RENEW_ON" : "AUTO_RENEW_OFF", actorUserId });
    return updated;
  }, TX);
}

// ───────────────────────── payments ─────────────────────────

async function nextInvoiceNumber(tx: Db, now: Date) {
  const s = await tx.platformSetting.update({ where: { id: "platform" }, data: { invoiceSeq: { increment: 1 } } });
  return `${s.invoicePrefix}-${now.getUTCFullYear()}-${String(s.invoiceSeq).padStart(6, "0")}`;
}

/** Amount (VAT included) of a plan for a cycle, from the database. */
export async function checkoutAmounts(planId: string, cycle: Cycle, db: Db = prisma) {
  const [plan, s] = await Promise.all([db.plan.findUnique({ where: { id: planId } }), platformSettings(db)]);
  if (!plan || !plan.isActive) throw new UserError("প্ল্যানটি এখন নেওয়া যাচ্ছে না");
  const price = planPrice(planView(plan), cycle);
  return { plan, ...invoiceAmounts(price, 0, s.vatPercent), currency: s.currency };
}

export interface VerifiedPayment {
  providerTrxId: string | null;
  providerPaymentId?: string | null;
  amount: number;
  raw?: Prisma.InputJsonValue;
}

/**
 * Applies a VERIFIED payment exactly once: transaction → SUCCESS, subscription period extended / plan
 * switched, SubscriptionPayment + Invoice created, event + notification. A second callback for the same
 * transaction is a no-op; a gateway transaction id can be used only once (unique index).
 */
export async function finalizePayment(transactionId: string, v: VerifiedPayment, opts: { verifiedById?: string | null; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const r = await prisma.$transaction(async (tx) => {
    const t = await tx.paymentTransaction.findUnique({ where: { id: transactionId }, include: { plan: true, business: true } });
    if (!t) throw new UserError("লেনদেন পাওয়া যায়নি");
    if (t.status === "SUCCESS") return { already: true, transaction: t };
    if (t.status !== "INITIATED" && t.status !== "PENDING") throw new UserError("এই লেনদেন আর পরিশোধযোগ্য নয়");
    // recorded as FAILED after this transaction (a throw here would roll the record back)
    if (!(Math.abs(v.amount - num(t.amount)) <= 0.009)) return { mismatch: `amount mismatch: paid ${v.amount}, expected ${num(t.amount)}` } as const;
    // a gateway transaction id pays for one transaction only (replayed / forged receipts)
    if (v.providerTrxId && (await tx.paymentTransaction.findFirst({ where: { provider: t.provider, providerTrxId: v.providerTrxId, id: { not: t.id } }, select: { id: true } }))) {
      return { mismatch: `duplicate gateway transaction id ${v.providerTrxId}`, duplicate: true } as const;
    }
    // compare-and-set: only one concurrent callback can move it to SUCCESS
    const won = await tx.paymentTransaction.updateMany({
      where: { id: t.id, status: { in: ["INITIATED", "PENDING"] } },
      data: { status: "SUCCESS", providerTrxId: v.providerTrxId, providerPaymentId: v.providerPaymentId ?? t.providerPaymentId, raw: v.raw, completedAt: now, verifiedById: opts.verifiedById ?? null },
    });
    if (won.count === 0) return { already: true, transaction: t };

    const sub = await tx.subscription.findUniqueOrThrow({ where: { businessId: t.businessId }, include: { plan: true } });
    const period = nextPeriod({ status: sub.status, endDate: sub.endDate, planId: sub.planId, trial: sub.status === "TRIAL" }, t.planId, t.billingCycle, now);
    const s = await platformSettings(tx);
    const price = planPrice(planView(t.plan), t.billingCycle);
    const amounts = invoiceAmounts(price, 0, s.vatPercent);
    const b = t.business;
    const invoice = await tx.invoice.create({
      data: {
        number: await nextInvoiceNumber(tx, now), businessId: t.businessId, planId: t.planId, billingCycle: t.billingCycle, periodStart: period.start, periodEnd: period.end,
        subtotal: amounts.subtotal, discount: amounts.discount, vatPercent: amounts.vatPercent, vatAmount: amounts.vatAmount, total: num(t.amount), status: "PAID",
        paymentMethod: t.provider, transactionRef: v.providerTrxId ?? t.manualReference, paidAt: now,
        billTo: { name: b.name, address: b.address, mobile: b.mobile, email: b.email, binNumber: b.binNumber, tinNumber: b.tinNumber },
      },
    });
    await tx.subscriptionPayment.create({ data: { businessId: t.businessId, subscriptionId: sub.id, transactionId: t.id, invoiceId: invoice.id, amount: t.amount, periodStart: period.start, periodEnd: period.end, paidAt: now } });
    await tx.subscription.update({
      where: { id: sub.id },
      data: { planId: t.planId, billingCycle: t.billingCycle, status: "ACTIVE", startDate: period.renewal ? sub.startDate : period.start, endDate: period.end, trialEndsAt: null, cancelledAt: null, amount: t.amount, paymentStatus: "SUCCESS" },
    });
    // first paid period after a trial / an expired or suspended subscription = activation; up/downgrade only between paid periods
    const fresh = sub.status === "TRIAL" || sub.status === "EXPIRED" || sub.status === "SUSPENDED" || !sub.endDate || sub.endDate <= now;
    const kind = fresh ? "ACTIVATED" : sub.planId === t.planId ? "RENEWED" : planChangeKind(planView(sub.plan), planView(t.plan));
    await event(tx, sub, { type: kind, fromPlanCode: sub.plan.code, toPlanCode: t.plan.code, fromStatus: sub.status, toStatus: "ACTIVE", actorUserId: opts.verifiedById ?? t.initiatedById, details: { transactionId: t.id, invoice: invoice.number, periodEnd: period.end.toISOString() } });
    await notifyBusiness(tx, t.businessId, {
      kind: "PAYMENT_SUCCESS", key: `payment:${t.id}`, title: `পেমেন্ট সফল — ${t.plan.nameBn}`,
      message: `${formatMoney(num(t.amount), "৳")} পরিশোধ হয়েছে (${t.provider}${v.providerTrxId ? `, ${v.providerTrxId}` : ""})। মেয়াদ ${formatDate(period.end)} পর্যন্ত। ইনভয়েস ${invoice.number}।`,
      link: `/billing/invoices/${invoice.id}`, sms: true,
    });
    await tx.auditLog.create({ data: { businessId: t.businessId, userId: opts.verifiedById ?? t.initiatedById, action: "UPDATE", entity: "Payment", entityId: t.id, details: { event: "payment-success", provider: t.provider, trx: v.providerTrxId ?? t.manualReference, amount: num(t.amount), plan: t.plan.code, invoice: invoice.number, subscription: kind } } });
    const label = { ACTIVATED: "সাবস্ক্রিপশন চালু হয়েছে", RENEWED: "সাবস্ক্রিপশন নবায়ন হয়েছে", UPGRADED: "প্ল্যান আপগ্রেড হয়েছে", DOWNGRADED: "প্ল্যান ডাউনগ্রেড হয়েছে", PLAN_CHANGED: "প্ল্যান পরিবর্তন হয়েছে" }[kind] ?? "সাবস্ক্রিপশন চালু হয়েছে";
    await notifyBusiness(tx, t.businessId, {
      kind: "SUBSCRIPTION_ACTIVATED", key: `sub:${sub.id}:active:${t.id}`, title: `${label} — ${t.plan.nameBn}`,
      message: `${t.plan.nameBn} প্ল্যান ${formatDate(period.end)} পর্যন্ত সক্রিয়। প্ল্যানের সব ফিচার চালু হয়েছে।`, link: "/billing",
    });
    return { already: false, transaction: { ...t, status: "SUCCESS" as const }, invoice };
  }, TX);
  if ("mismatch" in r && r.mismatch) {
    await failPayment(transactionId, r.mismatch, { raw: v.raw });
    throw new UserError("duplicate" in r ? "এই ট্রানজেকশন আইডি দিয়ে আগেই পেমেন্ট নেওয়া হয়েছে — পেমেন্ট গ্রহণ করা হয়নি" : "পরিশোধিত টাকা প্রত্যাশিত টাকার সাথে মিলছে না — পেমেন্ট গ্রহণ করা হয়নি");
  }
  return r;
}

export async function failPayment(transactionId: string, reason: string, opts: { raw?: Prisma.InputJsonValue; cancelled?: boolean; actorUserId?: string | null } = {}) {
  return prisma.$transaction(async (tx) => {
    const done = await tx.paymentTransaction.updateMany({
      where: { id: transactionId, status: { in: ["INITIATED", "PENDING"] } },
      data: { status: opts.cancelled ? "CANCELLED" : "FAILED", failureReason: reason.slice(0, 300), raw: opts.raw, verifiedById: opts.actorUserId ?? null, completedAt: new Date() },
    });
    if (done.count === 0) return false;
    const t = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: transactionId }, include: { plan: true } });
    await tx.subscription.updateMany({ where: { businessId: t.businessId }, data: { paymentStatus: opts.cancelled ? "CANCELLED" : "FAILED" } });
    await tx.auditLog.create({ data: { businessId: t.businessId, userId: opts.actorUserId ?? t.initiatedById, action: "UPDATE", entity: "Payment", entityId: t.id, details: { event: opts.cancelled ? "payment-cancelled" : "payment-failed", provider: t.provider, amount: num(t.amount), reason: reason.slice(0, 200) } } });
    await notifyBusiness(tx, t.businessId, { kind: "PAYMENT_FAILED", key: `payment:${t.id}`, title: `পেমেন্ট ${opts.cancelled ? "বাতিল" : "ব্যর্থ"} — ${t.plan.nameBn}`, message: `${formatMoney(num(t.amount), "৳")} পেমেন্ট সম্পন্ন হয়নি: ${reason.slice(0, 120)}`, link: "/billing" });
    return true;
  }, TX);
}

// ───────────────────────── daily check ─────────────────────────

/**
 * Daily per business: reminders 7 / 3 / 1 days before the end (configurable), expired status after
 * the grace period. Idempotent (dedupe keys); never deletes data.
 */
export async function subscriptionDailyCheck(businessId: string, now = new Date()) {
  const state = await subscriptionState(businessId, now);
  if (!state) return { reminded: 0, expired: false };
  const { sub, plan, effective, settings } = state;
  let reminded = 0;
  let expired = false;
  const end = sub.status === "TRIAL" ? sub.trialEndsAt ?? sub.endDate : sub.endDate;
  if (end && (sub.status === "TRIAL" || sub.status === "ACTIVE" || sub.status === "CANCELLED")) {
    const left = daysUntil(now, end);
    for (const d of settings.reminderDays) {
      if (left === d) {
        const created = await notifyBusiness(prisma, businessId, {
          kind: "SUBSCRIPTION_EXPIRING", key: `sub:${sub.id}:${end.toISOString().slice(0, 10)}:d${d}`, severity: d <= 1 ? "CRITICAL" : "WARNING",
          title: `${sub.status === "TRIAL" ? "ট্রায়াল" : "সাবস্ক্রিপশন"} শেষ হবে ${toBnDigits(d)} দিন পর`,
          message: `${plan.nameBn} প্ল্যানের মেয়াদ ${formatDate(end)} তারিখে শেষ হবে। নবায়ন না করলে অতিরিক্ত ফিচার বন্ধ হবে (তথ্য মুছে যাবে না)।`, link: "/billing", sms: true,
        });
        if (created) {
          reminded++;
          await prisma.subscriptionEvent.create({ data: { businessId, subscriptionId: sub.id, type: "REMINDER", details: { daysLeft: d } } });
        }
      }
    }
  }
  if (effective.status === "EXPIRED" && sub.status !== "EXPIRED" && sub.status !== "SUSPENDED") {
    await prisma.$transaction(async (tx) => {
      const moved = await tx.subscription.updateMany({ where: { id: sub.id, status: sub.status }, data: { status: "EXPIRED" } });
      if (!moved.count) return;
      expired = true;
      await event(tx, sub, { type: "EXPIRED", fromStatus: sub.status, toStatus: "EXPIRED", toPlanCode: plan.code });
      await notifyBusiness(tx, businessId, {
        kind: "SUBSCRIPTION_EXPIRED", key: `sub:${sub.id}:expired:${end?.toISOString().slice(0, 10) ?? "x"}`, severity: "CRITICAL",
        title: `${sub.status === "TRIAL" ? "ট্রায়াল" : "সাবস্ক্রিপশন"} এর মেয়াদ শেষ`, message: `${plan.nameBn} প্ল্যানের মেয়াদ শেষ — এখন শুধু ফ্রি প্ল্যানের ফিচার চালু আছে। সব তথ্য সংরক্ষিত আছে; নবায়ন করলে সব ফিরে আসবে।`, link: "/billing", sms: true,
      });
    }, TX);
  }
  // informational notifications older than a week are closed (they stay in history)
  await prisma.notification.updateMany({
    where: { businessId, resolvedAt: null, kind: { in: ["TRIAL_STARTED", "SUBSCRIPTION_ACTIVATED", "PAYMENT_SUCCESS", "PAYMENT_FAILED", "PLAN_CHANGED", "USER_ADDED", "FEATURE_CHANGED"] }, createdAt: { lt: addDays(now, -7) } },
    data: { resolvedAt: now },
  });
  return { reminded, expired };
}

/** Records the period over which a cycle's payments are shown (Super Admin revenue). */
export function cycleLabel(c: BillingCycle) {
  return c === "YEARLY" ? "বার্ষিক" : "মাসিক";
}
