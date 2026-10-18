// Depot management (business type DEPOT) — shared labels and calculations (forms, server, reports).
//
//   COMPANY_PAID      "কোম্পানি পেইড (ডিও রিলিজ)": the dealer paid the company; the depot only delivers the
//                     released goods. Line amount = quantity × commission rate (the depot's commission).
//   DEPOT_COLLECTION  "ডিপো কালেকশন (মার্কেট সেলস)": the depot sells to the dealer for cash or on market
//                     credit. Line amount = quantity × sale rate.
import { round2, round3 } from "./calc";
import type { Permission } from "./permissions";

export const DEPOT = "DEPOT";
/** depot book: equity "transferred to the main business" (debited when commission moves to general income) */
export const TRANSFER_OUT_KEY = "DEPOT_TRANSFER_TO_GENERAL";
/** general book: income account receiving the transferred depot commission (not a DEPOT_ key: it is a general ledger) */
export const GENERAL_COMMISSION_INCOME_KEY = "GENERAL_DEPOT_COMMISSION";
/** sourceKey prefix of the two linked transfer vouchers */
export const TRANSFER_SOURCE = "depot-transfer:";

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
  register: ["depot:view", "depot:reports_view", "reports:view"],
  /** free scheme report */
  scheme: ["depot:scheme_manage", "reports:view"],
  /** dealer list / create / edit */
  dealers: ["depot:delivery_manage", "customers:manage"],
  dealersView: ["depot:view", "depot:delivery_manage", "depot:reports_view", "customers:view"],
  /** depot payment to the company */
  payment: ["depot:stock_in", "vouchers:create"],
  /** depot voucher lists (stock in / collections / company payments) */
  stockInView: ["depot:stock_in", "purchases:view"],
  collectionView: ["depot:collection_create", "vouchers:view"],
  paymentView: ["depot:stock_in", "vouchers:view"],
} as const satisfies Record<string, readonly Permission[]>;

/** The default depot-only role (created for depot businesses). */
export const DEPOT_ROLE = {
  name: "ডিপো হিসাবরক্ষক (Depot Accountant)",
  description: "শুধু ডিপো ব্যবস্থাপনা — চালান, স্টক ইন, মার্কেট কালেকশন ও ডিপো রিপোর্ট; সাধারণ হিসাব, লেজার ও সেটিং নয়",
  permissions: ["depot:view", "depot:delivery_manage", "depot:stock_in", "depot:collection_create", "depot:reports_view", "depot:scheme_manage"] as Permission[],
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
