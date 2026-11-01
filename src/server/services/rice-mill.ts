// Auto rice mill (business type AUTO_RICE_MILL): read-only views over the existing building blocks —
//   paddy & weighbridge  PaddyPurchase slips (PURCHASE vouchers) + their labour payments (paddy-labour:<id>)
//   milling              PRODUCTION vouchers (ProductionRun): paddy out (direction −1) → rice and by-products in (+1)
//   sales                ordinary SALES / SALES_RETURN vouchers of the mill's products (party ledgers post as usual)
// Which products belong to the mill: paddy = bought on a slip or used as a production / recipe input; rice and
// by-products (চাল, খুদ, কুঁড়া, তুষ …) = production / recipe outputs. Nothing here writes to the database.
import { prisma, num } from "@/lib/db";
import { round2, round3, round4 } from "@/lib/calc";
import { allocateCost } from "@/lib/production";
import { KG_PER_MON } from "@/lib/paddy";
import type { DateRange } from "./ledger";
import { calculateInventoryValuation } from "./valuation";

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

/** Current stock of paddy and of rice / by-products, valued via FIFO (paddy) and last 3 sales avg (outputs). */
export async function millStock(businessId: string) {
  const ids = await millProducts(businessId);
  const [rows, valuation] = await Promise.all([
    prisma.product.findMany({
      where: { businessId, id: { in: [...ids.paddy, ...ids.outputs] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, stock: true, avgCost: true, unit: { select: { name: true } } },
    }),
    calculateInventoryValuation(businessId, { productIds: [...ids.paddy, ...ids.outputs] }),
  ]);
  const valMap = new Map(valuation.items.map((it) => [it.productId, it]));
  const toRow = (p: (typeof rows)[number]): MillStockRow => {
    const stock = round3(num(p.stock));
    const val = valMap.get(p.id);
    const rate = val ? val.rate : num(p.avgCost);
    const value = val ? val.value : round2(stock * rate);
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      unit: p.unit.name,
      stock,
      mon: isKg(p.unit.name) ? round2(stock / KG_PER_MON) : null,
      avgCost: rate,
      value,
    };
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

// ───────────────────────── daily milling (ডেইলি ধান ভাঙানো হিসাব) ─────────────────────────

/** What a mill output is, from its name: কুঁড়া (bran), খুদ (broken rice), তুষ / ভূসি (husk); anything else is the rice. */
export type MillOutputKind = "rice" | "bran" | "broken" | "husk";
export function millOutputKind(name: string): MillOutputKind {
  if (/কুঁড়া|কুড়া|কুরা|bran/i.test(name)) return "bran";
  if (/খুদ|ক্ষুদ|ভাঙা চাল|ভাঙ্গা চাল|broken/i.test(name)) return "broken";
  if (/তুষ|ভূসি|ভুসি|husk/i.test(name)) return "husk";
  return "rice";
}

/** A quantity in a product's base unit as kg (কেজি; মণ = 40 kg; টন; গ্রাম). Other units are taken as kg. */
export function toKg(quantity: number, unit: string): number {
  if (/মণ|mon|maund/i.test(unit)) return quantity * KG_PER_MON;
  if (/টন|ton/i.test(unit)) return quantity * 1000;
  if (/গ্রাম|gram/i.test(unit) && !/কেজি|kg/i.test(unit)) return quantity / 1000;
  return quantity;
}

const isBag = (unit: string) => /বস্তা|bag|sack/i.test(unit);

/** The business's one bag unit per base unit (base unit id → kg… per bag; null when there are several). */
export async function bagUnits(businessId: string): Promise<Map<string, number | null>> {
  const units = await prisma.unit.findMany({ where: { businessId, baseUnitId: { not: null } }, select: { name: true, baseUnitId: true, factor: true } });
  const bagOf = new Map<string, number | null>();
  for (const u of units) {
    if (!u.baseUnitId || !isBag(u.name)) continue;
    bagOf.set(u.baseUnitId, bagOf.has(u.baseUnitId) ? null : num(u.factor));
  }
  return bagOf;
}

/** Bags of a line: the quantity when entered in a bag unit, else base quantity ÷ the business's one bag unit; null = unknown. */
export function lineBags(
  item: { quantity: unknown; baseQuantity: unknown; unit: { name: string; baseUnitId: string | null } | null; product: { unit: { id?: string; name: string }; unitId?: string } },
  bagOf: Map<string, number | null>,
): number | null {
  if (item.unit && item.unit.baseUnitId && isBag(item.unit.name)) return num(item.quantity as never);
  const per = bagOf.get(item.product.unit.id ?? item.product.unitId ?? "");
  return per ? round2(num(item.baseQuantity as never) / per) : null;
}

/** kg and bags of one kind of goods in a milling run (bags: null when they cannot be told) */
export interface MillQty {
  kg: number;
  bags: number | null;
}

export interface MillingRow {
  voucherId: string;
  /** milling batch number (the production entry's number) */
  batchNo: string;
  date: Date;
  enteredBy: string | null;
  /** paddy varieties milled ("মিনিকেট ধান, ব্রি-২৮ ধান") */
  paddyNames: string;
  paddy: MillQty & { mon: number };
  rice: MillQty;
  bran: MillQty;
  broken: MillQty;
  husk: MillQty;
  /** % of the paddy milled; loss = paddy − all outputs */
  yields: { rice: number; bran: number; broken: number; husk: number; loss: number };
}

const pctOf = (part: number, whole: number) => (whole > 0 ? round2((part / whole) * 100) : 0);

/**
 * Milling runs (production entries with paddy out and rice / by-products in) of a period, one row each, with the
 * day's totals. Bags: the quantity entered in a bag unit (বস্তা), else the base quantity ÷ the business's one bag
 * unit for that base unit; unknown when there is none (or more than one).
 */
export async function dailyMilling(businessId: string, range: DateRange) {
  const [runs, bagOf] = await Promise.all([
    prisma.productionRun.findMany({
      where: { businessId, voucher: { businessId, ...(range.gte || range.lt ? { date: range } : {}) } },
      orderBy: [{ voucher: { date: "asc" } }, { voucher: { createdAt: "asc" } }],
      select: {
        voucher: {
          select: {
            id: true, voucherNo: true, date: true,
            createdBy: { select: { name: true } },
            items: {
              orderBy: { lineNo: "asc" },
              select: { quantity: true, baseQuantity: true, direction: true, unit: { select: { name: true, baseUnitId: true } }, product: { select: { name: true, unit: { select: { id: true, name: true } } } } },
            },
          },
        },
      },
    }),
    bagUnits(businessId),
  ]);

  const rows: MillingRow[] = [];
  for (const { voucher: v } of runs) {
    const add = (q: MillQty, item: (typeof v.items)[number]) => {
      const base = num(item.baseQuantity);
      const kg = toKg(base, item.product.unit.name);
      q.kg = round3(q.kg + kg);
      // bags: entered in a bag unit, else via the business's one bag unit; once unknown, the sum is unknown
      const bags = lineBags(item, bagOf);
      q.bags = q.bags === null || bags === null ? null : round2(q.bags + bags);
    };
    const empty = (): MillQty => ({ kg: 0, bags: 0 });
    const paddy = empty();
    const out: Record<MillOutputKind, MillQty> = { rice: empty(), bran: empty(), broken: empty(), husk: empty() };
    const names: string[] = [];
    for (const item of v.items) {
      if (item.direction < 0) {
        add(paddy, item);
        if (!names.includes(item.product.name)) names.push(item.product.name);
      } else if (item.direction > 0) add(out[millOutputKind(item.product.name)], item);
    }
    if (paddy.kg <= 0) continue; // not a milling run (nothing went in)
    const noBags = (q: MillQty): MillQty => (q.kg === 0 ? { kg: 0, bags: 0 } : q);
    const produced = out.rice.kg + out.bran.kg + out.broken.kg + out.husk.kg;
    rows.push({
      voucherId: v.id, batchNo: v.voucherNo, date: v.date, enteredBy: v.createdBy?.name?.trim() || null,
      paddyNames: names.join(", "),
      paddy: { ...paddy, mon: round2(paddy.kg / KG_PER_MON) },
      rice: noBags(out.rice), bran: noBags(out.bran), broken: noBags(out.broken), husk: noBags(out.husk),
      yields: {
        rice: pctOf(out.rice.kg, paddy.kg), bran: pctOf(out.bran.kg, paddy.kg), broken: pctOf(out.broken.kg, paddy.kg), husk: pctOf(out.husk.kg, paddy.kg),
        loss: pctOf(Math.max(0, paddy.kg - produced), paddy.kg),
      },
    });
  }
  const sum = (pick: (r: MillingRow) => MillQty): MillQty => ({
    kg: round3(rows.reduce((s, r) => s + pick(r).kg, 0)),
    bags: rows.some((r) => pick(r).bags === null) ? null : round2(rows.reduce((s, r) => s + (pick(r).bags ?? 0), 0)),
  });
  const paddyKg = round3(rows.reduce((s, r) => s + r.paddy.kg, 0));
  const totals = { paddy: { ...sum((r) => r.paddy), mon: round2(paddyKg / KG_PER_MON) }, rice: sum((r) => r.rice), bran: sum((r) => r.bran), broken: sum((r) => r.broken), husk: sum((r) => r.husk) };
  const producedKg = totals.rice.kg + totals.bran.kg + totals.broken.kg + totals.husk.kg;
  return {
    rows,
    totals,
    yields: {
      rice: pctOf(totals.rice.kg, paddyKg), bran: pctOf(totals.bran.kg, paddyKg), broken: pctOf(totals.broken.kg, paddyKg), husk: pctOf(totals.husk.kg, paddyKg),
      loss: pctOf(Math.max(0, paddyKg - producedKg), paddyKg),
    },
  };
}

export interface MillingProfitItem {
  id: string;
  productId: string;
  name: string;
  code: string | null;
  kind: MillOutputKind;
  quantityKg: number;
  avgSellingRate: number; // Tk / kg from last 3 challans
  challansUsed: number;
  potentialRevenue: number; // quantityKg * avgSellingRate
  rawMaterialCost: number; // FIFO allocated cost
  netProfit: number; // potentialRevenue - rawMaterialCost
  marginPct: number; // (netProfit / potentialRevenue) * 100
}

export interface FifoLotConsumption {
  voucherNo: string;
  date: Date;
  quantityKg: number;
  ratePerKg: number;
  cost: number;
}

export interface RawMaterialInputCost {
  id: string;
  productId: string;
  name: string;
  code: string | null;
  quantityKg: number;
  fifoCost: number;
  ratePerKg: number;
  ratePerMon: number;
  consumedLots: FifoLotConsumption[];
}

export interface MillingProfitAnalysis {
  rawInputs: RawMaterialInputCost[];
  items: MillingProfitItem[];
  consumedLots: FifoLotConsumption[];
  totalRawFifoCost: number;
  avgRawRatePerKg: number;
  totalPotentialRevenue: number;
  totalNetProfit: number;
  overallMarginPct: number;
}

/**
 * Profit & Loss analysis of a milling batch based on:
 * 1. Pure FIFO cost of the raw material (paddy) consumed from actual purchase lots in inventory.
 * 2. Average selling rate per kg from the last 3 delivery challans / sales vouchers for each produced item.
 * 3. Proportional allocation of the actual FIFO cost by produced output weight.
 */
export async function millingProfitAnalysis(
  businessId: string,
  voucherId: string,
): Promise<MillingProfitAnalysis | null> {
  const v = await prisma.voucher.findFirst({
    where: { id: voucherId, businessId, type: "PRODUCTION" },
    include: {
      items: {
        orderBy: { lineNo: "asc" },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              code: true,
              salePrice: true,
              purchasePrice: true,
              avgCost: true,
              unit: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
  if (!v) return null;

  const inputItems = v.items.filter((i) => i.direction < 0);
  const outputItems = v.items.filter((i) => i.direction > 0);
  if (outputItems.length === 0) return null;

  let totalRawFifoCost = 0;
  let totalInputKg = 0;
  const allConsumedLots: FifoLotConsumption[] = [];
  const rawInputs: RawMaterialInputCost[] = [];

  for (const input of inputItems) {
    const neededKg = round3(toKg(num(input.baseQuantity), input.product.unit.name));
    totalInputKg = round3(totalInputKg + neededKg);

    const moves = await prisma.stockMovement.findMany({
      where: { businessId, productId: input.productId },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      include: {
        voucher: {
          select: {
            id: true,
            voucherNo: true,
            date: true,
            type: true,
          },
        },
      },
    });

    const inwardQueue: {
      voucherNo: string;
      date: Date;
      remainingQty: number;
      unitCost: number;
    }[] = [];

    let itemFifoCost = 0;
    const itemConsumedLots: FifoLotConsumption[] = [];
    let foundCurrent = false;

    for (const m of moves) {
      const qin = num(m.quantityIn);
      const qout = num(m.quantityOut);

      if (qin > 0) {
        const cost = num(m.unitCost) > 0 ? num(m.unitCost) : num(input.product.purchasePrice) || num(input.product.avgCost) || 0;
        inwardQueue.push({
          voucherNo: m.voucher?.voucherNo ?? m.id,
          date: m.voucher?.date ?? m.date,
          remainingQty: qin,
          unitCost: cost,
        });
      } else if (qout > 0) {
        if (m.voucherId === v.id && m.voucherItemId === input.id) {
          foundCurrent = true;
          let needed = qout;
          for (const lot of inwardQueue) {
            if (needed <= 0) break;
            if (lot.remainingQty <= 0) continue;
            const take = Math.min(lot.remainingQty, needed);
            lot.remainingQty = round3(lot.remainingQty - take);
            const lotCost = round2(take * lot.unitCost);
            const lotEntry = {
              voucherNo: lot.voucherNo,
              date: lot.date,
              quantityKg: take,
              ratePerKg: lot.unitCost,
              cost: lotCost,
            };
            allConsumedLots.push(lotEntry);
            itemConsumedLots.push(lotEntry);
            itemFifoCost = round2(itemFifoCost + lotCost);
            needed = round3(needed - take);
          }
          if (needed > 0) {
            const fallback = num(input.costRate) || num(input.product.purchasePrice) || num(input.product.avgCost) || 0;
            const lotCost = round2(needed * fallback);
            const lotEntry = {
              voucherNo: "পূর্বের স্টক",
              date: v.date,
              quantityKg: needed,
              ratePerKg: fallback,
              cost: lotCost,
            };
            allConsumedLots.push(lotEntry);
            itemConsumedLots.push(lotEntry);
            itemFifoCost = round2(itemFifoCost + lotCost);
          }
          break;
        } else {
          let toDeduct = qout;
          for (const lot of inwardQueue) {
            if (toDeduct <= 0) break;
            const take = Math.min(lot.remainingQty, toDeduct);
            lot.remainingQty = round3(lot.remainingQty - take);
            toDeduct = round3(toDeduct - take);
          }
        }
      }
    }

    if (!foundCurrent) {
      let needed = neededKg;
      for (const lot of inwardQueue) {
        if (needed <= 0) break;
        if (lot.remainingQty <= 0) continue;
        const take = Math.min(lot.remainingQty, needed);
        lot.remainingQty = round3(lot.remainingQty - take);
        const lotCost = round2(take * lot.unitCost);
        const lotEntry = {
          voucherNo: lot.voucherNo,
          date: lot.date,
          quantityKg: take,
          ratePerKg: lot.unitCost,
          cost: lotCost,
        };
        allConsumedLots.push(lotEntry);
        itemConsumedLots.push(lotEntry);
        itemFifoCost = round2(itemFifoCost + lotCost);
        needed = round3(needed - take);
      }
      if (needed > 0) {
        const fallback = num(input.costRate) || num(input.product.purchasePrice) || num(input.product.avgCost) || 0;
        const lotCost = round2(needed * fallback);
        const lotEntry = {
          voucherNo: "পূর্বের স্টক",
          date: v.date,
          quantityKg: needed,
          ratePerKg: fallback,
          cost: lotCost,
        };
        allConsumedLots.push(lotEntry);
        itemConsumedLots.push(lotEntry);
        itemFifoCost = round2(itemFifoCost + lotCost);
      }
    }

    const ratePerKg = neededKg > 0 ? round4(itemFifoCost / neededKg) : 0;
    const ratePerMon = neededKg > 0 ? round2((itemFifoCost / neededKg) * KG_PER_MON) : 0;

    rawInputs.push({
      id: input.id,
      productId: input.productId,
      name: input.product.name,
      code: input.product.code,
      quantityKg: neededKg,
      fifoCost: itemFifoCost,
      ratePerKg,
      ratePerMon,
      consumedLots: itemConsumedLots,
    });

    totalRawFifoCost = round2(totalRawFifoCost + itemFifoCost);
  }

  const avgRawRatePerKg = totalInputKg > 0 ? round4(totalRawFifoCost / totalInputKg) : 0;

  // Proportional allocation of the actual total FIFO cost by produced output weight (kg)
  const totalOutputKg = round3(
    outputItems.reduce((s, o) => s + toKg(num(o.baseQuantity), o.product.unit.name), 0)
  );

  let allocatedCostRunning = 0;
  const rawCostAllocations = outputItems.map((o, idx) => {
    const outKg = round3(toKg(num(o.baseQuantity), o.product.unit.name));
    if (idx === outputItems.length - 1) {
      // Last item absorbs any fraction of a paisa to keep sum 100% exact
      const amount = round2(totalRawFifoCost - allocatedCostRunning);
      return { amount, unitCost: outKg > 0 ? round4(amount / outKg) : 0 };
    }
    const weightRatio = totalOutputKg > 0 ? outKg / totalOutputKg : 1 / outputItems.length;
    const amount = round2(totalRawFifoCost * weightRatio);
    allocatedCostRunning = round2(allocatedCostRunning + amount);
    return { amount, unitCost: outKg > 0 ? round4(amount / outKg) : 0 };
  });

  const items: MillingProfitItem[] = [];
  let totalPotentialRevenue = 0;

  for (let idx = 0; idx < outputItems.length; idx++) {
    const o = outputItems[idx];
    const outKg = round3(toKg(num(o.baseQuantity), o.product.unit.name));
    const kind = millOutputKind(o.product.name);

    const recentSales = await prisma.voucherItem.findMany({
      where: {
        productId: o.productId,
        baseQuantity: { gt: 0 },
        voucher: {
          businessId,
          type: { in: ["SALES", "DEPOT_DELIVERY"] },
        },
      },
      orderBy: [{ voucher: { date: "desc" } }, { voucher: { createdAt: "desc" } }],
      take: 3,
      select: {
        amount: true,
        baseQuantity: true,
      },
    });

    let avgSellingRate = 0;
    const challansUsed = recentSales.length;

    if (recentSales.length > 0) {
      const sumRates = recentSales.reduce((s, it) => s + num(it.amount) / num(it.baseQuantity), 0);
      avgSellingRate = round2(sumRates / recentSales.length);
    } else {
      avgSellingRate = num(o.product.salePrice) > 0 ? num(o.product.salePrice) : num(o.product.avgCost);
    }

    const potentialRevenue = round2(outKg * avgSellingRate);
    totalPotentialRevenue = round2(totalPotentialRevenue + potentialRevenue);

    const rawMaterialCost = rawCostAllocations[idx]?.amount ?? 0;
    const netProfit = round2(potentialRevenue - rawMaterialCost);
    const marginPct = potentialRevenue > 0 ? round2((netProfit / potentialRevenue) * 100) : 0;

    items.push({
      id: o.id,
      productId: o.productId,
      name: o.product.name,
      code: o.product.code,
      kind,
      quantityKg: outKg,
      avgSellingRate,
      challansUsed,
      potentialRevenue,
      rawMaterialCost,
      netProfit,
      marginPct,
    });
  }

  const totalNetProfit = round2(totalPotentialRevenue - totalRawFifoCost);
  const overallMarginPct = totalPotentialRevenue > 0 ? round2((totalNetProfit / totalPotentialRevenue) * 100) : 0;

  return {
    rawInputs,
    items,
    consumedLots: allConsumedLots,
    totalRawFifoCost,
    avgRawRatePerKg: round2(avgRawRatePerKg),
    totalPotentialRevenue,
    totalNetProfit,
    overallMarginPct,
  };
}
