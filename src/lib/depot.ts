// Depot management (business type DEPOT) — shared labels and calculations (forms, server, reports).
//
//   COMPANY_PAID      "কোম্পানি পেইড (ডিও রিলিজ)": the dealer paid the company; the depot only delivers the
//                     released goods. Line amount = quantity × commission rate (the depot's commission).
//   DEPOT_COLLECTION  "ডিপো কালেকশন (মার্কেট সেলস)": the depot sells to the dealer for cash or on market
//                     credit. Line amount = quantity × sale rate.
import { round2, round3, round4 } from "./calc";
import type { Permission } from "./permissions";

export const DEPOT = "DEPOT";
/** depot book: equity "transferred to the main business" (debited when commission moves to general income) */
export const TRANSFER_OUT_KEY = "DEPOT_TRANSFER_TO_GENERAL";
/** general book: income account receiving the transferred depot commission (not a DEPOT_ key: it is a general ledger) */
export const GENERAL_COMMISSION_INCOME_KEY = "GENERAL_DEPOT_COMMISSION";
/** sourceKey prefix of the two linked transfer vouchers */
export const TRANSFER_SOURCE = "depot-transfer:";
/**
 * "ডিপো ক্যাশ": the depot's own cash box — a general-book cash ledger (group নগদ), so the depot's expenses reach
 * the business's P&L and cash flow. It is filled by a fund transfer from the main cash / bank and spent by depot
 * expenses; depot-book collections and company payments may use it too. Not a DEPOT_ key: usable in both books.
 */
export const DEPOT_CASH_KEY = "GENERAL_DEPOT_CASH";
export const DEPOT_CASH_NAME = "ডিপো ক্যাশ";
/** sourceKey prefixes: a depot expense (general PAYMENT) and a fund transfer main cash ⇄ depot cash (general JOURNAL) */
export const DEPOT_EXPENSE_SOURCE = "depot-expense:";
export const DEPOT_FUND_SOURCE = "depot-fund:";
/** sourceKeys linked by a random key (not a record id) — kept as they are by backup restore */
export const RANDOM_SOURCE_PREFIXES = [TRANSFER_SOURCE, DEPOT_EXPENSE_SOURCE, DEPOT_FUND_SOURCE];

/**
 * Who may open each depot screen: the depot permission (a depot-only role, e.g. "ডিপো হিসাবরক্ষক") or the
 * general permission the screen used before (so existing roles keep working). Each list means "any of".
 * The depot keys work only in a depot business; stock in and market collection reuse the purchase /
 * receipt forms (see depotVoucherPermission in src/server/voucher-permissions.ts).
 */
export const DEPOT_ACCESS = {
  /** depot dashboard, challan list, dealer copy */
  view: ["depot:view", "depot:delivery_manage", "sales:view"],
  deliveryCreate: ["depot:delivery_manage", "sales:create"],
  deliveryEdit: ["depot:delivery_manage", "sales:edit"],
  stockIn: ["depot:stock_in", "purchases:create"],
  collection: ["depot:collection_create", "vouchers:create"],
  /** company commission page */
  commission: ["depot:reports_view", "depot:view", "sales:view"],
  /** settle / receive company commission */
  settle: ["depot:collection_create", "vouchers:create"],
  /** market dues by route, commission report */
  reports: ["depot:reports_view", "reports:view"],
  /** delivery register (the list's print / Excel) */
  register: ["depot:register_view", "reports:view"],
  /** free scheme report */
  scheme: ["depot:scheme_manage", "reports:view"],
  /** company ledger (depot book), depot P&L, depot cash book */
  companyLedger: ["depot:company_ledger", "reports:view"],
  profitLoss: ["depot:profit_loss", "reports:view"],
  cashbook: ["depot:cashbook", "reports:view"],
  /** dealer list / profile, and create / edit / delete */
  dealersView: ["depot:dealers_manage", "customers:view"],
  dealers: ["depot:dealers_manage", "customers:manage"],
  /** depot (dealership) products: list / profile, and create / edit / delete (/depot/products) */
  productsView: ["depot:products_manage", "inventory:view"],
  products: ["depot:products_manage", "inventory:manage"],
  /** "+ নতুন ডিলার তৈরি করুন" inside a challan */
  dealerQuickCreate: ["depot:dealers_manage", "depot:delivery_manage", "customers:manage"],
  /** depot payment to the company */
  payment: ["depot:company_payment", "vouchers:create"],
  /** depot voucher lists (stock in / collections / company payments) */
  stockInView: ["depot:stock_in", "purchases:view"],
  collectionView: ["depot:collection_create", "vouchers:view"],
  paymentView: ["depot:company_payment", "vouchers:view"],
  /** depot stock adjustment: its own key only — without it the page and the menu are closed */
  stockAdjust: ["depot:stock_adjust"],
  /** depot expenses (paid from ডিপো ক্যাশ): its own key only */
  expense: ["depot:expense_manage"],
  /** fund transfer main cash / bank ⇄ ডিপো ক্যাশ: moves general cash, so a general voucher permission */
  fund: ["vouchers:create"],
} as const satisfies Record<string, readonly Permission[]>;

