// Pure arithmetic helpers — unit tested in tests/calc.test.ts.

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

export function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

export interface LineInput {
  quantity: number;
  unitPrice: number;
  discount?: number;
}

export interface DocumentTotals {
  subtotal: number;
  discount: number;
  vatAmount: number;
  total: number;
}

/** Line amount = qty × rate − line discount (never below zero). */
export function lineAmount(l: LineInput): number {
  const gross = round2(l.quantity * l.unitPrice);
  return round2(Math.max(gross - Math.min(Math.max(l.discount ?? 0, 0), gross), 0));
}

/**
 * subtotal = Σ line amounts; invoice discount (capped at subtotal) applies before VAT;
 * VAT is a percentage of (subtotal − discount).
 */
export function computeTotals(lines: LineInput[], discount = 0, vatPercent = 0): DocumentTotals {
  const subtotal = round2(lines.reduce((s, l) => s + lineAmount(l), 0));
  const safeDiscount = round2(Math.min(Math.max(discount, 0), subtotal));
  const taxable = subtotal - safeDiscount;
  const vatAmount = round2((taxable * Math.max(vatPercent, 0)) / 100);
  return { subtotal, discount: safeDiscount, vatAmount, total: round2(taxable + vatAmount) };
}

/** Moving weighted-average cost after receiving stock. */
export function weightedAverageCost(currentStock: number, currentCost: number, receivedQty: number, receivedUnitCost: number): number {
  const existing = Math.max(currentStock, 0);
  const totalQty = existing + receivedQty;
  if (totalQty <= 0) return round4(receivedUnitCost);
  return round4((existing * currentCost + receivedQty * receivedUnitCost) / totalQty);
}

export type PaymentStatus = "PAID" | "PARTIAL" | "DUE";

export function paymentStatus(total: number, paid: number): PaymentStatus {
  if (round2(paid) >= round2(total)) return "PAID";
  if (paid > 0) return "PARTIAL";
  return "DUE";
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PAID: "পরিশোধিত",
  PARTIAL: "আংশিক",
  DUE: "বাকি",
};
