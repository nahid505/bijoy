import "server-only";
import { prisma } from "@/lib/db";
import type { AppContext } from "@/server/auth";

export type MillRoleType = "SUPER_ADMIN" | "MILL_ACCOUNTANT" | "MILL_PARTNER";

export interface StandardBagResult {
  dhaltaKg: number;
  netWeightKg: number;
  standardBags75Kg: number;
}

export interface MillingBillResult {
  dryerFee: number;
  millingFee: number;
  byProductIncome: number;
  totalBillAmount: number;
}

export interface JVSettlementResult {
  totalOutsideRevenue: number;
  totalOwnerSelfRevenue: number;
  totalByProductRevenue: number;
  totalRevenue: number;
  totalExpenses: number;
  expensesByCategory: Record<string, number>;
  netProfit: number;
  partner1Name: string;
  partner1SharePct: number;
  partner1ShareAmount: number;
  partner1OutOfPocket: number;
  partner1Withdrawals: number;
  partner1NetSettlement: number;
  partner2Name: string;
  partner2SharePct: number;
  partner2ShareAmount: number;
  partner2OutOfPocket: number;
  partner2Withdrawals: number;
  partner2NetSettlement: number;
  millCashBalance: number;
}

/**
 * Resolves the Mill Role for a user.
 * SUPER_ADMIN: Nahid Hasan, Super Admin flag, or Owner.
 * MILL_PARTNER: Partner (40% share) - read-only with 60:40 view.
 * MILL_ACCOUNTANT: Staff / Accountant - create today only, no 60:40 view, no settings, no delete.
 */
export function resolveMillRole(ctx: AppContext, simulateRole?: string | null): MillRoleType {
  // If Super Admin simulates a role to test views
  if (
    simulateRole &&
    (simulateRole === "SUPER_ADMIN" || simulateRole === "MILL_ACCOUNTANT" || simulateRole === "MILL_PARTNER")
  ) {
    if (ctx.user.isSuperAdmin || ctx.isOwner || ctx.user.name?.includes("নাহিদ")) {
      return simulateRole as MillRoleType;
    }
  }

  // 1. Super Admin: Nahid Hasan (60% Partner & Owner)
  if (
    ctx.user.isSuperAdmin ||
    ctx.isOwner ||
    ctx.user.email === "nahid21506@gmail.com" ||
    ctx.user.name?.includes("নাহিদ হাসান") ||
    ctx.user.name?.includes("Nahid")
  ) {
    return "SUPER_ADMIN";
  }

  // 2. Mill Partner (40% Partner - Read-only)
  const roleLower = (ctx.roleName || "").toLowerCase();
  const userNameLower = (ctx.user.name || "").toLowerCase();
  if (roleLower.includes("partner") || roleLower.includes("পার্টনার") || userNameLower.includes("partner") || userNameLower.includes("পার্টনার")) {
    return "MILL_PARTNER";
  }

  // 3. Mill Accountant (Create today only)
  return "MILL_ACCOUNTANT";
}

/**
 * Retrieves the singleton RiceMillSettings (id: 1) or creates default.
 */
export async function getRiceMillSettings() {
  let settings = await prisma.riceMillSettings.findUnique({ where: { id: 1 } });
  if (!settings) {
    settings = await prisma.riceMillSettings.create({
      data: {
        id: 1,
        millName: "বিজয় অটো রাইস মিল (জয়েন্ট ভেঞ্চার)",
        millAddress: "বীরগঞ্জ, দিনাজপুর",
        millPhone: "01763921505",
        partner1Name: "নাহিদ হাসান",
        partner1SharePct: 60.0,
        partner2Name: "পার্টনার (৪০%)",
        partner2SharePct: 40.0,
        monthlyRent: 120000,
        bagStandardKg: 75.0,
        defaultDhaltaPerBag: 1.5,
        defaultDryerRate: 50.0,
        defaultMillingRate: 120.0,
        branRatePerKg: 22.0,
        huskRatePerKg: 8.0,
        invoiceFooterNote: "বিঃদ্রঃ ৭৫ কেজি = ১ স্ট্যান্ডার্ড বস্তা হিসেবে বিল গণনা করা হয়েছে।",
      },
    });
  }
  return settings;
}

/**
 * Retrieves or creates the dedicated Owner Self-Party record for Nahid Hasan.
 */
