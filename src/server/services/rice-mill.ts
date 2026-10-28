// Auto rice mill (business type AUTO_RICE_MILL): read-only views over the existing building blocks —
//   paddy & weighbridge  PaddyPurchase slips (PURCHASE vouchers) + their labour payments (paddy-labour:<id>)
//   milling              PRODUCTION vouchers (ProductionRun): paddy out (direction −1) → rice and by-products in (+1)
//   sales                ordinary SALES / SALES_RETURN vouchers of the mill's products (party ledgers post as usual)
// Which products belong to the mill: paddy = bought on a slip or used as a production / recipe input; rice and
// by-products (চাল, খুদ, কুঁড়া, তুষ …) = production / recipe outputs. Nothing here writes to the database.
import { prisma, num } from "@/lib/db";
import { round2, round3 } from "@/lib/calc";
import { KG_PER_MON } from "@/lib/paddy";
import type { DateRange } from "./ledger";

export interface MillProducts {
  paddy: string[];
  outputs: string[];
}

/** The mill's products: paddy (inputs) and rice / by-products (outputs). A product that is both counts as output. */
export async function millProducts(businessId: string): Promise<MillProducts> {
  const [slips, recipe, produced] = await Promise.all([
    prisma.voucherItem.findMany({ where: { voucher: { businessId, paddyPurchase: { isNot: null } } }, select: { productId: true }, distinct: ["productId"] }),
    prisma.recipeLine.findMany({ where: { recipe: { businessId } }, select: { productId: true, kind: true }, distinct: ["productId", "kind"] }),
    prisma.voucherItem.findMany({ where: { voucher: { businessId, type: "PRODUCTION" } }, select: { productId: true, direction: true }, distinct: ["productId", "direction"] }),
  ]);
  const outputs = new Set([...recipe.filter((l) => l.kind === "OUTPUT").map((l) => l.productId), ...produced.filter((i) => i.direction > 0).map((i) => i.productId)]);
  const paddy = new Set([...slips.map((s) => s.productId), ...recipe.filter((l) => l.kind === "INPUT").map((l) => l.productId), ...produced.filter((i) => i.direction < 0).map((i) => i.productId)]);
  for (const id of outputs) paddy.delete(id);
  return { paddy: [...paddy], outputs: [...outputs] };
}

export interface MillStockRow {
  id: string;
  name: string;
  code: string | null;
  unit: string;
  stock: number;
  /** stock in মণ when the unit is কেজি (else null) */
  mon: number | null;
  avgCost: number;
  value: number;
}

const isKg = (unit: string) => /কেজি|kg/i.test(unit);

