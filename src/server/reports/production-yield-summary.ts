import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { round2, round3 } from "@/lib/calc";
import { dayOrToday, dayRange, formatDate, formatMoney, formatQty, monthStartInput, toBnDigits, toDateInput } from "@/lib/format";
import { bagUnits, lineBags, millOutputKind, toKg } from "@/server/services/rice-mill";
import { KG_PER_MON } from "@/lib/paddy";
import type { ReportDef, ReportRow } from "./types";

export interface RawMaterialRow {
  date: Date;
  lotDescription: string;
  variety: string;
  voucherNo: string;
  voucherId: string;
  party: string;
  purchaseKg: number;
  purchaseMon: number;
  purchaseCost: number;
  milledKg: number;
  statusBadge?: string;
}

export interface ProductionYieldRow {
  kind: "rice" | "bran" | "broken" | "husk" | "loss";
  name: string;
  totalKg: number;
  totalBags: number | null;
  ratioPct: number;
  perBagKg: number;
}

export interface SalesFinancialRow {
  productId: string;
  productName: string;
  totalKg: number;
  totalBags: number | null;
  avgRate: number;
  totalAmount: number;
  totalCollected: number;
  totalDue: number;
}

export interface ProductionYieldSummaryData {
  fromDate: string;
  toDate: string;
  yieldBase: number; // 75 or 80
  cards: {
    rawPurchased: {
      kg: number;
      mon: number;
      cost: number;
    };
    rawProcessed: {
      kg: number;
      mon: number;
    };
    averageYield: {
      riceKg: number;
      yieldPerBag: number;
      yieldPct: number;
      label: string;
    };
    finishedSold: {
      kg: number;
      bags: number | null;
      amount: number;
    };
  };
  sectionA: {
    rows: RawMaterialRow[];
    totals: {
      purchaseKg: number;
      purchaseMon: number;
      purchaseCost: number;
      milledKg: number;
      milledMon: number;
    };
  };
  sectionB: {
    rows: ProductionYieldRow[];
    totals: {
      totalKg: number;
      totalBags: number | null;
      ratioPct: number;
      perBagKg: number;
    };
  };
  sectionC: {
    rows: SalesFinancialRow[];
    totals: {
      totalKg: number;
      totalBags: number | null;
      avgRate: number;
      totalAmount: number;
      totalCollected: number;
      totalDue: number;
    };
  };
}

export interface ProductionYieldSummaryParams {
  from_date?: string;
  to_date?: string;
  from?: string;
  to?: string;
  yield_base?: string;
  yield_standard?: string;
  scope?: Prisma.VoucherWhereInput;
}

const CASH_PURCHASE = "নগদ ক্রয়";

