import "server-only";
// Server-side check of the date lock (see src/lib/entry-date.ts). Every action that posts an entry
// calls assertEntryDate after parsing, so a tampered request (or an old open form) cannot back-date.
import { prisma } from "@/lib/db";
import { entryDateAllowed, isoDay, lockedEntryDate } from "@/lib/entry-date";
import { formatDate, toDateInput } from "@/lib/format";
import { can, ForbiddenError, type AppContext } from "./auth";

export function canChangeEntryDate(ctx: AppContext): boolean {
  return can(ctx, "transaction:change_date");
}

/** What the form shows: whether the date is locked, and the date it is locked to. */
export function entryDateLock(ctx: AppContext, originalDate?: Date | null): { locked: boolean; date: string } {
  const today = toDateInput();
  return { locked: !canChangeEntryDate(ctx), date: lockedEntryDate(today, originalDate ? isoDay(originalDate) : null) };
}

/** Throws ForbiddenError when the user may not use this date (403 for API callers). */
export function assertEntryDate(ctx: AppContext, date: Date, originalDate?: Date | null): void {
  const today = toDateInput();
  const original = originalDate ? isoDay(originalDate) : null;
  if (entryDateAllowed({ canChangeDate: canChangeEntryDate(ctx), date: isoDay(date), today, originalDate: original })) return;
  throw new ForbiddenError(
    original
      ? `তারিখ পরিবর্তনের অনুমতি আপনার নেই — এই এন্ট্রির তারিখ ${formatDate(original)} রাখতে হবে`
      : `তারিখ পরিবর্তনের অনুমতি আপনার নেই — শুধু আজকের তারিখে (${formatDate(today)}) এন্ট্রি দেওয়া যাবে`,
  );
}

/** The stored date of a voucher being edited (null for a new entry or another business's id). */
export async function originalEntryDate(businessId: string, voucherId: string | null | undefined): Promise<Date | null> {
  if (!voucherId) return null;
  return (await prisma.voucher.findFirst({ where: { id: voucherId, businessId }, select: { date: true } }))?.date ?? null;
}
