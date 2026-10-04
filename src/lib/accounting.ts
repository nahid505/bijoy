// Pure double-entry posting rules. No I/O — every rule is unit tested (tests/accounting.test.ts).
//
// Conventions
//   • A voucher is a set of EntryLines; Σ debit must equal Σ credit (checked to the paisa).
//   • Account balance = Σ debit − Σ credit. Asset/expense accounts normally carry a debit
//     balance, liability/equity/income accounts a credit balance.
//   • Inventory is perpetual: sales post revenue AND cost of goods sold at moving-average cost.

import { round2 } from "./calc";

export interface EntryLine {
  accountId: string;
  debit: number;
  credit: number;
  narration?: string | null;
}

export class UnbalancedVoucherError extends Error {
  constructor(
    public readonly debit: number,
    public readonly credit: number,
  ) {
    super(`ভাউচার অসমতাপূর্ণ: মোট ডেবিট ${debit} ≠ মোট ক্রেডিট ${credit}`);
  }
}

export class InvalidEntryError extends Error {}

const dr = (accountId: string, amount: number, narration?: string | null): EntryLine => ({ accountId, debit: round2(amount), credit: 0, narration });
const cr = (accountId: string, amount: number, narration?: string | null): EntryLine => ({ accountId, debit: 0, credit: round2(amount), narration });

/** Rounds, drops zero lines and validates sign rules. */
export function normalizeEntries(lines: EntryLine[]): EntryLine[] {
  const out: EntryLine[] = [];
  for (const l of lines) {
    const debit = round2(l.debit || 0);
    const credit = round2(l.credit || 0);
    if (!l.accountId) throw new InvalidEntryError("প্রতিটি লাইনে হিসাব (লেজার) নির্বাচন করুন");
    if (debit < 0 || credit < 0) throw new InvalidEntryError("ডেবিট/ক্রেডিট ঋণাত্মক হতে পারবে না");
    if (debit > 0 && credit > 0) throw new InvalidEntryError("একই লাইনে ডেবিট ও ক্রেডিট দুটোই থাকতে পারবে না");
    if (debit === 0 && credit === 0) continue;
    out.push({ ...l, debit, credit });
  }
  return out;
}

export function totals(lines: EntryLine[]) {
  const debit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const credit = round2(lines.reduce((s, l) => s + l.credit, 0));
  return { debit, credit };
}

/** THE accounting rule: total debit must equal total credit. Throws otherwise. */
export function assertBalanced(lines: EntryLine[]): { debit: number; credit: number } {
  const t = totals(lines);
  if (t.debit !== t.credit) throw new UnbalancedVoucherError(t.debit, t.credit);
  return t;
}

/** Normalises and validates; returns posting-ready lines. */
export function prepareEntries(lines: EntryLine[], { allowEmpty = false } = {}): EntryLine[] {
  const norm = normalizeEntries(lines);
  if (!allowEmpty && norm.length < 2) throw new InvalidEntryError("কমপক্ষে দুটি লাইন (ডেবিট ও ক্রেডিট) প্রয়োজন");
  assertBalanced(norm);
  return norm;
}

// ───────────────────────── system account map ─────────────────────────

export interface SystemAccounts {
  CASH: string;
  INVENTORY: string;
  VAT_PAYABLE: string;
  OPENING_EQUITY: string;
  SALES: string;
  SALES_RETURN: string;
  COGS: string;
  DISCOUNT_ALLOWED: string;
  STOCK_ADJUSTMENT: string;
}

// ───────────────────────── posting rules ─────────────────────────

export interface PaymentLine {
  accountId: string; // cash / bank ledger
  amount: number;
}

export interface TradeInput {
  /** customer / supplier ledger; null = walk-in (cash) transaction */
  partyAccountId: string | null;
  /** settlement now, possibly split across several cash / bank ledgers */
  payments: PaymentLine[];
  subtotal: number; // Σ line amounts (after line discounts)
  discount: number; // invoice-level discount
  vatAmount: number;
  total: number; // subtotal − discount + vat
  cost: number; // inventory value moved (average cost)
}

