import "server-only";
import { REPORTS as BASE } from "./definitions";
import { EXTRA_REPORTS } from "./extra";
import { EXPIRY_REPORTS } from "./expiry";
import { PAYROLL_REPORTS } from "./payroll";
import { DAILY_CASH_REPORT } from "./daily-cash";
import { DAILY_PURCHASE_REPORT } from "./daily-purchase";
import { DAILY_SALES_REPORT } from "./daily-sales";

export const REPORTS = [...BASE, ...EXTRA_REPORTS, ...EXPIRY_REPORTS, ...PAYROLL_REPORTS, DAILY_CASH_REPORT, DAILY_PURCHASE_REPORT, DAILY_SALES_REPORT];

export function findReport(slug: string) {
  return REPORTS.find((r) => r.slug === slug) ?? null;
}
