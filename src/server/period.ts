import { dayRange, toDateInput } from "@/lib/format";

/** Current fiscal year (Bangladesh calendar day) as YYYY-MM-DD bounds and a label like "2026-27". */
export function fiscalYearRange(startMonth: number, today = toDateInput()) {
  const [y, m] = today.split("-").map(Number);
  const startYear = m >= startMonth ? y : y - 1;
  const from = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(startYear + 1, startMonth - 1, 1));
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const to = endDate.toISOString().slice(0, 10);
  const label = startMonth === 1 ? String(startYear) : `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
  return { from, to, label };
}

/** Normalises report date filters: defaults to fiscal-year-to-date. */
export function reportPeriod(params: { from?: string; to?: string }, fiscalStartMonth: number) {
  const fy = fiscalYearRange(fiscalStartMonth);
  const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const from = valid(params.from) ?? fy.from;
  const to = valid(params.to) ?? toDateInput();
  return { from, to, range: dayRange(from, to) };
}
