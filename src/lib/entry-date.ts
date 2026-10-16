// Date lock for entries (permission "transaction:change_date"). Shared by the forms and the server.
//
//   with the permission     any date (back-dated or future entries)
//   without the permission  a new entry is dated today (the business's calendar day);
//                           an edit keeps the entry's own date (an old voucher is never moved to today)

export const CHANGE_DATE_PERMISSION = "transaction:change_date";

/** The only date allowed without the permission, as YYYY-MM-DD. */
export function lockedEntryDate(today: string, originalDate?: string | null): string {
  return originalDate || today;
}

export function entryDateAllowed(o: { canChangeDate: boolean; date: string; today: string; originalDate?: string | null }): boolean {
  return o.canChangeDate || o.date === lockedEntryDate(o.today, o.originalDate);
}

/** A stored calendar date (UTC midnight) as YYYY-MM-DD. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