export async function productionYieldSummary(
  businessId: string,
  params: ProductionYieldSummaryParams,
): Promise<ProductionYieldSummaryData> {
  let fromDate = dayOrToday(params.from_date ?? params.from ?? monthStartInput());
  let toDate = dayOrToday(params.to_date ?? params.to ?? toDateInput());
  if (fromDate > toDate) {
    const tmp = fromDate;
    fromDate = toDate;
    toDate = tmp;
  }
  const yieldBase = params.yield_base === "80" || params.yield_standard === "80" ? 80 : 75;
  const range = dayRange(fromDate, toDate);

  // 1. Fetch Paddy Purchases and Production Runs
  const [slips, bagOf, productionRuns] = await Promise.all([
    prisma.paddyPurchase.findMany({
      where: {
        businessId,
        voucher: {
          book: "GENERAL",
          type: "PURCHASE",
          date: range,
          ...params.scope,
        },
      },
      include: {
        items: {
          orderBy: { lineNo: "asc" },
          include: { product: { select: { name: true } } },
        },
        voucher: {
          select: {
            id: true,
            voucherNo: true,
            date: true,
            narration: true,
            partyAccount: { select: { name: true } },
            items: {
              orderBy: { lineNo: "asc" },
              include: {
                product: { select: { id: true, name: true, unit: { select: { id: true, name: true } } } },
                unit: { select: { name: true, baseUnitId: true } },
              },
            },
          },
        },
      },
      orderBy: [{ voucher: { date: "asc" } }, { voucher: { createdAt: "asc" } }],
    }),
    bagUnits(businessId),
    prisma.productionRun.findMany({
      where: {
        businessId,
        voucher: {
          businessId,
          type: "PRODUCTION",
          date: range,
          ...params.scope,
        },
      },
      orderBy: [{ voucher: { date: "asc" } }, { voucher: { createdAt: "asc" } }],
      include: {
        voucher: {
          select: {
            id: true,
            voucherNo: true,
            date: true,
            narration: true,
            items: {
              orderBy: { lineNo: "asc" },
              include: {
                product: { select: { id: true, name: true, unit: { select: { id: true, name: true } } } },
                unit: { select: { name: true, baseUnitId: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  // Total raw material purchased
  const rawPurchases: RawMaterialRow[] = slips.flatMap((s) => {
    const party = s.voucher.partyAccount?.name ?? CASH_PURCHASE;
    if (s.items.length > 0) {
      return s.items.map((it) => {
        const netKg = num(it.netKg);
        const mon = num(it.mon);
        const totalPrice = num(it.totalPrice);
        const variety = it.variety?.trim() || it.product.name || "ধান";
        return {
          date: s.voucher.date,
          lotDescription: `${variety} (লট #${s.voucher.voucherNo} · ${party})`,
          variety,
          voucherNo: s.voucher.voucherNo,
          voucherId: s.voucher.id,
          party,
          purchaseKg: netKg,
          purchaseMon: mon,
          purchaseCost: totalPrice,
          milledKg: 0,
        };
      });
    }
    const netKg = num(s.netKg);
    const mon = num(s.mon);
    const totalPrice = num(s.totalPrice);
    const variety = s.variety?.trim() || s.voucher.items[0]?.product.name || "ধান";
    return [{
      date: s.voucher.date,
      lotDescription: `${variety} (লট #${s.voucher.voucherNo} · ${party})`,
      variety,
      voucherNo: s.voucher.voucherNo,
      voucherId: s.voucher.id,
      party,
      purchaseKg: netKg,
      purchaseMon: mon,
      purchaseCost: totalPrice,
      milledKg: 0,
    }];
  });

  const totalPurchaseKg = round3(rawPurchases.reduce((s, r) => s + r.purchaseKg, 0));
  const totalPurchaseMon = round2(rawPurchases.reduce((s, r) => s + r.purchaseMon, 0));
  const totalPurchaseCost = round2(rawPurchases.reduce((s, r) => s + r.purchaseCost, 0));

  // 2. Production Runs Analysis (Input and Output breakdown)
  let totalMilledKg = 0;
  const outputsKg = { rice: 0, bran: 0, broken: 0, husk: 0 };
  const outputsBags = { rice: 0, bran: 0, broken: 0, husk: 0 };

  for (const run of productionRuns) {
    const items = run.voucher.items;
    let runInputKg = 0;
    for (const item of items) {
      const base = num(item.baseQuantity);
      const kg = toKg(base, item.product.unit.name);
      if (item.direction < 0) {
        runInputKg = round3(runInputKg + kg);
      } else if (item.direction > 0) {
        const kind = millOutputKind(item.product.name);
        outputsKg[kind] = round3(outputsKg[kind] + kg);
        const bags = lineBags(item, bagOf) ?? (yieldBase > 0 ? round2(kg / yieldBase) : 0);
        outputsBags[kind] = round2(outputsBags[kind] + bags);
      }
    }
    totalMilledKg = round3(totalMilledKg + runInputKg);
  }
  const totalMilledMon = round2(totalMilledKg / KG_PER_MON);

  // Allocate milling usage across purchase lots using FIFO logic
  let remainingMilledToAllocate = totalMilledKg;
  for (const p of rawPurchases) {
    if (remainingMilledToAllocate <= 0) {
      p.milledKg = 0;
      p.statusBadge = "মজুদ আছে";
    } else if (remainingMilledToAllocate >= p.purchaseKg) {
      p.milledKg = p.purchaseKg;
      remainingMilledToAllocate = round3(remainingMilledToAllocate - p.purchaseKg);
      p.statusBadge = "সম্পূর্ণ মিলিং";
    } else {
      p.milledKg = remainingMilledToAllocate;
      remainingMilledToAllocate = 0;
      p.statusBadge = "আংশিক মিলিং";
    }
  }

  // If there is extra milled paddy that came from prior opening stock
  const sectionARows: RawMaterialRow[] = [...rawPurchases];
  if (remainingMilledToAllocate > 0) {
    sectionARows.push({
      date: new Date(`${fromDate}T00:00:00.000Z`),
      lotDescription: "পূর্বের মজুদ / পুরাতন লট থেকে মিলিং",
      variety: "ধান (পূর্বের স্টক)",
      voucherNo: "OPENING",
      voucherId: "",
      party: "পূর্বের মজুদ",
      purchaseKg: 0,
      purchaseMon: 0,
      purchaseCost: 0,
      milledKg: remainingMilledToAllocate,
      statusBadge: "পূর্বের মজুদ",
    });
  }

  const sectionATotals = {
    purchaseKg: totalPurchaseKg,
    purchaseMon: totalPurchaseMon,
    purchaseCost: totalPurchaseCost,
    milledKg: totalMilledKg,
    milledMon: totalMilledMon,
  };

  // 3. Section B: Production & Yield Analysis
  const totalProducedGoodsKg = outputsKg.rice + outputsKg.bran + outputsKg.broken + outputsKg.husk;
  const processLossKg = totalMilledKg > totalProducedGoodsKg ? round3(totalMilledKg - totalProducedGoodsKg) : 0;

  const yieldPct = (partKg: number) => (totalMilledKg > 0 ? round2((partKg / totalMilledKg) * 100) : 0);
  const yieldPerBagKg = (partKg: number) => (totalMilledKg > 0 ? round2((partKg * yieldBase) / totalMilledKg) : 0);

  const sectionBRows: ProductionYieldRow[] = [
    {
      kind: "rice",
      name: "চাল (মূল উৎপাদিত চাল)",
      totalKg: outputsKg.rice,
      totalBags: outputsBags.rice,
      ratioPct: yieldPct(outputsKg.rice),
      perBagKg: yieldPerBagKg(outputsKg.rice),
    },
    {
      kind: "bran",
      name: "কুঁড়া (রাইস ব্র্যান)",
      totalKg: outputsKg.bran,
      totalBags: outputsBags.bran,
      ratioPct: yieldPct(outputsKg.bran),
      perBagKg: yieldPerBagKg(outputsKg.bran),
    },
    {
      kind: "broken",
      name: "খুদ (ভাঙা চাল)",
      totalKg: outputsKg.broken,
      totalBags: outputsBags.broken,
      ratioPct: yieldPct(outputsKg.broken),
      perBagKg: yieldPerBagKg(outputsKg.broken),
    },
    {
      kind: "husk",
      name: "তুষ (ভূসি)",
      totalKg: outputsKg.husk,
      totalBags: outputsBags.husk,
      ratioPct: yieldPct(outputsKg.husk),
      perBagKg: yieldPerBagKg(outputsKg.husk),
    },
    {
      kind: "loss",
      name: "প্রসেস লস (আর্দ্রতা ও ধুলাবালি ঘাটতি)",
      totalKg: processLossKg,
      totalBags: null,
      ratioPct: yieldPct(processLossKg),
      perBagKg: yieldPerBagKg(processLossKg),
    },
  ];

  const totalOutputKg = round3(totalProducedGoodsKg + processLossKg);
  const totalOutputRatio = totalMilledKg > 0 ? 100 : 0;
  const totalOutputPerBag = totalMilledKg > 0 ? yieldBase : 0;

  const sectionBTotals = {
    totalKg: totalOutputKg,
    totalBags: round2(outputsBags.rice + outputsBags.bran + outputsBags.broken + outputsBags.husk),
    ratioPct: totalOutputRatio,
    perBagKg: totalOutputPerBag,
  };

  // Rice Yield calculation for Card 3
  const avgYieldPerBag = yieldPerBagKg(outputsKg.rice);
  const avgYieldPct = yieldPct(outputsKg.rice);
  const avgYieldLabel = `প্রতি ${toBnDigits(yieldBase)} কেজিতে ফলন: ${toBnDigits(avgYieldPerBag.toFixed(2))} কেজি (${toBnDigits(avgYieldPct.toFixed(2))}%)`;

  // 4. Section C: Sales & Financial Summary
  const salesItems = await prisma.voucherItem.findMany({
    where: {
      voucher: {
        businessId,
        book: "GENERAL",
        type: "SALES",
        date: range,
        ...params.scope,
      },
    },
    include: {
      voucher: {
        select: {
          id: true,
          voucherNo: true,
          date: true,
          amount: true,
          paidAmount: true,
          partyAccount: { select: { name: true } },
        },
      },
      product: {
        select: {
          id: true,
          name: true,
          unit: { select: { id: true, name: true } },
        },
      },
      unit: { select: { name: true, baseUnitId: true } },
    },
    orderBy: [{ voucher: { date: "asc" } }, { voucher: { createdAt: "asc" } }],
  });

  const salesMap = new Map<
    string,
    {
      productId: string;
      productName: string;
      totalKg: number;
      totalBags: number;
      hasBags: boolean;
      totalAmount: number;
      totalCollected: number;
      totalDue: number;
    }
  >();

  for (const item of salesItems) {
    const pId = item.productId;
    const base = num(item.baseQuantity);
    const kg = toKg(base, item.product.unit.name);
    const bags = lineBags(item, bagOf);
    const amount = num(item.amount);

    const vAmount = num(item.voucher.amount);
    const vPaid = num(item.voucher.paidAmount);
    const ratio = vAmount > 0 ? Math.min(1, Math.max(0, vPaid / vAmount)) : 0;
    const collected = round2(amount * ratio);
    const due = round2(amount - collected);

    const prev = salesMap.get(pId) ?? {
      productId: pId,
      productName: item.product.name,
      totalKg: 0,
      totalBags: 0,
      hasBags: false,
      totalAmount: 0,
      totalCollected: 0,
      totalDue: 0,
    };

    prev.totalKg = round3(prev.totalKg + kg);
    if (bags !== null) {
      prev.totalBags = round2(prev.totalBags + bags);
      prev.hasBags = true;
    }
    prev.totalAmount = round2(prev.totalAmount + amount);
    prev.totalCollected = round2(prev.totalCollected + collected);
    prev.totalDue = round2(prev.totalDue + due);

    salesMap.set(pId, prev);
  }

  const sectionCRows: SalesFinancialRow[] = [...salesMap.values()]
    .map((s) => ({
      productId: s.productId,
      productName: s.productName,
      totalKg: s.totalKg,
      totalBags: s.hasBags ? s.totalBags : null,
      avgRate: s.totalKg > 0 ? round2(s.totalAmount / s.totalKg) : 0,
      totalAmount: s.totalAmount,
      totalCollected: s.totalCollected,
      totalDue: s.totalDue,
    }))
    .sort((a, b) => {
      // Prioritize by product kind (rice first, then bran, broken, husk, others)
      const kindRank: Record<string, number> = { rice: 1, bran: 2, broken: 3, husk: 4 };
      const rankA = kindRank[millOutputKind(a.productName)] ?? 99;
      const rankB = kindRank[millOutputKind(b.productName)] ?? 99;
      return rankA - rankB || b.totalAmount - a.totalAmount;
    });

  const sectionCTotals = {
    totalKg: round3(sectionCRows.reduce((s, r) => s + r.totalKg, 0)),
    totalBags: sectionCRows.some((r) => r.totalBags !== null)
      ? round2(sectionCRows.reduce((s, r) => s + (r.totalBags ?? 0), 0))
      : null,
    avgRate: 0,
    totalAmount: round2(sectionCRows.reduce((s, r) => s + r.totalAmount, 0)),
    totalCollected: round2(sectionCRows.reduce((s, r) => s + r.totalCollected, 0)),
    totalDue: round2(sectionCRows.reduce((s, r) => s + r.totalDue, 0)),
  };
  sectionCTotals.avgRate = sectionCTotals.totalKg > 0 ? round2(sectionCTotals.totalAmount / sectionCTotals.totalKg) : 0;

  return {
    fromDate,
    toDate,
    yieldBase,
    cards: {
      rawPurchased: {
        kg: totalPurchaseKg,
        mon: totalPurchaseMon,
        cost: totalPurchaseCost,
      },
      rawProcessed: {
        kg: totalMilledKg,
        mon: totalMilledMon,
      },
      averageYield: {
        riceKg: outputsKg.rice,
        yieldPerBag: avgYieldPerBag,
        yieldPct: avgYieldPct,
        label: avgYieldLabel,
      },
      finishedSold: {
        kg: sectionCTotals.totalKg,
        bags: sectionCTotals.totalBags,
        amount: sectionCTotals.totalAmount,
      },
    },
    sectionA: {
      rows: sectionARows,
      totals: sectionATotals,
    },
    sectionB: {
      rows: sectionBRows,
      totals: sectionBTotals,
    },
    sectionC: {
      rows: sectionCRows,
      totals: sectionCTotals,
    },
  };
}

/** Registry entry: reports index and CSV / Excel export (/api/reports/production-yield-summary). */
export const PRODUCTION_YIELD_SUMMARY_REPORT: ReportDef = {
  slug: "production-yield-summary",
  title: "উৎপাদন ও ফলন সারসংক্ষেপ রিপোর্ট",
  description: "কাঁচামাল ক্রয়, মিলিং প্রসেসিং, ফলন বিশ্লেষণ ও তৈরি পণ্য বিক্রয়ের সমন্বিত সারসংক্ষেপ",
  filters: ["range"],
  permission: "reports:view",
  async run(ctx, p) {
    const data = await productionYieldSummary(ctx.business.id, {
      from_date: p.from_date ?? p.from,
      to_date: p.to_date ?? p.to,
      yield_base: p.yield_base ?? p.yield_standard,
    });
    const cur = ctx.business.currencySymbol;
    const rows: ReportRow[] = [];

    // Header 1: Section A
    rows.push({
      kind: "group",
      cells: {
        col1: "১. কাঁচামাল ক্রয় ও ব্যবহার",
        col2: null,
        col3: null,
        col4: null,
        col5: null,
        col6: null,
      },
    });
    for (const r of data.sectionA.rows) {
      rows.push({
        cells: {
          col1: formatDate(r.date),
          col2: r.lotDescription,
          col3: `${formatQty(r.purchaseKg)} কেজি (${toBnDigits(r.purchaseMon.toFixed(2))} মণ)`,
          col4: formatMoney(r.purchaseCost, cur),
          col5: `${formatQty(r.milledKg)} কেজি`,
          col6: r.statusBadge ?? "",
        },
      });
    }
    rows.push({
      kind: "total",
      cells: {
        col1: "মোট কাঁচামাল",
        col2: "",
        col3: `${formatQty(data.sectionA.totals.purchaseKg)} কেজি (${toBnDigits(data.sectionA.totals.purchaseMon.toFixed(2))} মণ)`,
        col4: formatMoney(data.sectionA.totals.purchaseCost, cur),
        col5: `${formatQty(data.sectionA.totals.milledKg)} কেজি`,
        col6: "",
      },
    });

    // Header 2: Section B
    rows.push({
      kind: "group",
      cells: {
        col1: "২. উৎপাদন ও ফলন বিশ্লেষণ",
        col2: null,
        col3: null,
        col4: null,
        col5: null,
        col6: null,
      },
    });
    for (const r of data.sectionB.rows) {
      rows.push({
        cells: {
          col1: r.name,
          col2: `${formatQty(r.totalKg)} কেজি${r.totalBags ? ` (${toBnDigits(r.totalBags)} বস্তা)` : ""}`,
          col3: `${toBnDigits(r.ratioPct.toFixed(2))}%`,
          col4: `${toBnDigits(r.perBagKg.toFixed(2))} কেজি`,
          col5: "",
          col6: "",
        },
      });
    }
    rows.push({
      kind: "total",
      cells: {
        col1: "মোট উৎপাদন",
        col2: `${formatQty(data.sectionB.totals.totalKg)} কেজি`,
        col3: `${toBnDigits(data.sectionB.totals.ratioPct.toFixed(2))}%`,
        col4: `${toBnDigits(data.sectionB.totals.perBagKg.toFixed(2))} কেজি`,
        col5: "",
        col6: "",
      },
    });

    // Header 3: Section C
    rows.push({
      kind: "group",
      cells: {
        col1: "৩. বিক্রয় ও আর্থিক সারসংক্ষেপ",
        col2: null,
        col3: null,
        col4: null,
        col5: null,
        col6: null,
      },
    });
    for (const r of data.sectionC.rows) {
      rows.push({
        cells: {
          col1: r.productName,
          col2: `${formatQty(r.totalKg)} কেজি${r.totalBags ? ` (${toBnDigits(r.totalBags)} বস্তা)` : ""}`,
          col3: formatMoney(r.avgRate, cur),
          col4: formatMoney(r.totalAmount, cur),
          col5: formatMoney(r.totalCollected, cur),
          col6: formatMoney(r.totalDue, cur),
        },
      });
    }
    rows.push({
      kind: "total",
      cells: {
        col1: "সর্বমোট বিক্রয়",
        col2: `${formatQty(data.sectionC.totals.totalKg)} কেজি`,
        col3: formatMoney(data.sectionC.totals.avgRate, cur),
        col4: formatMoney(data.sectionC.totals.totalAmount, cur),
        col5: formatMoney(data.sectionC.totals.totalCollected, cur),
        col6: formatMoney(data.sectionC.totals.totalDue, cur),
      },
    });

    return {
      title: "উৎপাদন ও ফলন সারসংক্ষেপ রিপোর্ট",
      subtitle: `${formatDate(data.fromDate)} হতে ${formatDate(data.toDate)} (স্ট্যান্ডার্ড: ${toBnDigits(data.yieldBase)} কেজি)`,
      columns: [
        { key: "col1", label: "বিবরণ / পণ্য" },
        { key: "col2", label: "লট / পরিমাণ" },
        { key: "col3", label: "অনুপাত / দর" },
        { key: "col4", label: "মূল্য / প্রাপ্তি" },
        { key: "col5", label: "ব্যবহৃত / নগদ" },
        { key: "col6", label: "অবস্থা / বকেয়া" },
      ],
      rows,
      summary: [
        { label: "মোট কাঁচামাল ক্রয়", value: `${formatQty(data.cards.rawPurchased.kg)} কেজি (${formatMoney(data.cards.rawPurchased.cost, cur)})` },
        { label: "মোট প্রক্রিয়াজাত", value: `${formatQty(data.cards.rawProcessed.kg)} কেজি` },
        { label: "গড় ফলন", value: data.cards.averageYield.label, tone: "green" },
        { label: "মোট বিক্রয়", value: formatMoney(data.cards.finishedSold.amount, cur), tone: "blue" },
      ],
    };
  },
};
