// Super Admin read models and plan / feature administration (platform scope — crosses tenants by
// design, therefore only reachable through assertSuperAdmin / requireSuperAdmin).
import type { Prisma } from "@prisma/client";
import { round2 } from "@/lib/calc";
import { prisma, num } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { FEATURE_KEYS } from "@/lib/features";
import { addDays, effectiveStatus, type SubStatus } from "@/lib/subscription";
import { platformSettings } from "./subscriptions";
import { ci } from "@/lib/dialect";

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export async function platformDashboard(now = new Date()) {
  const settings = await platformSettings();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const [subs, companies, users, activeUsers, monthRev, yearRev, pending, recentBiz, recentPay, payments12, regs12] = await Promise.all([
    prisma.subscription.findMany({ select: { businessId: true, status: true, endDate: true, trialEndsAt: true, plan: { select: { nameBn: true } }, business: { select: { name: true } } } }),
    prisma.business.count(),
    prisma.user.count({ where: { isSuperAdmin: false } }),
    prisma.user.count({ where: { isSuperAdmin: false, isActive: true, lastLoginAt: { gte: addDays(now, -30) } } }),
    prisma.subscriptionPayment.aggregate({ where: { paidAt: { gte: monthStart } }, _sum: { amount: true } }),
    prisma.subscriptionPayment.aggregate({ where: { paidAt: { gte: yearStart } }, _sum: { amount: true } }),
    prisma.paymentTransaction.count({ where: { status: "PENDING" } }),
    prisma.business.findMany({ orderBy: { createdAt: "desc" }, take: 8, select: { id: true, name: true, createdAt: true, businessType: true, subscription: { select: { status: true, plan: { select: { nameBn: true } } } } } }),
    prisma.subscriptionPayment.findMany({ orderBy: { paidAt: "desc" }, take: 8, include: { transaction: { select: { provider: true, providerTrxId: true, manualReference: true, plan: { select: { nameBn: true } } } } } }),
    prisma.subscriptionPayment.findMany({ where: { paidAt: { gte: since } }, select: { paidAt: true, amount: true } }),
    prisma.business.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
  ]);
  const names = new Map((await prisma.business.findMany({ where: { id: { in: recentPay.map((p) => p.businessId) } }, select: { id: true, name: true } })).map((b) => [b.id, b.name]));
  const counts: Record<SubStatus, number> = { TRIAL: 0, ACTIVE: 0, EXPIRING: 0, EXPIRED: 0, CANCELLED: 0, SUSPENDED: 0 };
  const expiringSoon: { businessId: string; name: string; plan: string; end: Date; status: SubStatus }[] = [];
  for (const s of subs) {
    const e = effectiveStatus(s, now, { graceDays: settings.graceDays, reminderDays: settings.reminderWindow });
    counts[e.status]++;
    const end = s.status === "TRIAL" ? s.trialEndsAt ?? s.endDate : s.endDate;
    if (end && e.planAccess && end <= addDays(now, 14)) expiringSoon.push({ businessId: s.businessId, name: s.business.name, plan: s.plan.nameBn, end, status: e.status });
  }
  expiringSoon.sort((a, b) => a.end.getTime() - b.end.getTime());
  // last 12 months: revenue (a) and new companies (b)
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i, 1)));
  const rev = new Map<string, number>();
  for (const p of payments12) rev.set(monthKey(p.paidAt), (rev.get(monthKey(p.paidAt)) ?? 0) + num(p.amount));
  const reg = new Map<string, number>();
  for (const b of regs12) reg.set(monthKey(b.createdAt), (reg.get(monthKey(b.createdAt)) ?? 0) + 1);
  return {
    companies, users, activeUsers, counts, active: counts.ACTIVE + counts.EXPIRING + counts.CANCELLED, pending,
    monthRevenue: num(monthRev._sum.amount), yearRevenue: num(yearRev._sum.amount),
    recentBiz, recentPay: recentPay.map((p) => ({ ...p, businessName: names.get(p.businessId) ?? "—" })), expiringSoon: expiringSoon.slice(0, 10),
    months: months.map((m) => ({ key: monthKey(m), revenue: rev.get(monthKey(m)) ?? 0, registrations: reg.get(monthKey(m)) ?? 0, date: m })),
  };
}