export function paidOf(input: { payments: PaymentLine[] }): number {
  return round2(input.payments.reduce((s, p) => s + p.amount, 0));
}

function checkPayments(input: TradeInput) {
  const paid = paidOf(input);
  if (input.payments.some((p) => !p.accountId || p.amount <= 0)) throw new InvalidEntryError("প্রতিটি পেমেন্টে নগদ/ব্যাংক হিসাব ও টাকা দিন");
  if (paid > round2(input.total)) throw new InvalidEntryError("পরিশোধ মোট টাকার বেশি হতে পারবে না");
  if (!input.partyAccountId && paid !== round2(input.total)) throw new InvalidEntryError("পার্টি ছাড়া লেনদেনে সম্পূর্ণ টাকা পরিশোধ করতে হবে");
}

/**
 * The party side of a trade for the full voucher total. With a party it is the party ledger;
 * for walk-in trades it is the payment ledgers themselves (fully settled).
 */
function partySide(input: TradeInput, side: "dr" | "cr", narration: string): EntryLine[] {
  checkPayments(input);
  if (input.partyAccountId) return [side === "dr" ? dr(input.partyAccountId, input.total, narration) : cr(input.partyAccountId, input.total, narration)];
  return input.payments.map((p) => (side === "dr" ? dr(p.accountId, p.amount, narration) : cr(p.accountId, p.amount, narration)));
}

/** Settlement through cash/bank now (only when a party exists; walk-ins are settled in partySide). */
function settlement(input: TradeInput, direction: "in" | "out"): EntryLine[] {
  if (!input.partyAccountId) return [];
  const paid = paidOf(input);
  if (paid <= 0) return [];
  return direction === "in"
    ? [...input.payments.map((p) => dr(p.accountId, p.amount, "নগদ/ব্যাংকে প্রাপ্তি")), cr(input.partyAccountId, paid, "পরিশোধ")]
    : [dr(input.partyAccountId, paid, "পরিশোধ"), ...input.payments.map((p) => cr(p.accountId, p.amount, "নগদ/ব্যাংক থেকে প্রদান"))];
}

/**
 * Sales:   Dr Party (total) · Dr Discount allowed · Cr Sales (subtotal) · Cr VAT payable
 *          Dr COGS · Cr Inventory (at average cost)
 *          Dr Cash/Bank (each payment) · Cr Party (amount received now)
 */
export function salesEntries(input: TradeInput, acc: SystemAccounts): EntryLine[] {
  return [
    ...partySide(input, "dr", "বিক্রয়"),
    dr(acc.DISCOUNT_ALLOWED, input.discount, "বিক্রয়ে ছাড়"),
    cr(acc.SALES, input.subtotal, "পণ্য বিক্রয়"),
    cr(acc.VAT_PAYABLE, input.vatAmount, "আদায়কৃত ভ্যাট"),
    dr(acc.COGS, input.cost, "বিক্রিত পণ্যের ক্রয়মূল্য"),
    cr(acc.INVENTORY, input.cost, "মজুদ হ্রাস"),
    ...settlement(input, "in"),
  ];
}

/**
 * Purchase: Dr Inventory (net total) · Cr Party (total)
 *           Dr Party · Cr Cash/Bank (each payment)
 */
export function purchaseEntries(input: TradeInput, acc: SystemAccounts): EntryLine[] {
  return [dr(acc.INVENTORY, input.total, "মজুদ বৃদ্ধি (ক্রয়)"), ...partySide(input, "cr", "ক্রয়"), ...settlement(input, "out")];
}

/**
 * Sales return: Dr Sales return (total) · Cr Party
 *               Dr Inventory · Cr COGS (cost of returned goods)
 *               Dr Party · Cr Cash/Bank (refund paid now)
 */
