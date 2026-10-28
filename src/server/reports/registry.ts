import "server-only";
import { REPORTS as BASE } from "./definitions";
import { EXTRA_REPORTS } from "./extra";
import { EXPIRY_REPORTS } from "./expiry";
import { PAYROLL_REPORTS } from "./payroll";
import { DAILY_CASH_REPORT } from "./daily-cash";
import { DAILY_PURCHASE_REPORT } from "./daily-purchase";
import { DAILY_SALES_REPORT } from "./daily-sales";
import { DEPOT_REPORTS } from "./depot";
import { RICE_MILL_REPORT } from "./rice-mill";
import type { PartyScope } from "../party-scope";

export const REPORTS = [...BASE, ...EXTRA_REPORTS, ...EXPIRY_REPORTS, ...PAYROLL_REPORTS, DAILY_CASH_REPORT, DAILY_PURCHASE_REPORT, DAILY_SALES_REPORT, ...DEPOT_REPORTS, RICE_MILL_REPORT];

export function findReport(slug: string) {
  return REPORTS.find((r) => r.slug === slug) ?? null;
}

// Assigned-only roles (src/server/party-scope.ts): which reports they may open.
/** these filter their rows to the user's customers / suppliers */
const PARTY_FILTERED = new Set([
  "ledger", "customers", "suppliers", "sales", "purchases", "customer-dues", "supplier-dues", "customer-statement", "supplier-statement",
  "collection", "daily-sales", "daily-purchase", "depot-deliveries", "depot-market-dues", "depot-dealer-ledger", "depot-company-ledger",
]);
/** these hold no customer / supplier data */
const NO_PARTY_DATA = new Set([
  "stock", "stock-valuation", "product-expiry", "expiry-value", "depot-free",
  "payroll-monthly", "payroll-employee-history", "payroll-payable", "payroll-payments", "payroll-department", "payroll-components",
]);
/** batch reports that name the supplier */
const SUPPLIER_NAMES = new Set(["expired-stock", "expiring-stock", "expiry"]);

/**
 * May this user open the report? Unrestricted users: yes. Assigned-only users: only reports that filter to their
 * parties or hold no party data — business-wide books (day book, cash book, trial balance, P&L, balance sheet…)
 * list every party and are refused.
 */
/** with only the account-head restriction: these filter to the assigned heads too */
const HEAD_FILTERED = new Set(["cash-book", "bank-book", "day-book"]);

export function reportOpenFor(ctx: { partyScope: PartyScope }, slug: string) {
  const { customers, suppliers } = ctx.partyScope;
  const heads = ctx.partyScope.accounts ?? null;
  if (customers === null && suppliers === null && heads === null) return true;
  if (PARTY_FILTERED.has(slug) || NO_PARTY_DATA.has(slug)) return true;
  // business-wide books stay closed to party-restricted users (they list every party)
  if (customers === null && suppliers === null && HEAD_FILTERED.has(slug)) return true;
  return SUPPLIER_NAMES.has(slug) && suppliers === null;
}

/** Report behind a menu path (/reports/<slug> and the pages that render a report). */
const PAGE_REPORTS: Record<string, string> = {
  "/expenses": "expenses", "/accounts/cash": "cash-book", "/accounts/bank": "bank-book", "/accounts/debtors": "customers", "/accounts/creditors": "suppliers",
  "/dues/customers": "customer-dues", "/dues/suppliers": "supplier-dues",
};
export function reportSlugForPath(href: string) {
  const path = href.split("?")[0];
  return PAGE_REPORTS[path] ?? (path.startsWith("/reports/") ? path.slice("/reports/".length) : null);
}
