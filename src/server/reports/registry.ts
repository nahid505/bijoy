import "server-only";
import { REPORTS as BASE } from "./definitions";
import { EXTRA_REPORTS } from "./extra";
import { EXPIRY_REPORTS } from "./expiry";
import { PAYROLL_REPORTS } from "./payroll";

export const REPORTS = [...BASE, ...EXTRA_REPORTS, ...EXPIRY_REPORTS, ...PAYROLL_REPORTS];

export function findReport(slug: string) {
  return REPORTS.find((r) => r.slug === slug) ?? null;
}