export function salesReturnEntries(input: TradeInput, acc: SystemAccounts): EntryLine[] {
  return [
    dr(acc.SALES_RETURN, input.total, "বিক্রয় ফেরত"),
    ...partySide(input, "cr", "বিক্রয় ফেরত"),
    dr(acc.INVENTORY, input.cost, "মজুদ বৃদ্ধি (ফেরত)"),
    cr(acc.COGS, input.cost, "ফেরত পণ্যের ক্রয়মূল্য"),
    ...settlement(input, "out"),
  ];
}

/**
 * Purchase return: Dr Party (total) · Cr Inventory (at average cost)
 *                  difference between return value and cost → COGS
 *                  Dr Cash/Bank · Cr Party (refund received now)
 */
export function purchaseReturnEntries(input: TradeInput, acc: SystemAccounts): EntryLine[] {
  const diff = round2(input.total - input.cost);
  return [
    ...partySide(input, "dr", "ক্রয় ফেরত"),
    cr(acc.INVENTORY, input.cost, "মজুদ হ্রাস (ফেরত)"),
    diff > 0 ? cr(acc.COGS, diff, "ফেরত মূল্য পার্থক্য") : dr(acc.COGS, -diff, "ফেরত মূল্য পার্থক্য"),
    ...settlement(input, "in"),
  ];
}

export interface CashLine {
  accountId: string;
  amount: number;
  narration?: string | null;
}

/** Receipt: Dr Cash/Bank (Σ) · Cr each source ledger (customer, income, capital, loan …) */
export function receiptEntries(cashAccountId: string, lines: CashLine[]): EntryLine[] {
  const sum = round2(lines.reduce((s, l) => s + l.amount, 0));
  return [dr(cashAccountId, sum, "প্রাপ্তি"), ...lines.map((l) => cr(l.accountId, l.amount, l.narration))];
}

/** Payment: Dr each destination ledger (supplier, expense …) · Cr Cash/Bank (Σ) */
export function paymentEntries(cashAccountId: string, lines: CashLine[]): EntryLine[] {
  const sum = round2(lines.reduce((s, l) => s + l.amount, 0));
  return [...lines.map((l) => dr(l.accountId, l.amount, l.narration)), cr(cashAccountId, sum, "প্রদান")];
}

/** Journal voucher: free-form debit/credit lines; must balance. */
export function journalLinesFromInput(lines: { accountId: string; debit: number; credit: number; narration?: string | null }[]): EntryLine[] {
  return lines.map((l) => ({ accountId: l.accountId, debit: round2(l.debit), credit: round2(l.credit), narration: l.narration ?? null }));
}

/** Stock journal: value difference between stock-in and stock-out goes to the stock adjustment ledger. */
/**
 * Stock journal: the net value change goes against the adjustment ledger — STOCK_ADJUSTMENT by
 * default, or a specific ledger (e.g. expiry loss when expired goods are written off).
 */
export function stockJournalEntries(valueIn: number, valueOut: number, acc: SystemAccounts, adjustmentAccountId?: string | null, label = "স্টক সমন্বয়"): EntryLine[] {
  const diff = round2(valueIn - valueOut);
  if (diff === 0) return [];
  const adj = adjustmentAccountId || acc.STOCK_ADJUSTMENT;
  return diff > 0
    ? [dr(acc.INVENTORY, diff, "মজুদ উদ্বৃত্ত"), cr(adj, diff, label)]
    : [dr(adj, -diff, label), cr(acc.INVENTORY, -diff, "মজুদ ঘাটতি")];
}

/** Opening balance: signed amount (+ = debit balance) against the opening-balance equity ledger. */
export function openingEntries(accountId: string, signedAmount: number, acc: SystemAccounts): EntryLine[] {
  const amt = round2(signedAmount);
  if (amt === 0) return [];
  return amt > 0
    ? [dr(accountId, amt, "প্রারম্ভিক ব্যালেন্স"), cr(acc.OPENING_EQUITY, amt, "প্রারম্ভিক ব্যালেন্স")]
    : [dr(acc.OPENING_EQUITY, -amt, "প্রারম্ভিক ব্যালেন্স"), cr(accountId, -amt, "প্রারম্ভিক ব্যালেন্স")];
}