/** "YYYY-MM-DD" → UTC midnight (inclusive range helpers for date filters). */
export function dayRange(from?: string, to?: string): { gte?: Date; lt?: Date } | undefined {
  const d = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : undefined);
  const gte = d(from);
  const end = d(to);
  if (!gte && !end) return undefined;
  return { ...(gte ? { gte } : {}), ...(end ? { lt: new Date(end.getTime() + 86_400_000) } : {}) };
}

const PAYMENT_STATUSES = ["INITIATED", "PENDING", "SUCCESS", "FAILED", "CANCELLED", "REFUNDED"] as const;
export const isPaymentStatus = (v?: string): v is (typeof PAYMENT_STATUSES)[number] => !!v && (PAYMENT_STATUSES as readonly string[]).includes(v);

export async function companyList(q: { search?: string; status?: string; plan?: string; paymentStatus?: string; from?: string; to?: string; skip: number; take: number }, now = new Date()) {
  const settings = await platformSettings();
  const s = q.search;
  const created = dayRange(q.from, q.to);
  const where: Prisma.BusinessWhereInput = {
    // company name / mobile / email, or the owner's (any member's) name, mobile or email
    ...(s ? { OR: [
      { name: ci(s) }, { mobile: { contains: s } }, { email: ci(s) },
      { memberships: { some: { user: { OR: [{ name: ci(s) }, { mobile: { contains: s } }, { email: ci(s) }] } } } },
    ] } : {}),
    ...(q.plan ? { subscription: { plan: { code: q.plan } } } : {}),
    ...(isPaymentStatus(q.paymentStatus) ? { subscription: { ...(q.plan ? { plan: { code: q.plan } } : {}), paymentStatus: q.paymentStatus } } : {}),
    ...(created ? { createdAt: created } : {}),
  };
  const rows = await prisma.business.findMany({
    where, orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, mobile: true, email: true, createdAt: true, isActive: true, businessType: true, _count: { select: { memberships: true } },
      subscription: { include: { plan: { select: { code: true, nameBn: true } } } },
      memberships: { where: { role: { isSystem: true } }, orderBy: { createdAt: "asc" }, take: 1, select: { user: { select: { name: true, mobile: true, email: true } } } },
    },
  });
  const withStatus = rows.map((r) => ({
    ...r,
    effective: r.subscription ? effectiveStatus(r.subscription, now, { graceDays: settings.graceDays, reminderDays: settings.reminderWindow }) : null,
  }));
  const filtered = q.status ? withStatus.filter((r) => r.effective?.status === q.status) : withStatus;
  return { total: filtered.length, rows: filtered.slice(q.skip, q.skip + q.take) };
}

export async function companyDetail(businessId: string) {
  const b = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      subscription: { include: { plan: true, events: { orderBy: { createdAt: "desc" }, take: 30 } } },
      memberships: { include: { user: { select: { id: true, name: true, email: true, mobile: true, lastLoginAt: true, isActive: true } }, role: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      paymentTransactions: { orderBy: { createdAt: "desc" }, take: 30, include: { plan: { select: { nameBn: true } } } },
      saasInvoices: { orderBy: { createdAt: "desc" }, take: 30 },
      features: true,
    },
  });
  return b;
}

// ───────────────────────── plans ─────────────────────────

export interface PlanInput {
  code: string;
  nameBn: string;
  nameEn: string;
  descriptionBn: string | null;
  descriptionEn: string | null;
  priceMonthly: number;
  priceYearly: number;
  userLimit: number | null;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
  features: string[];
}

