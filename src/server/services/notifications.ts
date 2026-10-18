// Notification centre & the daily check.
//
// runDailyChecks scans one business and records alerts as Notification rows:
//   • expiry  — per batch with stock: one row per warning band (60/30/15/7 … configurable),
//               "expires today" and "expired"; a later band resolves the earlier one;
//   • low stock — product at / below its minimum stock;
//   • overdue — customer with dues past the due date.
// Duplicates are impossible: every alert has a deterministic dedupeKey (unique per business) and
// runs are serialised per business with a transaction-scoped advisory lock. Reading an alert
// only records a NotificationRead; rows are kept as history and get `resolvedAt` once the
// condition is gone (batch sold out / written off, stock refilled, dues collected).
import type { NotificationKind, NotificationSeverity, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { round2, round3 } from "@/lib/calc";
import { dayOf, expiryStatus, normalizeThresholds } from "@/lib/expiry";
import { formatDate, formatMoney, formatQty, toBnDigits, toDateInput } from "@/lib/format";
import { partyAging } from "./aging";
import { dailySms } from "../sms/events";
import { checkSmsBalance } from "../sms/queue";
import { featureIsOn } from "./feature-state";
import { subscriptionDailyCheck } from "./subscriptions";
import { lockKey } from "@/lib/dialect";

export const DAILY_JOB = "daily-check";
type Tx = Prisma.TransactionClient;

/** Today's business date (Asia/Dhaka calendar day as UTC midnight). */
export function businessToday(): Date {
  return new Date(`${toDateInput()}T00:00:00.000Z`);
}

interface Alert {
  kind: NotificationKind;
  severity: NotificationSeverity;
  dedupeKey: string;
  title: string;
  message: string;
  link: string;
  productId?: string;
  batchId?: string;
  accountId?: string;
  level?: number | null;
  quantity?: number;
  amount?: number;
  dueOn?: Date | null;
}

export interface DailyCheckResult {
  skipped?: boolean;
  created: number;
  reopened: number;
  resolved: number;
  active: number;
}

/**
 * Upserts the current alerts of one category: creates new ones, re-opens resolved ones whose
 * condition is back, refreshes figures on open ones, and resolves open ones not in `current`.
 * `sameSubject` maps an open alert to a subject key so recurring conditions (low stock, overdue)
 * keep a single open alert instead of one per day.
 */
async function reconcile(
  tx: Tx,
  businessId: string,
  kinds: NotificationKind[],
  current: Alert[],
  subjectOf: (n: { productId: string | null; batchId: string | null; accountId: string | null; dedupeKey: string }) => string,
  subjectOfAlert: (a: Alert) => string,
  now: Date,
  r: DailyCheckResult,
) {
  const open = await tx.notification.findMany({ where: { businessId, kind: { in: kinds }, resolvedAt: null } });
  const openBySubject = new Map(open.map((n) => [subjectOf(n), n]));
  const keep = new Set<string>();

  for (const a of current) {
    const data = { quantity: a.quantity ?? null, amount: a.amount ?? null, message: a.message, title: a.title, severity: a.severity, dueOn: a.dueOn ?? null };
    // a recurring condition that is still open keeps its alert (e.g. low stock for 10 days = 1 alert)
    const sameOpen = openBySubject.get(subjectOfAlert(a));
    if (sameOpen && (sameOpen.dedupeKey === a.dedupeKey || a.kind === "LOW_STOCK" || a.kind === "OVERDUE")) {
      keep.add(sameOpen.id);
      await tx.notification.update({ where: { id: sameOpen.id }, data });
      continue;
    }
    const existing = await tx.notification.findUnique({ where: { businessId_dedupeKey: { businessId, dedupeKey: a.dedupeKey } } });
    if (existing) {
      keep.add(existing.id);
      if (existing.resolvedAt) r.reopened++;
      await tx.notification.update({ where: { id: existing.id }, data: { ...data, resolvedAt: null } });
      continue;
    }
    const created = await tx.notification.create({
      data: {
        businessId, kind: a.kind, severity: a.severity, dedupeKey: a.dedupeKey, title: a.title, message: a.message, link: a.link,
        productId: a.productId ?? null, batchId: a.batchId ?? null, accountId: a.accountId ?? null, level: a.level ?? null,
        quantity: a.quantity ?? null, amount: a.amount ?? null, dueOn: a.dueOn ?? null,
      },
    });
    keep.add(created.id);
    r.created++;
  }
  const stale = open.filter((n) => !keep.has(n.id)).map((n) => n.id);
  if (stale.length) {
    await tx.notification.updateMany({ where: { id: { in: stale } }, data: { resolvedAt: now } });
    r.resolved += stale.length;
  }
  r.active += keep.size;
}

/** Computes all alerts for a business on `today` and records them (idempotent per day unless forced). */
export async function runDailyChecks(businessId: string, opts: { today?: Date; force?: boolean } = {}): Promise<DailyCheckResult> {
  const expiryOn = await featureIsOn(businessId, "PRODUCT_EXPIRY");
  const today = dayOf(opts.today ?? businessToday());
  const aging = await partyAging(businessId, "CUSTOMER", today);

  const outcome = await prisma.$transaction(
    async (tx) => {
      await lockKey(tx, `bl-daily-check:${businessId}`);
      const run = await tx.jobRun.findUnique({ where: { businessId_job_runOn: { businessId, job: DAILY_JOB, runOn: today } } });
      if (run?.finishedAt && !opts.force) return { skipped: true, created: 0, reopened: 0, resolved: 0, active: 0 };

      const now = new Date();
      const result: DailyCheckResult = { created: 0, reopened: 0, resolved: 0, active: 0 };
      const business = await tx.business.findUniqueOrThrow({ where: { id: businessId }, select: { expiryWarningDays: true, currencySymbol: true } });
      const thresholds = normalizeThresholds(business.expiryWarningDays);

      // ── expiry (per batch that still has stock) — only while Product Expiry Management is on
      const batches = !expiryOn ? [] : await tx.productBatch.findMany({
        where: { businessId, quantity: { gt: 0 }, expiryDate: { not: null } },
        include: { product: { select: { name: true, unit: { select: { name: true } } } } },
      });
      const expiryAlerts: Alert[] = [];
      for (const b of batches) {
        const st = expiryStatus(b.expiryDate, today, thresholds);
        if (st.code !== "EXPIRED" && st.code !== "TODAY" && st.code !== "SOON") continue;
        const qty = round3(Number(b.quantity));
        const qtyText = `মজুদ ${formatQty(qty)} ${b.product.unit.name}`;
        const base = { productId: b.productId, batchId: b.id, quantity: qty, dueOn: b.expiryDate, link: `/products/batches?product=${b.productId}` };
        if (st.code === "EXPIRED") {
          expiryAlerts.push({
            ...base, kind: "EXPIRED", severity: "CRITICAL", level: 0, dedupeKey: `expiry:${b.id}:expired`,
            title: `মেয়াদোত্তীর্ণ: ${b.product.name}`,
            message: `${b.product.name} — ব্যাচ ${b.batchNo} এর মেয়াদ ${formatDate(b.expiryDate)} তারিখে শেষ হয়েছে। ${qtyText}।`,
          });
        } else if (st.code === "TODAY") {
          expiryAlerts.push({
            ...base, kind: "EXPIRY_WARNING", severity: "CRITICAL", level: 0, dedupeKey: `expiry:${b.id}:today`,
            title: `আজ মেয়াদ শেষ: ${b.product.name}`,
            message: `${b.product.name} — ব্যাচ ${b.batchNo} এর মেয়াদ আজ (${formatDate(b.expiryDate)}) শেষ হচ্ছে। ${qtyText}।`,
          });
        } else {
          expiryAlerts.push({
            ...base, kind: "EXPIRY_WARNING", severity: "WARNING", level: st.level, dedupeKey: `expiry:${b.id}:w${st.level}`,
            title: `${toBnDigits(st.level!)} দিনের মধ্যে মেয়াদ শেষ: ${b.product.name}`,
            message: `${b.product.name} — ব্যাচ ${b.batchNo} এর মেয়াদ ${toBnDigits(st.daysLeft!)} দিন পর (${formatDate(b.expiryDate)}) শেষ হবে। ${qtyText}।`,
          });
        }
      }
      // one open expiry alert per batch: the current band supersedes earlier bands
      if (expiryOn) await reconcile(tx, businessId, ["EXPIRED", "EXPIRY_WARNING"], expiryAlerts, (n) => `${n.batchId}|${n.dedupeKey}`, (a) => `${a.batchId}|${a.dedupeKey}`, now, result);

      // ── low stock
      const products = await tx.product.findMany({
        where: { businessId, isActive: true, minStock: { gt: 0 } },
        select: { id: true, name: true, stock: true, minStock: true, unit: { select: { name: true } } },
      });
      const day = toDateInput(today);
      const lowAlerts: Alert[] = products
        .filter((p) => Number(p.stock) <= Number(p.minStock))
        .map((p) => ({
          kind: "LOW_STOCK", severity: Number(p.stock) <= 0 ? "CRITICAL" : "WARNING", dedupeKey: `lowstock:${p.id}:${day}`,
          title: Number(p.stock) <= 0 ? `স্টক শেষ: ${p.name}` : `কম স্টক: ${p.name}`,
          message: `${p.name} — মজুদ ${formatQty(Number(p.stock))} ${p.unit.name}, সর্বনিম্ন সীমা ${formatQty(Number(p.minStock))} ${p.unit.name}।`,
          link: `/products/${p.id}`, productId: p.id, quantity: round3(Number(p.stock)),
        }));
      await reconcile(tx, businessId, ["LOW_STOCK"], lowAlerts, (n) => n.productId ?? "", (a) => a.productId ?? "", now, result);

      // ── overdue customer dues
      const overdueAlerts: Alert[] = aging
        .filter((a) => a.overdue > 0)
        .map((a) => {
          const oldest = Math.max(0, ...a.openItems.map((i) => i.overdueDays));
          const due = a.openItems.filter((i) => i.overdueDays > 0).sort((x, y) => x.dueDate.getTime() - y.dueDate.getTime())[0]?.dueDate ?? null;
          return {
            kind: "OVERDUE", severity: oldest > 30 ? "CRITICAL" : "WARNING", dedupeKey: `overdue:${a.accountId}:${day}`,
            title: `বকেয়া মেয়াদোত্তীর্ণ: ${a.name}`,
            message: `${a.name} — ${formatMoney(a.overdue, business.currencySymbol)} বকেয়া পরিশোধের তারিখ পেরিয়ে গেছে (সবচেয়ে পুরনো ${toBnDigits(oldest)} দিন)।`,
            link: `/customers/${a.partyId}?tab=dues`, accountId: a.accountId, amount: round2(a.overdue), dueOn: due,
          } satisfies Alert;
        });
      await reconcile(tx, businessId, ["OVERDUE"], overdueAlerts, (n) => n.accountId ?? "", (a) => a.accountId ?? "", now, result);

      await tx.jobRun.upsert({
        where: { businessId_job_runOn: { businessId, job: DAILY_JOB, runOn: today } },
        create: { businessId, job: DAILY_JOB, runOn: today, startedAt: now, finishedAt: new Date(), result: { ...result } },
        update: { finishedAt: new Date(), result: { ...result } },
      });
      return result;
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
  if (!outcome.skipped) {
    // SMS alerts (due reminders, supplier statements, low stock, expiry) — after the commit, never fatal
    await dailySms(prisma, businessId, today);
    // subscription reminders (7 / 3 / 1 days) and expiry after the grace period
    await subscriptionDailyCheck(businessId).catch((e) => console.error("[subscription-check]", businessId, e));
    if ((await prisma.smsSettings.findUnique({ where: { businessId }, select: { enabled: true } }))?.enabled) await checkSmsBalance(prisma, businessId).catch(() => null);
  }
  return outcome;
}

/** Runs today's check once (cheap no-op when it already ran). */
export async function ensureDailyChecks(businessId: string) {
  const today = businessToday();
  const run = await prisma.jobRun.findUnique({ where: { businessId_job_runOn: { businessId, job: DAILY_JOB, runOn: today } }, select: { finishedAt: true } });
  if (run?.finishedAt) return null;
  return runDailyChecks(businessId, { today });
}

/** Scheduler entry point: today's check for every active business. Errors are isolated per business. */
export async function runDailyChecksForAll(log: (msg: string) => void = console.log) {
  const businesses = await prisma.business.findMany({ where: { isActive: true }, select: { id: true, name: true } });
  for (const b of businesses) {
    try {
      const r = await ensureDailyChecks(b.id);
      if (r && !r.skipped) log(`[daily-check] ${b.name}: +${r.created} new, ${r.reopened} reopened, ${r.resolved} resolved, ${r.active} active`);
    } catch (e) {
      log(`[daily-check] ${b.name}: failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

// ───────────────────────── queries for the UI ─────────────────────────

/** Alert kinds a member may see (expiry & stock need inventory access; dues need customer access). */
export function visibleKinds(can: (p: string) => boolean, features?: readonly string[]): NotificationKind[] {
  const kinds: NotificationKind[] = [];
  const expiry = !features || features.includes("PRODUCT_EXPIRY");
  if (can("inventory:view")) kinds.push(...(expiry ? (["EXPIRED", "EXPIRY_WARNING"] as const) : []), "LOW_STOCK");
  if (can("customers:view")) kinds.push("OVERDUE");
  if (can("sms:manage")) kinds.push("SMS_BALANCE_LOW");
  if (can("billing:view")) kinds.push("TRIAL_STARTED", "SUBSCRIPTION_ACTIVATED", "SUBSCRIPTION_EXPIRING", "SUBSCRIPTION_EXPIRED", "PAYMENT_SUCCESS", "PAYMENT_FAILED", "PLAN_CHANGED");
  if (can("users:manage")) kinds.push("USER_ADDED");
  if (can("billing:view")) kinds.push("FEATURE_CHANGED");
  return kinds;
}

export async function unreadCount(businessId: string, userId: string, kinds: NotificationKind[], scope: Prisma.NotificationWhereInput = {}) {
  if (kinds.length === 0) return 0;
  return prisma.notification.count({ where: { businessId, ...scope, kind: { in: kinds }, resolvedAt: null, reads: { none: { userId } } } });
}

export async function markRead(businessId: string, userId: string, kinds: NotificationKind[], ids?: string[]) {
  const targets = await prisma.notification.findMany({
    where: { businessId, kind: { in: kinds }, ...(ids ? { id: { in: ids } } : { resolvedAt: null }), reads: { none: { userId } } },
    select: { id: true },
  });
  if (targets.length === 0) return 0;
  await prisma.notificationRead.createMany({ data: targets.map((t) => ({ notificationId: t.id, userId })), skipDuplicates: true });
  return targets.length;
}