// ───────────────────────── balances & presentation ─────────────────────────

export type Nature = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";

export function isDebitNature(nature: Nature): boolean {
  return nature === "ASSET" || nature === "EXPENSE";
}

/** Balance in the account's natural direction (positive = normal side). */
export function naturalBalance(nature: Nature, debitMinusCredit: number): number {
  return round2(isDebitNature(nature) ? debitMinusCredit : -debitMinusCredit);
}

export const NATURE_LABELS: Record<Nature, string> = {
  ASSET: "সম্পদ",
  LIABILITY: "দায়",
  EQUITY: "মূলধন",
  INCOME: "আয়",
  EXPENSE: "ব্যয়",
};

export const VOUCHER_TYPES = {
  RECEIPT: { slug: "receipt", label: "রিসিপ্ট", long: "রিসিপ্ট ভাউচার", prefix: "RV" },
  PAYMENT: { slug: "payment", label: "পেমেন্ট", long: "পেমেন্ট ভাউচার", prefix: "PV" },
  JOURNAL: { slug: "journal", label: "জার্নাল", long: "জার্নাল ভাউচার", prefix: "JV" },
  SALES: { slug: "sales", label: "বিক্রয়", long: "বিক্রয় ভাউচার", prefix: "INV" },
  PURCHASE: { slug: "purchase", label: "ক্রয়", long: "ক্রয় ভাউচার", prefix: "PUR" },
  SALES_RETURN: { slug: "sales-return", label: "বিক্রয় ফেরত", long: "বিক্রয় ফেরত ভাউচার", prefix: "SR" },
  PURCHASE_RETURN: { slug: "purchase-return", label: "ক্রয় ফেরত", long: "ক্রয় ফেরত ভাউচার", prefix: "PR" },
  STOCK_JOURNAL: { slug: "stock-journal", label: "স্টক জার্নাল", long: "স্টক জার্নাল", prefix: "SJ" },
  OPENING: { slug: "opening", label: "প্রারম্ভিক", long: "প্রারম্ভিক ব্যালেন্স", prefix: "OB" },
} as const;

export type VoucherTypeKey = keyof typeof VOUCHER_TYPES;

export type EditableVoucherType = Exclude<VoucherTypeKey, "OPENING">;

export function voucherTypeFromSlug(slug: string): EditableVoucherType | null {
  const hit = (Object.keys(VOUCHER_TYPES) as VoucherTypeKey[]).find((k) => VOUCHER_TYPES[k].slug === slug);
  return hit && hit !== "OPENING" ? hit : null;
}

export const TRADE_TYPES: VoucherTypeKey[] = ["SALES", "PURCHASE", "SALES_RETURN", "PURCHASE_RETURN"];

/** Which permission family governs a voucher type. */
export function voucherPermissionFamily(type: VoucherTypeKey): "sales" | "purchases" | "vouchers" | "stock" {
  if (type === "SALES" || type === "SALES_RETURN") return "sales";
  if (type === "PURCHASE" || type === "PURCHASE_RETURN") return "purchases";
  if (type === "STOCK_JOURNAL") return "stock";
  return "vouchers";
}

// ───────────────────────── units ─────────────────────────

export interface UnitLike {
  id: string;
  baseUnitId: string | null;
  factor: number;
}

/** Factor to convert a quantity in `unit` into the product's base unit; null if incompatible. */
export function unitConversionFactor(unit: UnitLike, productUnit: UnitLike): number | null {
  if (unit.id === productUnit.id) return 1;
  const root = (u: UnitLike) => u.baseUnitId ?? u.id;
  const toRoot = (u: UnitLike) => (u.baseUnitId ? u.factor : 1);
  if (root(unit) !== root(productUnit)) return null;
  return toRoot(unit) / toRoot(productUnit);
}