export async function getOrCreateOwnerParty() {
  let party = await prisma.millParty.findFirst({ where: { isOwnerSelfParty: true } });
  if (!party) {
    party = await prisma.millParty.create({
      data: {
        name: "নাহিদ হাসান (নিজস্ব পার্টি)",
        phone: "01763921505",
        address: "বীরগঞ্জ, দিনাজপুর",
        isOwnerSelfParty: true,
        openingBalance: 0,
        currentDue: 0,
      },
    });
  }
  return party;
}

/**
 * Standard 75 KG Bag Formula:
 * netWeightKg = (grossWeightKg - tareWeightKg) - (physicalBags * dhaltaPerBagKg)
 * standardBags75Kg = netWeightKg / bagStandardKg
 */
export function calculateStandardBags({
  grossWeightKg,
  tareWeightKg,
  physicalBags,
  dhaltaPerBagKg = 1.5,
  bagStandardKg = 75.0,
}: {
  grossWeightKg: number;
  tareWeightKg: number;
  physicalBags: number;
  dhaltaPerBagKg?: number;
  bagStandardKg?: number;
}): StandardBagResult {
  const safeGross = Number(grossWeightKg) || 0;
  const safeTare = Number(tareWeightKg) || 0;
  const safeBags = Number(physicalBags) || 0;
  const safeDhaltaRate = Number(dhaltaPerBagKg) || 0;
  const safeBagStandard = Number(bagStandardKg) > 0 ? Number(bagStandardKg) : 75.0;

  const dhaltaKg = Number((safeBags * safeDhaltaRate).toFixed(2));
  const grossMinusTare = Math.max(0, safeGross - safeTare);
  const netWeightKg = Number(Math.max(0, grossMinusTare - dhaltaKg).toFixed(2));
  const standardBags75Kg = Number((netWeightKg / safeBagStandard).toFixed(2));

  return { dhaltaKg, netWeightKg, standardBags75Kg };
}

/**
 * Custom Milling Billing Calculation:
 * dryerFee = standardBags75Kg * dryerRatePerBag
 * millingFee = standardBags75Kg * millingRatePerBag
 * byProductIncome = (branKg * branRate) + (huskKg * huskRate)
 * totalBillAmount = dryerFee + millingFee + (byProductKeptMill ? byProductIncome : 0)
 */
export function calculateMillingBill({
  standardBags75Kg,
  dryerRatePerBag = 50,
  millingRatePerBag = 120,
  branKg = 0,
  branRatePerKg = 22,
  huskKg = 0,
  huskRatePerKg = 8,
  byProductKeptMill = true,
}: {
  standardBags75Kg: number;
  dryerRatePerBag?: number;
  millingRatePerBag?: number;
  branKg?: number;
  branRatePerKg?: number;
  huskKg?: number;
  huskRatePerKg?: number;
  byProductKeptMill?: boolean;
}): MillingBillResult {
  const bags = Number(standardBags75Kg) || 0;
  const dRate = Number(dryerRatePerBag) || 0;
  const mRate = Number(millingRatePerBag) || 0;
  const bKg = Number(branKg) || 0;
  const bRate = Number(branRatePerKg) || 0;
  const hKg = Number(huskKg) || 0;
  const hRate = Number(huskRatePerKg) || 0;

  const dryerFee = Number((bags * dRate).toFixed(2));
  const millingFee = Number((bags * mRate).toFixed(2));
  const byProductIncome = byProductKeptMill
    ? Number((bKg * bRate + hKg * hRate).toFixed(2))
    : 0;
  const totalBillAmount = Number((dryerFee + millingFee + byProductIncome).toFixed(2));

  return { dryerFee, millingFee, byProductIncome, totalBillAmount };
}

/**
 * Calculates complete 60:40 JV Financials and Partner Settlement.
 */
