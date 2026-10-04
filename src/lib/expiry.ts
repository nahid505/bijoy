// Expiry rules — pure, unit-tested, safe for server and client.
//
// Dates are calendar days stored as UTC midnight (see format.ts). A batch is EXPIRED once its
// expiry day has passed; on the expiry day itself it is "expiring today" and may still be sold.

import { round3 } from "./calc";

export const DEFAULT_WARNING_DAYS = [60, 30, 15, 7];
const DAY = 86_400_000;

export type ExpiryCode = "NONE" | "EXPIRED" | "TODAY" | "SOON" | "VALID";

export interface ExpiryStatus {
  code: ExpiryCode;
  /** days until expiry (negative = days since expiry); null when the batch has no expiry date */
  daysLeft: number | null;
  /** warning band in days: the smallest threshold ≥ daysLeft (0 for today / expired) */
  level: number | null;
}

/** Unique positive whole-day thresholds, largest first (e.g. [60, 30, 15, 7]). */
export function normalizeThresholds(input: readonly (number | string)[] | null | undefined): number[] {
  const out = [...new Set((input ?? []).map((v) => Math.trunc(Number(v))).filter((v) => Number.isFinite(v) && v > 0 && v <= 3650))];
  return (out.length ? out : DEFAULT_WARNING_DAYS).sort((a, b) => b - a);
}

/** UTC midnight of a calendar day. */
export function dayOf(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((dayOf(to).getTime() - dayOf(from).getTime()) / DAY);
}

export function expiryStatus(expiryDate: Date | string | null | undefined, today: Date, thresholds: readonly number[] = DEFAULT_WARNING_DAYS): ExpiryStatus {
  if (!expiryDate) return { code: "NONE", daysLeft: null, level: null };
  const daysLeft = daysBetween(today, new Date(expiryDate));
  if (daysLeft < 0) return { code: "EXPIRED", daysLeft, level: 0 };
  if (daysLeft === 0) return { code: "TODAY", daysLeft, level: 0 };
  const sorted = normalizeThresholds(thresholds);
  const band = [...sorted].reverse().find((t) => daysLeft <= t);
  return band === undefined ? { code: "VALID", daysLeft, level: null } : { code: "SOON", daysLeft, level: band };
}

export const isExpired = (expiryDate: Date | string | null | undefined, onDay: Date) =>
  !!expiryDate && daysBetween(onDay, new Date(expiryDate)) < 0;

/** Bucket used by filters and dashboard cards. */
export type ExpiryFilter = "all" | "valid" | "soon" | "expired";

export function matchesFilter(s: ExpiryStatus, filter: ExpiryFilter, withinDays?: number | null): boolean {
  if (withinDays !== undefined && withinDays !== null) return s.daysLeft !== null && s.daysLeft >= 0 && s.daysLeft <= withinDays;
  if (filter === "expired") return s.code === "EXPIRED";
  if (filter === "soon") return s.code === "SOON" || s.code === "TODAY";
  if (filter === "valid") return s.code === "VALID" || s.code === "NONE";
  return true;
}

export const EXPIRY_LABELS: Record<ExpiryCode, string> = {
  NONE: "মেয়াদ নেই",
  EXPIRED: "মেয়াদোত্তীর্ণ",
  TODAY: "আজ মেয়াদ শেষ",
  SOON: "শীঘ্রই মেয়াদ শেষ",
  VALID: "বৈধ",
};

export const EXPIRY_ICONS: Record<ExpiryCode, string> = { NONE: "⚪", EXPIRED: "🔴", TODAY: "🟠", SOON: "🟠", VALID: "🟢" };

export const EXPIRED_SALE_MESSAGE = "এই পণ্যের মেয়াদ শেষ হয়ে গেছে। বিক্রি করা যাবে না।";

// ───────────────────────── FEFO ─────────────────────────

export interface BatchStock {
  batchNo: string;
  expiryDate: Date | string | null;
  quantity: number;
}

export interface Allocation {
  batchNo: string;
  quantity: number;
}

/**
 * First-Expired-First-Out: takes `quantity` from the batches with the earliest expiry first.
 * Batches already expired on `onDay` are never selected automatically; batches without an expiry
 * date go last. Returns the allocations and any shortfall.
 */
export function fefoAllocate(batches: readonly BatchStock[], quantity: number, onDay: Date): { allocations: Allocation[]; shortfall: number } {
  const usable = batches
    .filter((b) => b.quantity > 0 && !isExpired(b.expiryDate, onDay))
    .sort((a, b) => {
      const ea = a.expiryDate ? new Date(a.expiryDate).getTime() : Infinity;
      const eb = b.expiryDate ? new Date(b.expiryDate).getTime() : Infinity;
      return ea - eb || a.batchNo.localeCompare(b.batchNo);
    });
  let left = round3(quantity);
  const allocations: Allocation[] = [];
  for (const b of usable) {
    if (left <= 0) break;
    const take = round3(Math.min(left, b.quantity));
    if (take > 0) allocations.push({ batchNo: b.batchNo, quantity: take });
    left = round3(left - take);
  }
  return { allocations, shortfall: Math.max(0, left) };
}
