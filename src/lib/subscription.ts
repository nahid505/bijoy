// Subscription rules (pure — no database), shared by the server, the UI and the tests.
//
//   TRIAL      free trial, plan features until trialEndsAt (+ grace)
//   ACTIVE     paid (or free plan without end date)
//   EXPIRING   shown when the end is within the reminder window, or inside the grace period
//   EXPIRED    past end + grace: only the fallback (free) plan's features remain — data is never deleted
//   CANCELLED  will not renew; keeps access until the end of the paid period
//   SUSPENDED  blocked by the platform (only billing pages stay open)
import { round2 } from "./calc";

export type SubStatus = "TRIAL" | "ACTIVE" | "EXPIRING" | "EXPIRED" | "CANCELLED" | "SUSPENDED";
export type Cycle = "MONTHLY" | "YEARLY";

export const SUB_STATUS_LABELS: Record<SubStatus, { bn: string; en: string; tone: "green" | "amber" | "red" | "blue" | "slate" }> = {
  TRIAL: { bn: "ট্রায়াল", en: "Trial", tone: "blue" },
  ACTIVE: { bn: "সক্রিয়", en: "Active", tone: "green" },
  EXPIRING: { bn: "মেয়াদ শেষ হচ্ছে", en: "Expiring", tone: "amber" },
  EXPIRED: { bn: "মেয়াদোত্তীর্ণ", en: "Expired", tone: "red" },
  CANCELLED: { bn: "বাতিল (নবায়ন হবে না)", en: "Cancelled", tone: "slate" },
  SUSPENDED: { bn: "স্থগিত", en: "Suspended", tone: "red" },
};
export const CYCLE_LABELS: Record<Cycle, string> = { MONTHLY: "মাসিক", YEARLY: "বার্ষিক" };

const DAY = 86_400_000;
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
/** Calendar months (UTC), clamped to the month end: 31 Jan + 1 month = 28/29 Feb. */
export function addMonths(d: Date, n: number) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
}
export const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const daysUntil = (from: Date, to: Date) => Math.ceil((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);

export interface SubscriptionState {
  status: SubStatus; // stored status
  endDate: Date | null;
  trialEndsAt: Date | null;
}
export interface Effective {
  status: SubStatus; // what users see
  /** plan features are available (otherwise only the fallback plan's) */
  planAccess: boolean;
  /** the business is blocked except for billing */
  blocked: boolean;
  /** inside the grace period after the end date */
  inGrace: boolean;
  /** last day with plan access (end + grace), null = no end */
  accessUntil: Date | null;
  daysLeft: number | null; // until the end date
}

export function effectiveStatus(sub: SubscriptionState, now: Date, opts: { graceDays: number; reminderDays: number }): Effective {
  if (sub.status === "SUSPENDED") return { status: "SUSPENDED", planAccess: false, blocked: true, inGrace: false, accessUntil: null, daysLeft: null };
  const end = sub.status === "TRIAL" ? sub.trialEndsAt ?? sub.endDate : sub.endDate;
  if (!end) return { status: sub.status === "CANCELLED" ? "ACTIVE" : sub.status, planAccess: true, blocked: false, inGrace: false, accessUntil: null, daysLeft: null };
  const accessUntil = addDays(end, Math.max(0, opts.graceDays));
  const daysLeft = daysUntil(now, end);
  if (sub.status === "EXPIRED" || now >= accessUntil) return { status: "EXPIRED", planAccess: false, blocked: false, inGrace: false, accessUntil, daysLeft };
  const inGrace = now >= end;
  if (sub.status === "CANCELLED") return { status: inGrace ? "EXPIRED" : "CANCELLED", planAccess: !inGrace, blocked: false, inGrace: false, accessUntil: end, daysLeft };
  const expiring = inGrace || daysLeft <= opts.reminderDays;
  return { status: sub.status === "TRIAL" ? "TRIAL" : expiring ? "EXPIRING" : "ACTIVE", planAccess: true, blocked: false, inGrace, accessUntil, daysLeft };
}

/** The period a payment buys: renewing before the end continues from the end date, otherwise from today. */
export function nextPeriod(current: { status: SubStatus; endDate: Date | null; planId: string; trial: boolean }, newPlanId: string, cycle: Cycle, now: Date) {
  const continuing = !current.trial && current.planId === newPlanId && current.endDate && current.endDate > now && current.status !== "EXPIRED" && current.status !== "SUSPENDED";
  const start = continuing ? current.endDate! : startOfDay(now);
  return { start, end: cycle === "YEARLY" ? addMonths(start, 12) : addMonths(start, 1), renewal: !!continuing };
}

export function planPrice(plan: { priceMonthly: number; priceYearly: number }, cycle: Cycle) {
  return cycle === "YEARLY" ? plan.priceYearly : plan.priceMonthly;
}

/** Invoice amounts: VAT is added on top of the price after discount. */
export function invoiceAmounts(price: number, discount: number, vatPercent: number) {
  const subtotal = round2(price);
  const d = round2(Math.min(Math.max(0, discount), subtotal));
  const vatAmount = round2(((subtotal - d) * vatPercent) / 100);
  return { subtotal, discount: d, vatPercent, vatAmount, total: round2(subtotal - d + vatAmount) };
}

/**
 * Features a business may use: the plan's (or the fallback plan's after expiry), adjusted by the
 * super admin's per-company overrides. The company admin's on/off choice is applied on top of this.
 */
export function entitledFeatures(input: { effective: Effective; planFeatures: string[]; fallbackFeatures: string[]; overrides: Map<string, boolean> }): Set<string> {
  const base = input.effective.blocked ? [] : input.effective.planAccess ? input.planFeatures : input.fallbackFeatures;
  const out = new Set(base);
  for (const [key, allow] of input.overrides) {
    if (input.effective.blocked) break; // a suspended business has nothing
    if (allow) out.add(key);
    else out.delete(key);
  }
  return out;
}

/** "Upgrade" / "downgrade" by monthly price. */
export function planChangeKind(from: { priceMonthly: number } | null, to: { priceMonthly: number }) {
  if (!from) return "PLAN_CHANGED";
  if (to.priceMonthly > from.priceMonthly) return "UPGRADED";
  if (to.priceMonthly < from.priceMonthly) return "DOWNGRADED";
  return "PLAN_CHANGED";
}