export async function calculateJVSettlement(opts: {
  from?: Date;
  to?: Date;
} = {}): Promise<JVSettlementResult> {
  const settings = await getRiceMillSettings();
  const dateFilter = opts.from || opts.to ? {
    date: {
      ...(opts.from ? { gte: opts.from } : {}),
      ...(opts.to ? { lte: opts.to } : {}),
    },
  } : {};

  // Fetch batches with party
  const batches = await prisma.millBatch.findMany({
    where: { ...dateFilter },
    include: { party: true },
  });

  let totalOutsideRevenue = 0;
  let totalOwnerSelfRevenue = 0;
  let totalByProductRevenue = 0;

  for (const b of batches) {
    const isSelf = b.party.isOwnerSelfParty;
    const billWithoutByProduct = Number(b.dryerFee) + Number(b.millingFee);
    if (isSelf) {
      totalOwnerSelfRevenue += billWithoutByProduct;
    } else {
      totalOutsideRevenue += billWithoutByProduct;
    }
    totalByProductRevenue += Number(b.byProductIncome);
  }

  const totalRevenue = Number((totalOutsideRevenue + totalOwnerSelfRevenue + totalByProductRevenue).toFixed(2));

  // Fetch expenses
  const expenses = await prisma.millExpense.findMany({
    where: { ...dateFilter },
  });

  let totalExpenses = 0;
  let partner1OutOfPocket = 0;
  let partner2OutOfPocket = 0;
  let millCashExpenses = 0;
  const expensesByCategory: Record<string, number> = {
    MILL_RENT: 0,
    ELECTRICITY_FUEL: 0,
    LABOUR: 0,
    PARTS_MAINTENANCE: 0,
    OTHER: 0,
  };

  for (const e of expenses) {
    const amt = Number(e.amount);
    totalExpenses += amt;
    expensesByCategory[e.category] = (expensesByCategory[e.category] || 0) + amt;

    if (e.paidBy === "PARTNER_1") {
      partner1OutOfPocket += amt;
    } else if (e.paidBy === "PARTNER_2") {
      partner2OutOfPocket += amt;
    } else {
      millCashExpenses += amt;
    }
  }

  totalExpenses = Number(totalExpenses.toFixed(2));
  const netProfit = Number((totalRevenue - totalExpenses).toFixed(2));

  // Partner shares
  const p1Pct = settings.partner1SharePct || 60.0;
  const p2Pct = settings.partner2SharePct || 40.0;
  const partner1ShareAmount = Number(((netProfit * p1Pct) / 100).toFixed(2));
  const partner2ShareAmount = Number(((netProfit * p2Pct) / 100).toFixed(2));

  // Fetch vouchers for withdrawals & collections
  const vouchers = await prisma.millVoucher.findMany({
    where: { ...dateFilter },
  });

  let partner1Withdrawals = 0;
  let partner2Withdrawals = 0;
  let totalPartyCollections = 0;

  for (const v of vouchers) {
    const amt = Number(v.amount);
    if (v.type === "PAYMENT") {
      if (v.partnerTarget === "PARTNER_1") {
        partner1Withdrawals += amt;
      } else if (v.partnerTarget === "PARTNER_2") {
        partner2Withdrawals += amt;
      }
    } else if (v.type === "RECEIPT") {
      totalPartyCollections += amt;
    }
  }

  // Net settlements: Share + Out-of-pocket - Withdrawals
  const partner1NetSettlement = Number((partner1ShareAmount + partner1OutOfPocket - partner1Withdrawals).toFixed(2));
  const partner2NetSettlement = Number((partner2ShareAmount + partner2OutOfPocket - partner2Withdrawals).toFixed(2));

  // Mill Cash Balance = Total Party Collections + By-Product Revenue - Mill Cash Expenses - Withdrawals paid from Mill Cash
  const millCashBalance = Number((totalPartyCollections + totalByProductRevenue - millCashExpenses - (partner1Withdrawals + partner2Withdrawals)).toFixed(2));

  return {
    totalOutsideRevenue: Number(totalOutsideRevenue.toFixed(2)),
    totalOwnerSelfRevenue: Number(totalOwnerSelfRevenue.toFixed(2)),
    totalByProductRevenue: Number(totalByProductRevenue.toFixed(2)),
    totalRevenue,
    totalExpenses,
    expensesByCategory,
    netProfit,
    partner1Name: settings.partner1Name,
    partner1SharePct: p1Pct,
    partner1ShareAmount,
    partner1OutOfPocket: Number(partner1OutOfPocket.toFixed(2)),
    partner1Withdrawals: Number(partner1Withdrawals.toFixed(2)),
    partner1NetSettlement,
    partner2Name: settings.partner2Name,
    partner2SharePct: p2Pct,
    partner2ShareAmount,
    partner2OutOfPocket: Number(partner2OutOfPocket.toFixed(2)),
    partner2Withdrawals: Number(partner2Withdrawals.toFixed(2)),
    partner2NetSettlement,
    millCashBalance,
  };
}

/**
 * Checks if a date string or Date object is today's date in local time (Asia/Dhaka).
 */
export function isTodayDate(d: Date | string): boolean {
  const target = new Date(d);
  const now = new Date();
  return (
    target.getFullYear() === now.getFullYear() &&
    target.getMonth() === now.getMonth() &&
    target.getDate() === now.getDate()
  );
}