export async function savePlan(input: PlanInput, id?: string) {
  const unknown = input.features.filter((f) => !(FEATURE_KEYS as string[]).includes(f));
  if (unknown.length) throw new UserError(`অজানা ফিচার: ${unknown.join(", ")}`);
  const settings = await platformSettings();
  return prisma.$transaction(async (tx) => {
    if (id) {
      const current = await tx.plan.findUnique({ where: { id } });
      if (!current) throw new UserError("প্ল্যান পাওয়া যায়নি");
      if (!input.isActive && (current.code === settings.fallbackPlanCode || current.code === settings.trialPlanCode)) throw new UserError("ফ্রি/ট্রায়ালের প্ল্যান নিষ্ক্রিয় করা যাবে না — আগে প্ল্যাটফর্ম সেটিং পরিবর্তন করুন");
      if (current.code !== input.code && (current.code === settings.fallbackPlanCode || current.code === settings.trialPlanCode)) throw new UserError("ফ্রি/ট্রায়ালের প্ল্যানের কোড পরিবর্তন করা যাবে না");
    }
    const data = {
      code: input.code, nameBn: input.nameBn, nameEn: input.nameEn, descriptionBn: input.descriptionBn, descriptionEn: input.descriptionEn,
      priceMonthly: input.priceMonthly, priceYearly: input.priceYearly, userLimit: input.userLimit, isActive: input.isActive, isPublic: input.isPublic, sortOrder: input.sortOrder,
    };
    const plan = id ? await tx.plan.update({ where: { id }, data }) : await tx.plan.create({ data });
    await tx.planFeature.deleteMany({ where: { planId: plan.id } });
    if (input.features.length) await tx.planFeature.createMany({ data: [...new Set(input.features)].map((featureKey) => ({ planId: plan.id, featureKey })) });
    return plan;
  });
}

/** Deleting is only possible for a plan nobody used; otherwise deactivate it (history stays intact). */
export async function deletePlan(id: string) {
  const p = await prisma.plan.findUnique({ where: { id }, include: { _count: { select: { subscriptions: true, transactions: true, invoices: true } } } });
  if (!p) throw new UserError("প্ল্যান পাওয়া যায়নি");
  if (p._count.subscriptions || p._count.transactions || p._count.invoices) throw new UserError("এই প্ল্যান ব্যবহৃত হয়েছে — মুছার বদলে নিষ্ক্রিয় করুন");
  const s = await platformSettings();
  if (p.code === s.fallbackPlanCode || p.code === s.trialPlanCode) throw new UserError("ফ্রি/ট্রায়ালের প্ল্যান মুছা যাবে না");
  await prisma.plan.delete({ where: { id } });
  return p;
}

/** Per-company feature override: true = allow beyond the plan, false = block, null = plan decides. */
export async function setFeatureOverride(businessId: string, featureKey: string, value: boolean | null, actorUserId: string) {
  if (!(FEATURE_KEYS as string[]).includes(featureKey)) throw new UserError("ফিচার পাওয়া যায়নি");
  const existing = await prisma.businessFeature.findUnique({ where: { businessId_featureKey: { businessId, featureKey } } });
  if (existing) return prisma.businessFeature.update({ where: { id: existing.id }, data: { adminOverride: value, overrideById: actorUserId, overrideAt: new Date() } });
  // no company choice yet: keep the default choice (on) and only record the override
  return prisma.businessFeature.create({ data: { businessId, featureKey, enabled: true, adminOverride: value, overrideById: actorUserId, overrideAt: new Date() } });
}

export async function savePlatformSettings(input: { trialDays: number; trialPlanCode: string; fallbackPlanCode: string; graceDays: number; reminderDays: number[]; vatPercent: number; currency: string; invoicePrefix: string }) {
  for (const code of [input.trialPlanCode, input.fallbackPlanCode]) {
    const p = await prisma.plan.findUnique({ where: { code } });
    if (!p || !p.isActive) throw new UserError(`প্ল্যান ${code} পাওয়া যায়নি বা নিষ্ক্রিয়`);
  }
  return prisma.platformSetting.update({ where: { id: "platform" }, data: { ...input, reminderDays: [...new Set(input.reminderDays)].sort((a, b) => b - a) } });
}

// ───────────────────────── platform-wide lists (Super Admin) ─────────────────────────

export async function userList(q: { search?: string; kind?: string; skip: number; take: number }) {
  const s = q.search;
  const where: Prisma.UserWhereInput = {
    ...(s ? { OR: [{ name: ci(s) }, { mobile: { contains: s } }, { email: ci(s) }, { memberships: { some: { business: { name: ci(s) } } } }] } : {}),
    ...(q.kind === "super" ? { isSuperAdmin: true } : q.kind === "inactive" ? { isActive: false } : q.kind === "active" ? { isActive: true } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where, orderBy: { createdAt: "desc" }, skip: q.skip, take: q.take,
      select: { id: true, name: true, mobile: true, email: true, isActive: true, isSuperAdmin: true, lastLoginAt: true, createdAt: true, memberships: { select: { isActive: true, business: { select: { id: true, name: true } }, role: { select: { name: true } } } } },
    }),
    prisma.user.count({ where }),
  ]);
  return { rows, total };
}