/** The default depot-only role (created for depot businesses). */
export const DEPOT_ROLE = {
  name: "ডিপো হিসাবরক্ষক (Depot Accountant)",
  description: "শুধু ডিপো ব্যবস্থাপনা — চালান, স্টক ইন, মার্কেট কালেকশন, ডিপো খরচ ও ডিপো রিপোর্ট; সাধারণ হিসাব, লেজার ও সেটিং নয়",
  permissions: [
    "depot:view", "depot:delivery_manage", "depot:dealers_manage", "depot:products_manage", "depot:stock_in", "depot:stock_adjust", "depot:collection_create", "depot:company_payment", "depot:expense_manage",
    "depot:reports_view", "depot:register_view", "depot:scheme_manage", "depot:company_ledger", "depot:profit_loss", "depot:cashbook",
  ] as Permission[],
};

/**
 * One-time upgrade of roles made with the first, smaller depot set (6 keys) to the full set: each old key brings
 * the new keys that used to be part of it, so no role loses a screen it could open. (Run once per business —
 * see upgradeDepotPermissions in src/server/services/bootstrap.ts; a key removed afterwards stays removed.)
 */
export const DEPOT_PERMISSION_UPGRADE: Record<string, Permission[]> = {
  "depot:view": ["depot:register_view"],
  "depot:delivery_manage": ["depot:dealers_manage"],
  // products_manage: 20261022000000_depot_products (whoever receives the company's goods keeps its product list)
  "depot:stock_in": ["depot:stock_adjust", "depot:company_payment", "depot:company_ledger", "depot:products_manage"],
  "depot:reports_view": ["depot:register_view", "depot:profit_loss", "depot:cashbook"],
  // 20261019000000_depot_expense: whoever pays the company from the depot cash may also record depot expenses
  "depot:company_payment": ["depot:expense_manage"],
};
export const DEPOT_MODES = ["COMPANY_PAID", "DEPOT_COLLECTION"] as const;
export type DepotMode = (typeof DEPOT_MODES)[number];

export const DEPOT_MODE_LABELS: Record<DepotMode, string> = {
  COMPANY_PAID: "কোম্পানি পেইড (ডিও রিলিজ)",
  DEPOT_COLLECTION: "ডিপো কালেকশন (মার্কেট সেলস)",
};
export const DEPOT_MODE_SHORT: Record<DepotMode, string> = {
  COMPANY_PAID: "ডিও রিলিজ",
  DEPOT_COLLECTION: "মার্কেট সেলস",
};

/** Ledger keys: commission income (one) and one commission receivable per company. */
export const COMMISSION_INCOME_KEY = "DEPOT_COMMISSION_INCOME";
export const COMMISSION_RECEIVABLE_PREFIX = "DEPOT_COMMISSION_RECEIVABLE:";
export const commissionReceivableKey = (companyAccountId: string) => `${COMMISSION_RECEIVABLE_PREFIX}${companyAccountId}`;

export const isDepot = (businessType: string | null | undefined) => businessType === DEPOT;

export type DepotCommissionType = "FIXED" | "PERCENT";
export const COMMISSION_TYPE_LABELS: Record<DepotCommissionType, string> = { FIXED: "ফিক্সড (৳ প্রতি একক)", PERCENT: "শতাংশ (ডিপি-র %)" };
/** A depot product's DO commission per base unit: FIXED taka, or PERCENT of the company price (DP = purchasePrice). */
export function commissionPerUnit(p: { depotCommissionType?: string | null; depotCommissionRate: number; purchasePrice: number }): number {
  return p.depotCommissionType === "PERCENT" ? round4(((Number(p.purchasePrice) || 0) * (Number(p.depotCommissionRate) || 0)) / 100) : Number(p.depotCommissionRate) || 0;
}
/** "৳ 10 / একক" or "2.5% (৳ 11.25 / একক)" */
export function commissionText(p: { depotCommissionType?: string | null; depotCommissionRate: number; purchasePrice: number }, fmt: (n: number) => string): string {
  const per = commissionPerUnit(p);
  return p.depotCommissionType === "PERCENT" ? `${Number(p.depotCommissionRate)}% (${fmt(per)} / একক)` : `${fmt(per)} / একক`;
}

export interface DepotLine {
  quantity: number;
  /** dealer challan rate (the product's purchase price); the challan amount = quantity × challanRate */
  challanRate?: number;
  /** free / scheme quantity — leaves the stock, never billed and earns no commission */
  freeQuantity?: number;
  rate: number;
}

/** Line amounts (paid quantity × rate; free goods are never billed) and totals: commission for
 *  COMPANY_PAID, sale value for DEPOT_COLLECTION. Stock out = quantity + free. */
export function depotTotals(lines: DepotLine[]): { amounts: number[]; quantity: number; free: number; stockOut: number; total: number } {
  const amounts = lines.map((l) => round2((Number(l.quantity) || 0) * (Number(l.rate) || 0)));
  return {
    amounts,
    quantity: round3(lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)),
    free: round3(lines.reduce((s, l) => s + (Number(l.freeQuantity) || 0), 0)),
    stockOut: round3(lines.reduce((s, l) => s + (Number(l.quantity) || 0) + (Number(l.freeQuantity) || 0), 0)),
    total: round2(amounts.reduce((s, a) => s + a, 0)),
  };
}

/** Dealer challan: amount per line = supplied quantity × challan rate (free goods are never priced). */
export function challanTotals(lines: { quantity: number; challanRate?: number | null }[]): { amounts: number[]; total: number } {
  const amounts = lines.map((l) => round2((Number(l.quantity) || 0) * (Number(l.challanRate) || 0)));
  return { amounts, total: round2(amounts.reduce((t, a) => t + a, 0)) };
}
