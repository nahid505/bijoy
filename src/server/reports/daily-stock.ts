import "server-only";
// দৈনিক স্টক রিপোর্ট (Daily Stock Report) for one date and, optionally, one warehouse:
//
//   পূর্বের মজুদ   = stock movements before the day (in − out)
//   উৎপাদন / ক্রয় = the day's movements in  (purchase, production output, stock journal in, returns in, opening …)
//   বিক্রয় / ব্যবহার = the day's movements out (sale, production input, stock journal out, write-off …)
//   আজকের মজুদ    = পূর্বের মজুদ + উৎপাদন / ক্রয় − বিক্রয় / ব্যবহার
//
// General products only (depot stock has its own pages, as in the stock report). A product shows when it has stock
// or moved on the day; quantities are in each product's base unit, so the totals are given per unit.
import { prisma, num } from "@/lib/db";
import { round3 } from "@/lib/calc";
import { dayOrToday, dayRange, formatDate, formatQty } from "@/lib/format";
import type { ReportDef, ReportRow } from "./types";

export interface DailyStockRow {
  id: string;
  name: string;
  code: string | null;
  unit: string;
  opening: number;
  in: number;
  out: number;
  closing: number;
}

/** Totals per unit: { কেজি: 1200, পিস: 40 } */
export type UnitTotals = Record<string, number>;

export async function dailyStock(businessId: string, params: { date?: string; warehouseId?: string }) {
  const date = dayOrToday(params.date);
  const range = dayRange(date, date) as { gte: Date; lt: Date };
  const warehouses = await prisma.warehouse.findMany({ where: { businessId }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const warehouse = params.warehouseId ? warehouses.find((w) => w.id === params.warehouseId) ?? null : null;
  const base = { businessId, product: { isDepotProduct: false }, ...(warehouse ? { warehouseId: warehouse.id } : {}) };
  const [products, before, during] = await Promise.all([
    prisma.product.findMany({ where: { businessId, isDepotProduct: false }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: { select: { name: true } } } }),
    prisma.stockMovement.groupBy({ by: ["productId"], where: { ...base, date: { lt: range.gte } }, _sum: { quantityIn: true, quantityOut: true } }),
    prisma.stockMovement.groupBy({ by: ["productId"], where: { ...base, date: range }, _sum: { quantityIn: true, quantityOut: true } }),
  ]);
  const opening = new Map(before.map((r) => [r.productId, num(r._sum.quantityIn) - num(r._sum.quantityOut)]));
  const day = new Map(during.map((r) => [r.productId, { in: num(r._sum.quantityIn), out: num(r._sum.quantityOut) }]));
  const rows: DailyStockRow[] = [];
  for (const p of products) {
    const o = round3(opening.get(p.id) ?? 0);
    const d = day.get(p.id) ?? { in: 0, out: 0 };
    const closing = round3(o + d.in - d.out);
    if (o === 0 && d.in === 0 && d.out === 0 && closing === 0) continue; // nothing to show
    rows.push({ id: p.id, name: p.name, code: p.code, unit: p.unit.name, opening: o, in: round3(d.in), out: round3(d.out), closing });
  }
  const sum = (pick: (r: DailyStockRow) => number): UnitTotals => {
    const t: UnitTotals = {};
    for (const r of rows) t[r.unit] = round3((t[r.unit] ?? 0) + pick(r));
    return t;
  };
  return {
    date,
    warehouse,
    warehouses,
    rows,
    totals: { opening: sum((r) => r.opening), in: sum((r) => r.in), out: sum((r) => r.out), closing: sum((r) => r.closing) },
  };
}

/** "১,২০০ কেজি · ৪০ পিস" — a total per unit (units are never added together) */
export const unitTotalsText = (t: UnitTotals) => Object.entries(t).map(([u, q]) => `${formatQty(q)} ${u}`).join(" · ") || "০";

/** Registry entry: the reports index and the CSV / Excel export (?date=&warehouseId=); the screen has its own page. */
export const DAILY_STOCK_REPORT: ReportDef = {
  slug: "daily-stock",
  title: "দৈনিক স্টক রিপোর্ট",
  description: "নির্দিষ্ট দিনের পূর্বের মজুদ, উৎপাদন বা ক্রয়, বিক্রয় বা ব্যবহার ও আজকের মজুদ — পণ্যভিত্তিক, গুদাম অনুযায়ী",
  filters: [],
  permission: "reports:view",
  async run(ctx, p) {
    const d = await dailyStock(ctx.business.id, { date: p.date, warehouseId: p.warehouseId });
    const rows: ReportRow[] = d.rows.map((r, i) => ({
      href: `/products/${r.id}`,
      cells: { no: String(i + 1), product: r.name, unit: r.unit, opening: r.opening, in: r.in, out: r.out, closing: r.closing },
    }));
    rows.push({
      kind: "total",
      cells: { no: null, product: "মোট", unit: "", opening: unitTotalsText(d.totals.opening), in: unitTotalsText(d.totals.in), out: unitTotalsText(d.totals.out), closing: unitTotalsText(d.totals.closing) },
    });
    return {
      title: "দৈনিক স্টক রিপোর্ট",
      subtitle: `${formatDate(d.date)} — ${d.warehouse ? `গুদাম: ${d.warehouse.name}` : "সব গুদাম"}`,
      columns: [
        { key: "no", label: "নং" },
        { key: "product", label: "পণ্যের নাম" },
        { key: "unit", label: "ইউনিট" },
        { key: "opening", label: "পূর্বের মজুদ", format: "qty" },
        { key: "in", label: "উৎপাদন / ক্রয়", format: "qty" },
        { key: "out", label: "বিক্রয় / ব্যবহার", format: "qty" },
        { key: "closing", label: "আজকের মজুদ", format: "qty" },
      ],
      rows,
      emptyMessage: "এই দিনে কোনো মজুদ বা লেনদেন নেই",
    };
  },
};