export async function revenueReport(q: { from?: string; to?: string; plan?: string }, now = new Date()) {
  const range = dayRange(q.from, q.to);
  const plan = q.plan ? await prisma.plan.findUnique({ where: { code: q.plan }, select: { id: true } }) : null;
  const where: Prisma.PaymentTransactionWhereInput = { ...(plan ? { planId: plan.id } : q.plan ? { planId: "-" } : {}), ...(range ? { createdAt: range } : {}) };
  const [byStatus, success, refunded, plans] = await Promise.all([
    prisma.paymentTransaction.groupBy({ by: ["status"], where, _count: true, _sum: { amount: true } }),
    prisma.paymentTransaction.findMany({ where: { ...where, status: "SUCCESS" }, select: { amount: true, completedAt: true, createdAt: true, planId: true, billingCycle: true } }),
    prisma.paymentTransaction.findMany({ where: { ...where, status: "REFUNDED" }, select: { amount: true } }),
    prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, code: true, nameBn: true } }),
  ]);
  const at = (t: { completedAt: Date | null; createdAt: Date }) => t.completedAt ?? t.createdAt;
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1));
    const key = d.toISOString().slice(0, 7);
    const list = success.filter((t) => at(t).toISOString().slice(0, 7) === key);
    return { key, month: d.getUTCMonth(), amount: round2(list.reduce((x, t) => x + num(t.amount), 0)), count: list.length };
  });
  const monthKey = now.toISOString().slice(0, 7);
  const yearKey = now.toISOString().slice(0, 4);
  const sum = (list: { amount: Prisma.Decimal }[]) => round2(list.reduce((x, t) => x + num(t.amount), 0));
  return {
    total: sum(success),
    refunded: sum(refunded),
    thisMonth: sum(success.filter((t) => at(t).toISOString().slice(0, 7) === monthKey)),
    thisYear: sum(success.filter((t) => at(t).toISOString().slice(0, 4) === yearKey)),
    byStatus: byStatus.map((b) => ({ status: b.status, count: b._count, amount: num(b._sum.amount) })),
    byPlan: plans.map((p) => {
      const list = success.filter((t) => t.planId === p.id);
      return { ...p, count: list.length, amount: sum(list), yearly: list.filter((t) => t.billingCycle === "YEARLY").length };
    }).filter((p) => p.count > 0),
    months,
  };
}

/**
 * Records a refund of a successful payment (the money itself is returned through the gateway's
 * merchant panel or by transfer). Invoice → REFUNDED; the subscription is NOT changed automatically —
 * the administrator decides (change plan / suspend) separately, and both steps are audited.
 */
export async function refundPayment(transactionId: string, reason: string, actorUserId: string) {
  return prisma.$transaction(async (tx) => {
    const moved = await tx.paymentTransaction.updateMany({ where: { id: transactionId, status: "SUCCESS" }, data: { status: "REFUNDED", failureReason: `refund: ${reason}`.slice(0, 300) } });
    if (!moved.count) throw new UserError("শুধু সফল পেমেন্ট ফেরত (রিফান্ড) দেওয়া যায়");
    const t = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: transactionId }, include: { subscriptionPayment: true } });
    if (t.subscriptionPayment?.invoiceId) await tx.invoice.update({ where: { id: t.subscriptionPayment.invoiceId }, data: { status: "REFUNDED" } });
    const sub = await tx.subscription.findUnique({ where: { businessId: t.businessId } });
    if (sub) {
      await tx.subscription.update({ where: { id: sub.id }, data: { paymentStatus: "REFUNDED" } });
      await tx.subscriptionEvent.create({ data: { businessId: t.businessId, subscriptionId: sub.id, type: "REFUNDED", actorUserId, note: reason, details: { transactionId: t.id, amount: num(t.amount) } } });
    }
    return t;
  });
}