/** Current stock of paddy and of rice / by-products, with value at average cost. */
export async function millStock(businessId: string) {
  const ids = await millProducts(businessId);
  const rows = await prisma.product.findMany({
    where: { businessId, id: { in: [...ids.paddy, ...ids.outputs] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true, stock: true, avgCost: true, unit: { select: { name: true } } },
  });
  const toRow = (p: (typeof rows)[number]): MillStockRow => {
    const stock = round3(num(p.stock));
    return { id: p.id, name: p.name, code: p.code, unit: p.unit.name, stock, mon: isKg(p.unit.name) ? round2(stock / KG_PER_MON) : null, avgCost: num(p.avgCost), value: round2(stock * num(p.avgCost)) };
  };
  const paddy = rows.filter((r) => ids.paddy.includes(r.id)).map(toRow);
  const outputs = rows.filter((r) => ids.outputs.includes(r.id)).map(toRow);
  const total = (list: MillStockRow[]) => round2(list.reduce((s, r) => s + r.value, 0));
  return { paddy, outputs, paddyValue: total(paddy), outputValue: total(outputs) };
}

export interface MillSaleLine {
  productId: string;
  name: string;
  unit: string;
  /** base units; returns negative */
  quantity: number;
  revenue: number;
  cost: number;
}

/**
 * Sales of rice and by-products in a period (general sales minus their returns): every voucher with at least one
 * mill output line, and the totals per product (revenue = line amounts; cost = the stock movements' average cost).
 */
export async function millSales(businessId: string, range: DateRange, opts: { take?: number } = {}) {
  const { outputs } = await millProducts(businessId);
  const items = outputs.length
    ? await prisma.voucherItem.findMany({
        where: { productId: { in: outputs }, voucher: { businessId, book: "GENERAL", type: { in: ["SALES", "SALES_RETURN"] }, ...(range.gte || range.lt ? { date: range } : {}) } },
        select: {
          id: true, productId: true, baseQuantity: true, amount: true,
          product: { select: { name: true, unit: { select: { name: true } } } },
          voucher: { select: { id: true, voucherNo: true, date: true, type: true, amount: true, paidAmount: true, partyAccount: { select: { name: true } } } },
          stockMovements: { select: { value: true } },
        },
      })
    : [];
  const byProduct = new Map<string, MillSaleLine>();
  const byVoucher = new Map<string, { id: string; voucherNo: string; date: Date; type: string; party: string | null; amount: number; paid: number; lines: string[] }>();
  for (const it of items) {
    const sign = it.voucher.type === "SALES_RETURN" ? -1 : 1;
    const p = byProduct.get(it.productId) ?? { productId: it.productId, name: it.product.name, unit: it.product.unit.name, quantity: 0, revenue: 0, cost: 0 };
    p.quantity = round3(p.quantity + sign * num(it.baseQuantity));
    p.revenue = round2(p.revenue + sign * num(it.amount));
    p.cost = round2(p.cost + sign * it.stockMovements.reduce((s, m) => s + num(m.value), 0));
    byProduct.set(it.productId, p);
    const v = byVoucher.get(it.voucher.id) ?? { id: it.voucher.id, voucherNo: it.voucher.voucherNo, date: it.voucher.date, type: it.voucher.type, party: it.voucher.partyAccount?.name ?? null, amount: num(it.voucher.amount), paid: num(it.voucher.paidAmount), lines: [] };
    v.lines.push(it.product.name);
    byVoucher.set(it.voucher.id, v);
  }
  const products = [...byProduct.values()].sort((a, b) => b.revenue - a.revenue);
  const vouchers = [...byVoucher.values()].sort((a, b) => b.date.getTime() - a.date.getTime() || b.voucherNo.localeCompare(a.voucherNo));
  return {
    products,
    vouchers: opts.take ? vouchers.slice(0, opts.take) : vouchers,
    voucherCount: vouchers.length,
    revenue: round2(products.reduce((s, p) => s + p.revenue, 0)),
    cost: round2(products.reduce((s, p) => s + p.cost, 0)),
  };
}

export interface MillYieldLine {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  /** % of the paddy milled (same unit only; null otherwise) */
  percent: number | null;
}

/** Paddy bought, paddy milled and what came out (yield %), labour and production costs, in a period. */
export async function millSummary(businessId: string, range: DateRange) {
  const dateWhere = range.gte || range.lt ? { date: range } : {};
  const [slips, labour, runs, items] = await Promise.all([
    prisma.paddyPurchase.findMany({ where: { businessId, voucher: dateWhere }, select: { variety: true, netKg: true, mon: true, totalPrice: true, labourCost: true } }),
    prisma.voucher.aggregate({ where: { businessId, sourceKey: { startsWith: "paddy-labour:" }, ...dateWhere }, _sum: { amount: true } }),
    prisma.productionRun.findMany({ where: { businessId, voucher: dateWhere }, select: { extraCost: true } }),
    prisma.voucherItem.findMany({
      where: { voucher: { businessId, type: "PRODUCTION", ...dateWhere } },
      select: { productId: true, direction: true, baseQuantity: true, product: { select: { name: true, unit: { select: { name: true } } } } },
    }),
  ]);
  // purchases by variety
  const varieties = new Map<string, { variety: string; slips: number; netKg: number; mon: number; amount: number }>();
  for (const s of slips) {
    const key = s.variety?.trim() || "—";
    const v = varieties.get(key) ?? { variety: key, slips: 0, netKg: 0, mon: 0, amount: 0 };
    v.slips++;
    v.netKg = round3(v.netKg + num(s.netKg));
    v.mon = round2(v.mon + num(s.mon));
    v.amount = round2(v.amount + num(s.totalPrice));
    varieties.set(key, v);
  }
  // milling: inputs and outputs per product
  const sum = (dir: number) => {
    const m = new Map<string, MillYieldLine>();
    for (const it of items.filter((i) => Math.sign(i.direction) === dir)) {
      const l = m.get(it.productId) ?? { productId: it.productId, name: it.product.name, unit: it.product.unit.name, quantity: 0, percent: null };
      l.quantity = round3(l.quantity + num(it.baseQuantity));
      m.set(it.productId, l);
    }
    return [...m.values()];
  };
  const milled = sum(-1);
  const produced = sum(1);
  const milledKg = round3(milled.filter((l) => isKg(l.unit)).reduce((s, l) => s + l.quantity, 0));
  for (const l of produced) l.percent = milledKg > 0 && isKg(l.unit) ? round2((l.quantity / milledKg) * 100) : null;
  produced.sort((a, b) => b.quantity - a.quantity);
  const producedKg = round3(produced.filter((l) => isKg(l.unit)).reduce((s, l) => s + l.quantity, 0));
  return {
    purchase: {
      slips: slips.length,
      netKg: round3(slips.reduce((s, x) => s + num(x.netKg), 0)),
      mon: round2(slips.reduce((s, x) => s + num(x.mon), 0)),
      amount: round2(slips.reduce((s, x) => s + num(x.totalPrice), 0)),
      byVariety: [...varieties.values()].sort((a, b) => b.netKg - a.netKg),
    },
    labourCost: round2(num(labour._sum.amount)),
    milling: {
      runs: runs.length,
      milled,
      milledKg,
      produced,
      producedKg,
      /** kg lost in milling (dust, moisture) — kg lines only */
      lossKg: round3(Math.max(0, milledKg - producedKg)),
      lossPercent: milledKg > 0 ? round2((Math.max(0, milledKg - producedKg) / milledKg) * 100) : 0,
      extraCost: round2(runs.reduce((s, r) => s + num(r.extraCost), 0)),
    },
  };
}
