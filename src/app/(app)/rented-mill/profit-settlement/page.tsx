import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireContext } from "@/server/auth";
import {
  getRentedMillSettings,
  resolveRentedMillRole,
} from "@/lib/rented-mill";
import { RentedMillTabs } from "../rented-mill-ui";
import { ProfitSettlementClient } from "./settlement-client";

export const metadata: Metadata = {
  title: "লাভ-ক্ষতি ও ৫০:৫০ বণ্টন / নিষ্পত্তি - শুভংকর অটো রাইস মিল",
};

export default async function ProfitSettlementPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const ctx = await requireContext();
  const settings = await getRentedMillSettings();
  const role = resolveRentedMillRole(ctx, settings);

  const sp = await searchParams;
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const monthStartStr = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split("T")[0];

  const fromStr = sp.from || monthStartStr;
  const toStr = sp.to || todayStr;

  const fromDate = new Date(`${fromStr}T00:00:00`);
  const toDate = new Date(`${toStr}T23:59:59`);

  const [
    paddyReceipts,
    bills,
    byproductSales,
    expenses,
    settlements,
    lastSettlement,
    fundTransactions,
  ] = await Promise.all([
    prisma.rentedMillPaddyReceipt.findMany({
      where: {
        date: { gte: fromDate, lte: toDate },
        status: "APPROVED",
        isSettled: false,
        totalBillAmount: { gt: 0 },
      },
      select: { id: true, totalBillAmount: true },
    }),
    prisma.rentedMillBill.findMany({
      where: {
        date: { gte: fromDate, lte: toDate },
        status: "APPROVED",
        isSettled: false,
      },
      select: { id: true, totalAmount: true },
    }),
    prisma.rentedMillByproductSale.findMany({
      where: {
        date: { gte: fromDate, lte: toDate },
        status: "APPROVED",
        isSettled: false,
      },
      select: { id: true, totalAmount: true },
    }),
    prisma.rentedMillExpense.findMany({
      where: {
        date: { gte: fromDate, lte: toDate },
        status: "APPROVED",
        isSettled: false,
      },
      select: { id: true, category: true, amount: true },
    }),
    prisma.rentedMillSettlement.findMany({
      orderBy: { createdAt: "desc" },
    }),
    prisma.rentedMillSettlement.findFirst({
      orderBy: { toDate: "desc" },
    }),
    prisma.rentedMillFundTransaction.findMany({
      where: {
        date: { gte: fromDate, lte: toDate },
        status: "APPROVED",
        partyType: { in: ["OWNER_1", "OWNER_2"] },
      },
      select: { partyType: true, transactionType: true, amount: true },
    }),
  ]);

  const totalMillingIncome =
    paddyReceipts.reduce((sum, r) => sum + r.totalBillAmount, 0) +
    bills.reduce((sum, b) => sum + b.totalAmount, 0);

  const totalByproductIncome = byproductSales.reduce(
    (sum, s) => sum + s.totalAmount,
    0
  );
  const totalIncome = totalMillingIncome + totalByproductIncome;

  const totalRentExpense = expenses
    .filter((e) => e.category === "মাসিক মিল ভাড়া")
    .reduce((sum, e) => sum + e.amount, 0);

  const totalOtherExpense = expenses
    .filter((e) => e.category !== "মাসিক মিল ভাড়া")
    .reduce((sum, e) => sum + e.amount, 0);

  const totalExpense = totalRentExpense + totalOtherExpense;
  const netProfit = totalIncome - totalExpense;

  const p1Share = settings.partner1Share || 50;
  const p2Share = settings.partner2Share || 50;
  const partner1Amount = Math.round((netProfit * p1Share) / 100);
  const partner2Amount = Math.round((netProfit * p2Share) / 100);

  const expensesByCategory: Record<string, number> = {};
  for (const e of expenses) {
    expensesByCategory[e.category] =
      (expensesByCategory[e.category] || 0) + e.amount;
  }

  // Partner Fund summary (deposits & drawings during this period as reference)
  const p1Txs = fundTransactions.filter((t) => t.partyType === "OWNER_1");
  const p1Deposit = p1Txs.filter((t) => t.transactionType === "DEPOSIT").reduce((s, t) => s + t.amount, 0);
  const p1Withdraw = p1Txs.filter((t) => t.transactionType === "WITHDRAW").reduce((s, t) => s + t.amount, 0);
  const p1FundNet = p1Deposit - p1Withdraw;
  const p1FinalAmount = partner1Amount + p1FundNet;

  const p2Txs = fundTransactions.filter((t) => t.partyType === "OWNER_2");
  const p2Deposit = p2Txs.filter((t) => t.transactionType === "DEPOSIT").reduce((s, t) => s + t.amount, 0);
  const p2Withdraw = p2Txs.filter((t) => t.transactionType === "WITHDRAW").reduce((s, t) => s + t.amount, 0);
  const p2FundNet = p2Deposit - p2Withdraw;
  const p2FinalAmount = partner2Amount + p2FundNet;

  const unsettledData = {
    totalMillingIncome,
    totalByproductIncome,
    totalIncome,
    totalRentExpense,
    totalOtherExpense,
    totalExpense,
    netProfit,
    partner1Amount,
    partner2Amount,
    paddyReceiptCount: paddyReceipts.length,
    billsCount: bills.length,
    byproductSaleCount: byproductSales.length,
    expenseCount: expenses.length,
    expensesByCategory,
    partnerFundSummary: {
      partner1: {
        deposit: p1Deposit,
        withdraw: p1Withdraw,
        net: p1FundNet,
        finalAmount: p1FinalAmount,
      },
      partner2: {
        deposit: p2Deposit,
        withdraw: p2Withdraw,
        net: p2FundNet,
        finalAmount: p2FinalAmount,
      },
    },
  };

  const lastSettledDate = lastSettlement
    ? new Date(lastSettlement.toDate).toISOString().split("T")[0]
    : null;

  return (
    <div className="space-y-6">
      <RentedMillTabs role={role} />

      {/* Page Header */}
      <div className="border-b border-rule pb-4 no-print">
        <h1 className="text-xl sm:text-2xl font-bold text-ink-900">
          লাভ-ক্ষতি ও ৫০:৫০ বণ্টন / নিষ্পত্তি
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-500">
          {settings.millName}, {settings.millAddress} · অংশীদারদের মধ্যে নির্দিষ্ট মেয়াদের নিট লাভ বা ক্ষতি হিসাব ও চূড়ান্ত নিষ্পত্তি
        </p>
      </div>

      <ProfitSettlementClient
        role={role}
        fromDate={fromStr}
        toDate={toStr}
        lastSettledDate={lastSettledDate}
        settings={settings}
        unsettledData={unsettledData}
        settlements={settlements}
      />
    </div>
  );
}
