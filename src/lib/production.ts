// Production (BOM) calculations — pure, shared by the production form (live preview) and the server.
//
// A recipe describes one reference batch, e.g. 100 kg paddy → 65 kg rice + 20 kg husk + 8 kg bran
// + 5 kg broken rice (2 kg process loss). A production run scales it by `batches`
// (1 000 kg paddy = 10 batches); the actual output may then be corrected by hand.
//
// Costing: the run's cost = materials consumed (at moving-average cost) + extra cost (labour, power…).
// It is split between the outputs by their cost share (%), so the main product carries most of the
// cost and by-products a small part. Normal process loss is absorbed by the products made.
import { round2, round3, round4 } from "./calc";

export interface RecipeLineInput {
  productId: string;
  quantity: number; // per reference batch (base unit)
  costShare?: number; // outputs only, %
}

export interface ScaledLine extends RecipeLineInput {
  quantity: number;
}

/** Number of reference batches for a given quantity of the recipe's first (main) input. */
export function batchesFor(mainInputPerBatch: number, mainInputQuantity: number): number {
  if (!(mainInputPerBatch > 0) || !(mainInputQuantity > 0)) return 0;
  return round4(mainInputQuantity / mainInputPerBatch);
}

/** Scales recipe lines to `batches` reference batches. */
export function scaleLines<T extends RecipeLineInput>(lines: T[], batches: number): (T & { quantity: number })[] {
  return lines.map((l) => ({ ...l, quantity: round3(l.quantity * batches) }));
}

/** Yield of an output relative to the main input, in % (e.g. 65 kg rice from 100 kg paddy = 65 %). */
export function yieldPercent(outputQuantity: number, mainInputQuantity: number): number {
  return mainInputQuantity > 0 ? round2((outputQuantity / mainInputQuantity) * 100) : 0;
}

/**
 * Process loss (weight / volume lost) when every line uses the same unit: inputs − outputs.
 * null when the units differ (a loss in mixed units is meaningless).
 */
export function processLoss(inputs: { quantity: number; unitId: string }[], outputs: { quantity: number; unitId: string }[]) {
  const units = new Set([...inputs, ...outputs].map((l) => l.unitId));
  if (units.size !== 1 || inputs.length === 0 || outputs.length === 0) return null;
  const totalIn = round3(inputs.reduce((s, l) => s + l.quantity, 0));
  const totalOut = round3(outputs.reduce((s, l) => s + l.quantity, 0));
  const quantity = round3(totalIn - totalOut);
  return { quantity, percent: totalIn > 0 ? round2((quantity / totalIn) * 100) : 0, totalIn, totalOut };
}

/** Sum of the outputs' cost shares (must be 100). */
export const shareTotal = (outputs: { costShare?: number }[]) => round4(outputs.reduce((s, o) => s + (o.costShare ?? 0), 0));
export const sharesValid = (outputs: { costShare?: number }[]) => Math.abs(shareTotal(outputs) - 100) < 0.01;

/**
 * Cost shares from sale value (quantity × sale price) — the usual way to split joint costs between a
 * main product and its by-products. Falls back to quantity when no sale prices are known.
 * Rounded to 2 decimals; the largest share absorbs the rounding so the total is exactly 100.
 */
export function sharesBySaleValue(outputs: { quantity: number; salePrice: number }[]): number[] {
  const values = outputs.map((o) => Math.max(0, o.quantity) * Math.max(0, o.salePrice));
  const base = values.some((v) => v > 0) ? values : outputs.map((o) => Math.max(0, o.quantity));
  const total = base.reduce((s, v) => s + v, 0);
  if (total <= 0) return outputs.map((_, i) => (i === 0 ? 100 : 0));
  const shares = base.map((v) => round2((v / total) * 100));
  const diff = round2(100 - shares.reduce((s, v) => s + v, 0));
  const top = base.indexOf(Math.max(...base));
  shares[top] = round2(shares[top] + diff);
  return shares;
}

/**
 * Splits `totalCost` between outputs by cost share. Amounts are rounded to paisa and the last
 * output with a share absorbs the rounding, so Σ amounts = totalCost exactly (keeps the ledger
 * balanced). Returns per-output amount and unit cost.
 */
export function allocateCost(totalCost: number, outputs: { quantity: number; costShare: number }[]): { amount: number; unitCost: number }[] {
  const total = round2(totalCost);
  const shareSum = outputs.reduce((s, o) => s + o.costShare, 0);
  const amounts = outputs.map((o) => (shareSum > 0 ? round2((total * o.costShare) / shareSum) : 0));
  const last = outputs.map((o) => o.costShare > 0).lastIndexOf(true);
  if (last >= 0) amounts[last] = round2(amounts[last] + round2(total - amounts.reduce((s, a) => s + a, 0)));
  return outputs.map((o, i) => ({ amount: amounts[i], unitCost: o.quantity > 0 ? round4(amounts[i] / o.quantity) : 0 }));
}

/** Rice mill starter recipe: per 100 kg paddy (typical boiled-rice milling yields in Bangladesh). */
export const RICE_MILL_TEMPLATE = {
  recipeName: "ধান ভাঙানো (চাল উৎপাদন)",
  input: { name: "ধান", quantity: 100 },
  outputs: [
    { name: "চাল", quantity: 65, costShare: 88 },
    { name: "খুদ (ভাঙা চাল)", quantity: 5, costShare: 5 },
    { name: "কুঁড়া (রাইস ব্রান)", quantity: 8, costShare: 5 },
    { name: "তুষ", quantity: 20, costShare: 2 },
  ],
} as const;
