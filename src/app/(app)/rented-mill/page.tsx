import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireContext } from "@/server/auth";
import {
  calculateSettlement,
  getRentedMillSettings,
  resolveRentedMillRole,
  parseDryerNames,
  parseExpenseCategories,
} from "@/lib/rented-mill";
import { formatBnCurrency, getBengaliDateLabel, toBn } from "@/lib/format";
import {
  PrintButton,
  RentedMillTabs,
} from "./rented-mill-ui";
import { QuickActionsClient, type PendingApprovalItem } from "./quick-actions-client";

export const metadata: Metadata = {
  title: "ভাড়া অটো মিল ড্যাশবোর্ড ও ৫০:৫০ লাভ-ক্ষতি হিসাব",
};

export default async function RentedMillDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const ctx = await requireContext();
  const settings = await getRentedMillSettings();
  const role = resolveRentedMillRole(ctx, settings);

  const sp = await searchParams;
  const range = sp.range || "month";

  const now = new Date();
  let dateFilter: { gte?: Date; lte?: Date } | undefined;
  let rangeLabel = "চলতি মাস";

  if (range === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    dateFilter = { gte: start, lte: end };
    rangeLabel = "আজকের হিসাব";
  } else if (range === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    dateFilter = { gte: start, lte: end };
    rangeLabel = `${now.toLocaleString("bn-BD", { month: "long" })} ${toBn(now.getFullYear())}`;
  } else if (range === "last-month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    dateFilter = { gte: start, lte: end };
    rangeLabel = "গত মাস";
  } else if (range === "custom" && (sp.from || sp.to)) {
    const gte = sp.from ? new Date(`${sp.from}T00:00:00`) : undefined;
    const lte = sp.to ? new Date(`${sp.to}T23:59:59`) : undefined;
    dateFilter = { gte, lte };
    rangeLabel = `${sp.from ? toBn(sp.from) : ""} হতে ${sp.to ? toBn(sp.to) : ""}`;
  } else if (range === "all") {
    dateFilter = undefined;
    rangeLabel = "সব সময়ের সার্বিক হিসাব";
  }

  const whereDateApproved = {
    ...(dateFilter ? { date: dateFilter } : {}),
    status: "APPROVED",
  };

  // 1. Queries for selected date range (only approved for 50:50 settlement)
  // 2. Today's metrics for quick action cards
  // 3. Pending approvals list
  // 4. Party list for dropdowns
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const todayWhere = { date: { gte: todayStart, lte: todayEnd }, status: "APPROVED" };

  const [
    bills,
    payments,
    byproducts,
    expenses,
    recentBills,
    rangePaddyReceipts,
    todayPayments,
    todayBills,
    todayByproducts,
    todayExpensesRows,
    todayPaddyReceipts,
    todayDryerMillings,
    pendingPayments,
    pendingExpenses,
    pendingPaddyReceipts,
    pendingDryerMillings,
    pendingBills,
    pendingByproducts,
    allParties,
    lastSettlement,
    priorBills,
    priorPayments,
    priorSales,
    priorExpenses,
    // Bank & Fund data
    bankAccounts,
    allApprovedFundTxs,
    pendingFundTxs,
    priorFundCashIn,
    priorFundCashOut,
    todayFundCashTxs,
  ] = await Promise.all([
    prisma.rentedMillBill.findMany({
      where: whereDateApproved,
      select: {
        totalAmount: true,
        paidAmount: true,
        dueAmount: true,
        paddyQuantity: true,
        unit: true,
      },
    }),
    prisma.rentedMillPayment.findMany({
      where: whereDateApproved,
      select: { amount: true },
    }),
    prisma.rentedMillByproductSale.findMany({
      where: whereDateApproved,
      select: {
        totalAmount: true,
        paidAmount: true,
        dueAmount: true,
        quantity: true,
      },
    }),
    prisma.rentedMillExpense.findMany({
      where: whereDateApproved,
      select: { amount: true, category: true },
    }),
    prisma.rentedMillBill.findMany({
      where: whereDateApproved,
      include: { party: true },
      orderBy: { date: "desc" },
      take: 6,
    }),
    prisma.rentedMillPaddyReceipt.findMany({
      where: whereDateApproved,
      select: { totalBillAmount: true, bagsCount: true, standardBags75kg: true },
    }),
    // Today metrics
    prisma.rentedMillPayment.findMany({
      where: todayWhere,
      select: { amount: true },
    }),
    prisma.rentedMillBill.findMany({
      where: todayWhere,
      select: { paidAmount: true },
    }),
    prisma.rentedMillByproductSale.findMany({
      where: todayWhere,
      select: { paidAmount: true },
    }),
    prisma.rentedMillExpense.findMany({
      where: todayWhere,
      select: { amount: true },
    }),
    prisma.rentedMillPaddyReceipt.findMany({
      where: todayWhere,
      select: { bagsCount: true, sklWeight: true, netSklKg: true },
    }),
    prisma.rentedMillDryerMilling.findMany({
      where: todayWhere,
      select: { usedBags: true, milledKg: true },
    }),
    // Pending items
    prisma.rentedMillPayment.findMany({
      where: { status: "PENDING" },
      include: { party: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.rentedMillExpense.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.rentedMillPaddyReceipt.findMany({
      where: { status: "PENDING" },
      include: { party: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.rentedMillDryerMilling.findMany({
      where: { status: "PENDING" },
      include: { party: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.rentedMillBill.findMany({
      where: { status: "PENDING" },
      include: { party: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.rentedMillByproductSale.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.rentedMillParty.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    }),
    prisma.rentedMillSettlement.findFirst({
      orderBy: { toDate: "desc" },
    }),
    // Prior aggregates for opening cash balance calculation
    prisma.rentedMillBill.aggregate({
      where: { date: { lt: todayStart }, status: "APPROVED" },
      _sum: { paidAmount: true },
    }),
    prisma.rentedMillPayment.aggregate({
      where: { date: { lt: todayStart }, status: "APPROVED" },
      _sum: { amount: true },
    }),
    prisma.rentedMillByproductSale.aggregate({
      where: { date: { lt: todayStart }, status: "APPROVED" },
      _sum: { paidAmount: true },
    }),
    prisma.rentedMillExpense.aggregate({
      where: { date: { lt: todayStart }, status: "APPROVED" },
      _sum: { amount: true },
    }),
    // Bank & Fund queries
    prisma.rentedMillBankAccount.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.rentedMillFundTransaction.findMany({
      where: { status: "APPROVED" },
      select: { partyType: true, transactionType: true, medium: true, amount: true },
    }),
    prisma.rentedMillFundTransaction.findMany({
      where: { status: "PENDING" },
      include: { bankAccount: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.rentedMillFundTransaction.aggregate({
      where: {
        date: { lt: todayStart },
        status: "APPROVED",
        medium: "CASH",
        OR: [
          { partyType: "BANK", transactionType: "WITHDRAW" },
          { partyType: { in: ["OWNER_1", "OWNER_2"] }, transactionType: "DEPOSIT" },
        ],
      },
      _sum: { amount: true },
    }),
    prisma.rentedMillFundTransaction.aggregate({
      where: {
        date: { lt: todayStart },
        status: "APPROVED",
        medium: "CASH",
        OR: [
          { partyType: "BANK", transactionType: "DEPOSIT" },
          { partyType: { in: ["OWNER_1", "OWNER_2"] }, transactionType: "WITHDRAW" },
        ],
      },
      _sum: { amount: true },
    }),
    prisma.rentedMillFundTransaction.findMany({
      where: {
        date: { gte: todayStart, lte: todayEnd },
        status: "APPROVED",
        medium: "CASH",
      },
      select: { partyType: true, transactionType: true, amount: true },
    }),
  ]);

  // Aggregate today's metrics
  const todayCashReceived =
    todayPayments.reduce((acc, p) => acc + (p.amount || 0), 0) +
    todayBills.reduce((acc, b) => acc + (b.paidAmount || 0), 0) +
    todayByproducts.reduce((acc, s) => acc + (s.paidAmount || 0), 0);

  const todayExpenses = todayExpensesRows.reduce((acc, e) => acc + (e.amount || 0), 0);
  const todayPaddyBags = todayPaddyReceipts.reduce((acc, r) => acc + (r.bagsCount || 0), 0);
  const todayPaddyNetKg = todayPaddyReceipts.reduce(
    (acc, r) => acc + (r.netSklKg && r.netSklKg > 0 ? r.netSklKg : (r.sklWeight || 0)),
    0
  );
  const todayMilledBags = todayDryerMillings.reduce((acc, d) => acc + (d.usedBags || 0), 0);
  const todayMilledKg = todayDryerMillings.reduce((acc, d) => acc + (d.milledKg || 0), 0);

  // Opening & closing cash balance for today (matching daily-cash report)
  const priorFundIn = priorFundCashIn._sum.amount || 0;
  const priorFundOut = priorFundCashOut._sum.amount || 0;
  const priorCashIn =
    (priorBills._sum.paidAmount || 0) +
    (priorPayments._sum.amount || 0) +
    (priorSales._sum.paidAmount || 0) +
    priorFundIn;
  const priorCashOut = (priorExpenses._sum.amount || 0) + priorFundOut;
  const openingCashBalance = Math.max(0, priorCashIn - priorCashOut);

  // Today cash-medium fund movements
  const todayFundCashIn = todayFundCashTxs
    .filter(
      (tx) =>
        (tx.partyType === "BANK" && tx.transactionType === "WITHDRAW") ||
        ((tx.partyType === "OWNER_1" || tx.partyType === "OWNER_2") && tx.transactionType === "DEPOSIT")
    )
    .reduce((acc, tx) => acc + (tx.amount || 0), 0);

  const todayFundCashOut = todayFundCashTxs
    .filter(
      (tx) =>
        (tx.partyType === "BANK" && tx.transactionType === "DEPOSIT") ||
        ((tx.partyType === "OWNER_1" || tx.partyType === "OWNER_2") && tx.transactionType === "WITHDRAW")
    )
    .reduce((acc, tx) => acc + (tx.amount || 0), 0);

  const todayTotalCashIn = todayCashReceived + todayFundCashIn;
  const todayTotalCashOut = todayExpenses + todayFundCashOut;
  const todayClosingCash = openingCashBalance + todayTotalCashIn - todayTotalCashOut;

  // Bank & Partner Balances
  const totalBankBalance = bankAccounts.reduce((s, b) => s + (b.currentBalance || 0), 0);

  const p1Txs = allApprovedFundTxs.filter((t) => t.partyType === "OWNER_1");
  const p1Deposits = p1Txs.filter((t) => t.transactionType === "DEPOSIT").reduce((s, t) => s + t.amount, 0);
  const p1Withdrawals = p1Txs.filter((t) => t.transactionType === "WITHDRAW").reduce((s, t) => s + t.amount, 0);
  const partner1Net = p1Deposits - p1Withdrawals;

  const p2Txs = allApprovedFundTxs.filter((t) => t.partyType === "OWNER_2");
  const p2Deposits = p2Txs.filter((t) => t.transactionType === "DEPOSIT").reduce((s, t) => s + t.amount, 0);
  const p2Withdrawals = p2Txs.filter((t) => t.transactionType === "WITHDRAW").reduce((s, t) => s + t.amount, 0);
  const partner2Net = p2Deposits - p2Withdrawals;

  // Map pending approval items
  const pendingItems: PendingApprovalItem[] = [
    ...pendingPayments.map((p) => ({
      id: p.id,
      type: "PAYMENT" as const,
      typeLabel: "রিসিভ ক্যাশ",
      refNo: p.receiptNo,
      date: p.date,
      partyOrCustomer: p.party.name,
      title: `${p.party.name} — টাকা জমা`,
      details: `${p.paymentMethod || "নগদ"} গ্রহণ${p.notes ? ` · ${p.notes}` : ""}`,
      amount: p.amount,
      createdByName: p.createdByName,
      createdAt: p.createdAt,
      rawData: p,
    })),
    ...pendingExpenses.map((e) => ({
      id: e.id,
      type: "EXPENSE" as const,
      typeLabel: "পেমেন্ট/খরচ",
      refNo: e.expenseNo,
      date: e.date,
      title: e.category,
      details: `${e.paidTo ? `প্রাপক: ${e.paidTo} · ` : ""}${e.description || ""}`,
      amount: e.amount,
      createdByName: e.createdByName,
      createdAt: e.createdAt,
      rawData: e,
    })),
    ...pendingPaddyReceipts.map((r) => ({
      id: r.id,
      type: "PADDY_RECEIPT" as const,
      typeLabel: "ধান প্রাপ্তি",
      refNo: r.receiptNo,
      date: r.date,
      partyOrCustomer: r.party.name,
      title: `${r.party.name} (${r.paddyName})`,
      details: `${toBn(r.bagsCount)} বস্তা (চট: ${toBn(r.juteBags)}, প্লা: ${toBn(r.plasticBags)}) · নিট: ${toBn(Math.round(r.netSklKg || r.sklWeight).toLocaleString())} কেজি · ৭৫-স্টা: ${toBn(r.standardBags75kg.toFixed(1))}টি @ ৳${toBn(r.ratePerStandardBag)}`,
      amount: r.totalBillAmount > 0 ? r.totalBillAmount : undefined,
      createdByName: r.createdByName,
      createdAt: r.createdAt,
      rawData: r,
    })),
    ...pendingDryerMillings.map((d) => ({
      id: d.id,
      type: "DRYER_MILLING" as const,
      typeLabel: "ডায়ার ছাটাই",
      refNo: d.entryNo,
      date: d.date,
      partyOrCustomer: d.party.name,
      title: `${d.party.name} (${d.dryerNo})`,
      details: `ব্যবহৃত বস্তা: ${toBn(d.usedBags)} টি · ছাটাই ওজন: ${toBn(d.milledKg.toLocaleString())} কেজি`,
      amount: undefined,
      createdByName: d.createdByName,
      createdAt: d.createdAt,
      rawData: d,
    })),
    ...pendingBills.map((b) => ({
      id: b.id,
      type: "MILLING_BILL" as const,
      typeLabel: "ছাটাই বিল",
      refNo: b.billNo,
      date: b.date,
      partyOrCustomer: b.party.name,
      title: `${b.party.name} — ছাটাই বিল`,
      details: `${toBn(b.paddyQuantity)} ${b.unit} @ ৳${toBn(b.millingRate)} (নগদ পরিশোধ: ৳${toBn(b.paidAmount)})`,
      amount: b.totalAmount,
      createdByName: b.createdByName,
      createdAt: b.createdAt,
      rawData: b,
    })),
    ...pendingByproducts.map((s) => ({
      id: s.id,
      type: "BYPRODUCT_SALE" as const,
      typeLabel: "উপজাত বিক্রয়",
      refNo: s.invoiceNo,
      date: s.date,
      partyOrCustomer: s.customerName,
      title: `${s.customerName} — ${s.productType} বিক্রয়`,
      details: `${toBn(s.quantity)} ${s.unit} @ ৳${toBn(s.rate)}`,
      amount: s.totalAmount,
      createdByName: s.createdByName,
      createdAt: s.createdAt,
      rawData: s,
    })),
    ...pendingFundTxs.map((f) => {
      let typeLabel = "তহবিল লেনদেন";
      let title = "";
      if (f.partyType === "BANK") {
        typeLabel = f.transactionType === "DEPOSIT" ? "ব্যাংকে জমা" : "ব্যাংক উত্তোলন";
        title = `${f.bankAccount?.bankName || "ব্যাংক"} — ${f.transactionType === "DEPOSIT" ? "ক্যাশ জমা" : "ক্যাশ উত্তোলন"}`;
      } else {
        const pName = f.partyType === "OWNER_1" ? (settings.partner1Name || "নাহিদ হাসান") : (settings.partner2Name || "পার্টনার");
        typeLabel = f.transactionType === "DEPOSIT" ? "মালিকের জমা" : "মালিকের উত্তোলন";
        title = `${pName} — ${f.transactionType === "DEPOSIT" ? "টাকা জমা" : "টাকা উত্তোলন"}`;
      }
      const details = `${f.medium === "BANK" ? "ব্যাংক মাধ্যমে" : "নগদ মাধ্যমে"}${f.reference ? ` · রেফারেন্স: ${f.reference}` : ""}`;

      return {
        id: f.id,
        type: "FUND_TRANSACTION" as const,
        typeLabel,
        refNo: f.transactionNo,
        date: f.date,
        partyOrCustomer: f.partnerName || (f.partyType === "BANK" ? f.bankAccount?.bankName : undefined),
        title,
        details,
        amount: f.amount,
        createdByName: f.createdByName,
        createdAt: f.createdAt,
        rawData: f,
      };
    }),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const settlement = calculateSettlement(
    bills,
    payments,
    byproducts,
    expenses,
    settings,
    rangePaddyReceipts
  );

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <RentedMillTabs role={role} />

      {/* Header & Date Filter Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-rule pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-ink-900">
              {settings.millName}
            </h1>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
              ৫০% : ৫০% যৌথ হিসাব
            </span>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-slate-500">
            হিসাবকাল: <b className="text-ink-800">{rangeLabel}</b> · মাসিক মিল ভাড়া:{" "}
            <b>{formatBnCurrency(settings.monthlyRent)}</b>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-rule bg-white p-1 text-xs shadow-2xs no-print">
            <Link
              href="/rented-mill?range=today"
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                range === "today" ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-100"
              }`}
            >
              আজ
            </Link>
            <Link
              href="/rented-mill?range=month"
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                range === "month" ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-100"
              }`}
            >
              চলতি মাস
            </Link>
            <Link
              href="/rented-mill?range=last-month"
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                range === "last-month" ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-100"
              }`}
            >
              গত মাস
            </Link>
            <Link
              href="/rented-mill?range=all"
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                range === "all" ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-100"
              }`}
            >
              সব সময়
            </Link>
          </div>
          <PrintButton label="স্টেটমেন্ট প্রিন্ট" />
        </div>
      </div>

      {/* Quick Action Cards & Pending Approvals */}
      <QuickActionsClient
        role={role}
        parties={allParties}
        todayCashReceived={todayCashReceived}
        todayExpenses={todayExpenses}
        todayPaddyBags={todayPaddyBags}
        todayPaddyKg={Math.round(todayPaddyNetKg)}
        todayMilledBags={todayMilledBags}
        pendingItems={pendingItems}
        dryerNames={parseDryerNames(settings.dryerNames)}
        expenseCategories={parseExpenseCategories(settings.expenseCategories)}
        bankAccounts={bankAccounts as any}
        totalBankBalance={totalBankBalance}
        partner1Net={partner1Net}
        partner2Net={partner2Net}
        partner1Name={settings.partner1Name || "নাহিদ হাসান"}
        partner2Name={settings.partner2Name || "পার্টনার"}
      />

      {/* ────────────────── দৈনিক রিপোর্ট ও প্রিন্ট শিট (Daily Reports & Print Sheets) ────────────────── */}
      <div className="no-print space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 border-b border-rule pb-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white text-base shadow-xs">
              📑
            </span>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-ink-900 flex items-center gap-2">
                দৈনিক রিপোর্ট ও প্রিন্ট (দিন শেষের হিসাব)
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                  Daily Reports
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                হিসাবরক্ষক ও অংশীদারদের দিন শেষের জমা-খরচ, ধান গ্রহণ, ছাটাই ও খরচের পূর্ণাঙ্গ A4 প্রিন্ট শিট
              </p>
            </div>
          </div>
          <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg self-start sm:self-auto">
            তারিখ: {getBengaliDateLabel(todayStart)}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Card 1: দৈনিক জমা খরচ রিপোর্ট */}
          <div className="flex flex-col justify-between rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50/70 to-white p-4 shadow-2xs hover:shadow-xs transition">
            <div>
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 text-lg">
                  💵
                </span>
                <span className="rounded-full bg-emerald-100 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  ক্যাশ ব্যালেন্স
                </span>
              </div>
              <h3 className="mt-2.5 text-sm font-bold text-ink-900">
                দৈনিক জমা খরচ রিপোর্ট
              </h3>
              <p className="text-[11px] text-slate-500 line-clamp-1">
                আজকের মোট জমা, খরচ ও দিন শেষের ক্যাশ
              </p>
              <div className="mt-3 rounded-xl bg-white border border-emerald-100 p-2.5 shadow-2xs">
                <span className="text-[11px] font-semibold text-emerald-700 block">
                  অবশিষ্ট ক্যাশ ব্যালেন্স:
                </span>
                <span className="text-xl font-black text-emerald-900 block mt-0.5">
                  {formatBnCurrency(todayClosingCash)}
                </span>
                <div className="mt-1 pt-1 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                  <span>জমা: {formatBnCurrency(todayTotalCashIn)}</span>
                  <span>খরচ: {formatBnCurrency(todayTotalCashOut)}</span>
                </div>
              </div>
            </div>

            <div className="mt-3.5 grid grid-cols-2 gap-2 border-t border-emerald-100/80 pt-3">
              <Link
                href="/rented-mill/reports/daily-cash"
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-ink-800 hover:bg-slate-50 transition"
              >
                <span>👁️</span> রিপোর্ট দেখুন
              </Link>
              <Link
                href="/rented-mill/reports/daily-cash?print=true"
                target="_blank"
                className="inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-700 px-2 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-800 transition"
              >
                <span>🖨️</span> প্রিন্ট করুন
              </Link>
            </div>
          </div>

          {/* Card 2: দৈনিক ধান প্রাপ্তি হিসাব */}
          <div className="flex flex-col justify-between rounded-2xl border border-blue-200 bg-gradient-to-b from-blue-50/70 to-white p-4 shadow-2xs hover:shadow-xs transition">
            <div>
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-800 text-lg">
                  🌾
                </span>
                <span className="rounded-full bg-blue-100 border border-blue-200 px-2 py-0.5 text-[10px] font-bold text-blue-800">
                  ধান স্টক শিট
                </span>
              </div>
              <h3 className="mt-2.5 text-sm font-bold text-ink-900">
                দৈনিক ধান প্রাপ্তি হিসাব
              </h3>
              <p className="text-[11px] text-slate-500 line-clamp-1">
                পার্টির ধান জমা, বস্তা ও স্কেল ওজন তালিকা
              </p>
              <div className="mt-3 rounded-xl bg-white border border-blue-100 p-2.5 shadow-2xs">
                <span className="text-[11px] font-semibold text-blue-700 block">
                  আজকের মোট প্রাপ্ত ধান:
                </span>
                <span className="text-xl font-black text-blue-950 block mt-0.5">
                  {toBn(todayPaddyBags)} বস্তা
                </span>
                <div className="mt-1 pt-1 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                  <span>নিট: {toBn(Math.round(todayPaddyNetKg).toLocaleString())} কেজি</span>
                  <span>{toBn(todayPaddyReceipts.length)} টি এন্ট্রি</span>
                </div>
              </div>
            </div>

            <div className="mt-3.5 grid grid-cols-2 gap-2 border-t border-blue-100/80 pt-3">
              <Link
                href="/rented-mill/reports/paddy-receipt"
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-ink-800 hover:bg-slate-50 transition"
              >
                <span>👁️</span> রিপোর্ট দেখুন
              </Link>
              <Link
                href="/rented-mill/reports/paddy-receipt?print=true"
                target="_blank"
                className="inline-flex items-center justify-center gap-1 rounded-lg bg-blue-700 px-2 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-blue-800 transition"
              >
                <span>🖨️</span> প্রিন্ট করুন
              </Link>
            </div>
          </div>

          {/* Card 3: দৈনিক ডায়ার ও ছাটাই রিপোর্ট */}
          <div className="flex flex-col justify-between rounded-2xl border border-amber-200 bg-gradient-to-b from-amber-50/70 to-white p-4 shadow-2xs hover:shadow-xs transition">
            <div>
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-900 text-lg">
                  ♨️
                </span>
                <span className="rounded-full bg-amber-100 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                  মিলিং প্রোডাকশন
                </span>
              </div>
              <h3 className="mt-2.5 text-sm font-bold text-ink-900">
                দৈনিক ডায়ার ও ছাটাই রিপোর্ট
              </h3>
              <p className="text-[11px] text-slate-500 line-clamp-1">
                ডায়ার অনুযায়ী শুকানো ও ছাটাইকৃত চাল
              </p>
              <div className="mt-3 rounded-xl bg-white border border-amber-100 p-2.5 shadow-2xs">
                <span className="text-[11px] font-semibold text-amber-800 block">
                  আজকের মোট ছাটাই:
                </span>
                <span className="text-xl font-black text-amber-950 block mt-0.5">
                  {toBn(todayMilledBags)} বস্তা
                </span>
                <div className="mt-1 pt-1 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                  <span>ছাটাইকৃত: {toBn(Math.round(todayMilledKg).toLocaleString())} কেজি</span>
                  <span>{toBn(todayDryerMillings.length)} টি ডায়ার</span>
                </div>
              </div>
            </div>

            <div className="mt-3.5 grid grid-cols-2 gap-2 border-t border-amber-100/80 pt-3">
              <Link
                href="/rented-mill/reports/dryer-milling"
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-ink-800 hover:bg-slate-50 transition"
              >
                <span>👁️</span> রিপোর্ট দেখুন
              </Link>
              <Link
                href="/rented-mill/reports/dryer-milling?print=true"
                target="_blank"
                className="inline-flex items-center justify-center gap-1 rounded-lg bg-amber-700 px-2 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-amber-800 transition"
              >
                <span>🖨️</span> প্রিন্ট করুন
              </Link>
            </div>
          </div>

          {/* Card 4: খরচের বিস্তারিত বিবরণ */}
          <div className="flex flex-col justify-between rounded-2xl border border-rose-200 bg-gradient-to-b from-rose-50/70 to-white p-4 shadow-2xs hover:shadow-xs transition">
            <div>
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-100 text-rose-800 text-lg">
                  💸
                </span>
                <span className="rounded-full bg-rose-100 border border-rose-200 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                  দৈনিক ব্যয়
                </span>
              </div>
              <h3 className="mt-2.5 text-sm font-bold text-ink-900">
                খরচের বিস্তারিত বিবরণ
              </h3>
              <p className="text-[11px] text-slate-500 line-clamp-1">
                মিল পরিচালনা, বিদ্যুৎ, লেবার ও যাবতীয় ব্যয়
              </p>
              <div className="mt-3 rounded-xl bg-white border border-rose-100 p-2.5 shadow-2xs">
                <span className="text-[11px] font-semibold text-rose-700 block">
                  আজকের মোট খরচ:
                </span>
                <span className="text-xl font-black text-rose-900 block mt-0.5">
                  {formatBnCurrency(todayExpenses)}
                </span>
                <div className="mt-1 pt-1 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                  <span>অনুমোদিত খরচ</span>
                  <span>{toBn(todayExpensesRows.length)} টি ভাউচার</span>
                </div>
              </div>
            </div>

            <div className="mt-3.5 grid grid-cols-2 gap-2 border-t border-rose-100/80 pt-3">
              <Link
                href="/rented-mill/reports/expense-details?range=today"
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-ink-800 hover:bg-slate-50 transition"
              >
                <span>👁️</span> রিপোর্ট দেখুন
              </Link>
              <Link
                href="/rented-mill/reports/expense-details?range=today&print=true"
                target="_blank"
                className="inline-flex items-center justify-center gap-1 rounded-lg bg-rose-700 px-2 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-rose-800 transition"
              >
                <span>🖨️</span> প্রিন্ট করুন
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Print Statement Header (Visible only when printed) */}
      <div className="hidden print:block text-center border-b pb-3 mb-4">
        <h2 className="text-2xl font-bold">{settings.millName}</h2>
        <p className="text-xs text-slate-600">{settings.millAddress} · {settings.millPhone}</p>
        <p className="text-sm font-semibold mt-1">
          ৫০:৫০ যৌথ অংশীদারিত্ব লাভ-ক্ষতি ও নিষ্পত্তি স্টেটমেন্ট ({rangeLabel})
        </p>
        <p className="text-xs text-slate-500">প্রিন্ট তারিখ: {getBengaliDateLabel(new Date())}</p>
      </div>

      {/* KPI Cards: Income & Expenses Overview */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        {/* ১. ধান ছাটাই বিল */}
        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 shadow-2xs">
          <p className="text-xs font-semibold text-blue-700">ধান ছাটাই আয়</p>
          <p className="mt-1.5 text-lg sm:text-xl font-bold text-blue-900">
            {formatBnCurrency(settlement.totalMillingRevenue)}
          </p>
          <p className="mt-1 text-[11px] text-blue-800">
            নগদ আদায়: {formatBnCurrency(settlement.totalMillingCash)}
          </p>
          <p className="text-[11px] text-amber-700 font-medium">
            বকেয়া: {formatBnCurrency(settlement.totalMillingDue)}
          </p>
        </div>

        {/* ২. ভুষি ও কুঁড়া বিক্রয় */}
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 shadow-2xs">
          <p className="text-xs font-semibold text-amber-800">ভুষি ও কুঁড়া বিক্রয়</p>
          <p className="mt-1.5 text-lg sm:text-xl font-bold text-amber-950">
            {formatBnCurrency(settlement.totalByproductRevenue)}
          </p>
          <p className="mt-1 text-[11px] text-amber-800">
            নগদ আদায়: {formatBnCurrency(settlement.totalByproductCash)}
          </p>
          <p className="text-[11px] text-slate-600">
            মোট বিক্রয়: {toBn(settlement.totalByproductKg.toFixed(0))} কেজি
          </p>
        </div>

        {/* ৩. সর্বমোট মিল আয় */}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-2xs">
          <p className="text-xs font-semibold text-emerald-800">সর্বমোট মিল আয়</p>
          <p className="mt-1.5 text-lg sm:text-xl font-bold text-emerald-950">
            {formatBnCurrency(settlement.totalIncome)}
          </p>
          <p className="mt-1 text-[11px] text-emerald-800">
            নগদ জমা: {formatBnCurrency(settlement.totalCashReceived)}
          </p>
          <p className="text-[11px] text-slate-600">
            মোট বকেয়া: {formatBnCurrency(settlement.totalMillingDue + settlement.totalByproductDue)}
          </p>
        </div>

        {/* ৪. মোট মিল খরচ */}
        <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 shadow-2xs">
          <p className="text-xs font-semibold text-red-700">মিল ভাড়া ও মোট খরচ</p>
          <p className="mt-1.5 text-lg sm:text-xl font-bold text-red-900">
            {formatBnCurrency(settlement.totalExpenses)}
          </p>
          <p className="mt-1 text-[11px] text-red-800">
            ভাড়া ও যাবতীয় অপরেটিং খরচ
          </p>
          <p className="text-[11px] text-slate-500">
            {bills.length} টি ছাটাই এন্ট্রি
          </p>
        </div>

        {/* ৫. নিট লাভ / ক্ষতি */}
        <div
          className={`col-span-2 sm:col-span-4 lg:col-span-1 rounded-xl border p-4 shadow-2xs ${
            settlement.netProfit >= 0
              ? "border-emerald-300 bg-emerald-50 text-emerald-950"
              : "border-red-300 bg-red-50 text-red-950"
          }`}
        >
          <p className="text-xs font-bold uppercase tracking-wider">
            {settlement.netProfit >= 0 ? "নিট লাভ (Net Profit)" : "নিট ক্ষতি (Net Loss)"}
          </p>
          <p className="mt-1.5 text-xl sm:text-2xl font-extrabold">
            {formatBnCurrency(Math.abs(settlement.netProfit))}
          </p>
          <p className="mt-1 text-xs">
            {settlement.netProfit >= 0 ? "লাভ বণ্টনযোগ্য" : "অংশীদারদের বহনযোগ্য"}
          </p>
        </div>
      </div>

      {/* ৫০% : ৫০% লাভ বণ্টন কার্ড (50:50 Settlement Card) */}
      <div className="rounded-2xl border-2 border-brand-500 bg-gradient-to-br from-brand-50/60 via-white to-emerald-50/60 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-brand-200 pb-3 mb-4">
          <div>
            <h2 className="text-lg font-bold text-ink-900 flex items-center gap-2">
              <span>🤝</span> ৫০% : ৫০% যৌথ অংশীদারিত্ব লাভ বণ্টন
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              মোট আয় থেকে মিল ভাড়া ও সকল খরচ বাদ দিয়ে ৫০% হারে অংশীদারদের মধ্যে বণ্টন
            </p>
          </div>
          <div className="mt-2 sm:mt-0 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-brand-100 px-3 py-1 text-xs font-bold text-brand-800">
              বণ্টন অনুপাত: {toBn(settings.partner1Share)}% : {toBn(settings.partner2Share)}%
            </span>
            <Link
              href="/rented-mill/profit-settlement"
              className="inline-flex items-center rounded-lg bg-brand-600 px-3 py-1 text-xs font-bold text-white shadow-xs hover:bg-brand-700 transition"
            >
              ⚖️ ৫০:৫০ বণ্টন ও নিষ্পত্তি →
            </Link>
          </div>
        </div>

        {/* Settlement Status Banner */}
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl bg-brand-100/70 p-3 text-xs border border-brand-200">
          <div className="flex items-center gap-2">
            <span className="text-base">⚖️</span>
            <div>
              <span className="font-bold text-brand-950">
                {lastSettlement
                  ? `সর্বশেষ চূড়ান্ত নিষ্পত্তি: ${lastSettlement.settlementNo} (${getBengaliDateLabel(lastSettlement.toDate)})`
                  : "এখনও কোনো চূড়ান্ত লাভ-ক্ষতি নিষ্পত্তি বা হিসাব ক্লোজ করা হয়নি"}
              </span>
              <p className="text-[11px] text-brand-800">
                নির্দিষ্ট মেয়াদ (মাস/৩ মাস) শেষে ৫০:৫০ লাভ-ক্ষতি বণ্টন চূড়ান্ত করতে ও হিসেব ক্লোজ করতে এখানে যান
              </p>
            </div>
          </div>
          <Link
            href="/rented-mill/profit-settlement"
            className="inline-flex items-center justify-center rounded-lg bg-brand-700 px-3 py-1 text-xs font-bold text-white shadow-xs hover:bg-brand-800 transition shrink-0"
          >
            নিষ্পত্তি পেজ →
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* নাহিদ হাসান (৫০%) */}
          <div className="rounded-xl border border-brand-200 bg-white p-4 shadow-2xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500">মালিক / অংশীদার ১ ({toBn(settings.partner1Share)}%)</p>
              <p className="text-base sm:text-lg font-bold text-ink-900">{settings.partner1Name}</p>
              <p className="text-xs text-slate-500 mt-0.5">৫০% নিট লভ্যাংশ</p>
            </div>
            <div className="text-right">
              <span className={`text-xl sm:text-2xl font-black ${settlement.partner1ShareAmount >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                {formatBnCurrency(settlement.partner1ShareAmount)}
              </span>
              <p className="text-[11px] text-slate-500">
                {settlement.partner1ShareAmount >= 0 ? "প্রাপ্য লাভ" : "প্রদেয় ক্ষতি"}
              </p>
            </div>
          </div>

          {/* পার্টনার (৫০%) */}
          <div className="rounded-xl border border-emerald-200 bg-white p-4 shadow-2xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500">অংশীদার ২ ({toBn(settings.partner2Share)}%)</p>
              <p className="text-base sm:text-lg font-bold text-ink-900">{settings.partner2Name}</p>
              <p className="text-xs text-slate-500 mt-0.5">৫০% নিট লভ্যাংশ</p>
            </div>
            <div className="text-right">
              <span className={`text-xl sm:text-2xl font-black ${settlement.partner2ShareAmount >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                {formatBnCurrency(settlement.partner2ShareAmount)}
              </span>
              <p className="text-[11px] text-slate-500">
                {settlement.partner2ShareAmount >= 0 ? "প্রাপ্য লাভ" : "প্রদেয় ক্ষতি"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* খরচের খাতভিত্তিক বিভাজন ও সারসংক্ষেপ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* খরচের খাতভিত্তিক টেবিল */}
        <div className="lg:col-span-1 rounded-xl border border-rule bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between border-b border-rule pb-2 mb-3">
            <h3 className="text-sm font-bold text-ink-900">খরচের খাতভিত্তিক বিবরণ</h3>
            {role !== "PARTNER" ? (
              <Link href="/rented-mill/expenses" className="text-xs text-brand-600 font-semibold hover:underline">
                নতুন খরচ এন্ট্রি →
              </Link>
            ) : (
              <Link href="/rented-mill/reports/expense-details" className="text-xs text-brand-600 font-semibold hover:underline">
                খরচের বিস্তারিত →
              </Link>
            )}
          </div>
          <div className="space-y-2 text-xs">
            {Object.entries(settlement.expensesByCategory).map(([cat, amt]) => (
              <div key={cat} className="flex items-center justify-between py-1.5 border-b border-dashed border-slate-100 last:border-0">
                <span className="text-slate-600 font-medium">{cat}</span>
                <span className="font-bold text-ink-900">{formatBnCurrency(amt)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2 border-t-2 border-rule font-bold text-sm text-red-700">
              <span>মোট ব্যয়</span>
              <span>{formatBnCurrency(settlement.totalExpenses)}</span>
            </div>
          </div>
        </div>

        {/* সাম্প্রতিক ধান ছাটাই বিল */}
        <div className="lg:col-span-2 rounded-xl border border-rule bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between border-b border-rule pb-2 mb-3">
            <h3 className="text-sm font-bold text-ink-900">সাম্প্রতিক ধান ছাটাই বিল</h3>
            <Link href="/rented-mill/milling-bills" className="text-xs text-brand-600 font-semibold hover:underline">
              {role !== "PARTNER" ? "সব বিল ও নতুন এন্ট্রি →" : "সব বিল দেখুন →"}
            </Link>
          </div>

          {recentBills.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">
              এই সময়কালে কোনো ধান ছাটাই বিল পাওয়া যায়নি।
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-rule text-slate-500">
                    <th className="py-2 font-medium">বিল নং</th>
                    <th className="py-2 font-medium">তারিখ</th>
                    <th className="py-2 font-medium">পার্টির নাম</th>
                    <th className="py-2 font-medium text-right">পরিমাণ</th>
                    <th className="py-2 font-medium text-right">মোট বিল</th>
                    <th className="py-2 font-medium text-right">নগদ জমা</th>
                    <th className="py-2 font-medium text-right">বাকি</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentBills.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="py-2 font-bold text-ink-800">{b.billNo}</td>
                      <td className="py-2 text-slate-500">{getBengaliDateLabel(b.date)}</td>
                      <td className="py-2 font-medium text-ink-900">
                        {b.party.name}
                        {b.party.isSelfParty && (
                          <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800 font-normal">
                            নিজস্ব
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {toBn(b.paddyQuantity)} {b.unit}
                      </td>
                      <td className="py-2 text-right font-semibold text-ink-900">
                        {formatBnCurrency(b.totalAmount)}
                      </td>
                      <td className="py-2 text-right text-emerald-700">
                        {formatBnCurrency(b.paidAmount)}
                      </td>
                      <td className="py-2 text-right text-red-700 font-semibold">
                        {formatBnCurrency(b.dueAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* প্রিন্ট স্টেটমেন্টের জন্য সিগনেচার সেকশন */}
      <div className="hidden print:grid grid-cols-2 gap-12 pt-16 text-center text-xs text-slate-700">
        <div>
          <div className="border-t border-slate-400 pt-2 font-semibold">
            {settings.partner1Name} (মালিক - ৫০%)
          </div>
          <p className="text-[11px] text-slate-500">স্বাক্ষর ও তারিখ</p>
        </div>
        <div>
          <div className="border-t border-slate-400 pt-2 font-semibold">
            {settings.partner2Name} (অংশীদার - ৫০%)
          </div>
          <p className="text-[11px] text-slate-500">স্বাক্ষর ও তারিখ</p>
        </div>
      </div>
    </div>
  );
}
