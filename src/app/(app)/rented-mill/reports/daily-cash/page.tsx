import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireContext } from "@/server/auth";
import {
  getRentedMillSettings,
  resolveRentedMillRole,
} from "@/lib/rented-mill";
import { formatBnCurrency, getBengaliDateLabel, toBn } from "@/lib/format";
import {
  AutoPrint,
  PrintButton,
  RentedMillTabs,
  ReportPrintHeader,
} from "../../rented-mill-ui";
import {
  ExpenseRowActions,
  PaymentRowActions,
  MillingBillRowActions,
  ByproductSaleRowActions,
} from "../../rented-mill-edit-modals";
import { FundTransactionRowActions } from "../../fund-transaction-modals";

export const metadata: Metadata = {
  title: "দৈনিক জমা খরচ রিপোর্ট - শুভংকর অটো রাইস মিল",
};

export default async function DailyCashReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; print?: string }>;
}) {
  const ctx = await requireContext();
  const settings = await getRentedMillSettings();
  const role = resolveRentedMillRole(ctx, settings);

  const sp = await searchParams;
  const shouldAutoPrint = sp.print === "true";
  const todayStr = new Date().toISOString().split("T")[0];
  const selectedDateStr = sp.date || todayStr;

  const targetDate = new Date(`${selectedDateStr}T00:00:00`);
  const dayStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0);
  const dayEnd = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59);

  // 1. Calculate opening balance (পূর্বের জমা) before this day
  const [
    priorBills,
    priorPayments,
    priorSales,
    priorExpenses,
    priorFundCashIn,
    priorFundCashOut,
    // 2. Data on the selected day
    todayExpenses,
    todayBills,
    todayPayments,
    todaySales,
    todayFundTxs,
    bankAccounts,
    parties,
  ] = await Promise.all([
    prisma.rentedMillBill.aggregate({
      where: { date: { lt: dayStart }, status: "APPROVED" },
      _sum: { paidAmount: true },
    }),
    prisma.rentedMillPayment.aggregate({
      where: { date: { lt: dayStart }, status: "APPROVED" },
      _sum: { amount: true },
    }),
    prisma.rentedMillByproductSale.aggregate({
      where: { date: { lt: dayStart }, status: "APPROVED" },
      _sum: { paidAmount: true },
    }),
    prisma.rentedMillExpense.aggregate({
      where: { date: { lt: dayStart }, status: "APPROVED" },
      _sum: { amount: true },
    }),
    prisma.rentedMillFundTransaction.aggregate({
      where: {
        date: { lt: dayStart },
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
        date: { lt: dayStart },
        status: "APPROVED",
        medium: "CASH",
        OR: [
          { partyType: "BANK", transactionType: "DEPOSIT" },
          { partyType: { in: ["OWNER_1", "OWNER_2"] }, transactionType: "WITHDRAW" },
        ],
      },
      _sum: { amount: true },
    }),
    // Current day data
    prisma.rentedMillExpense.findMany({
      where: { date: { gte: dayStart, lte: dayEnd }, status: "APPROVED" },
      orderBy: { createdAt: "asc" },
    }),
    prisma.rentedMillBill.findMany({
      where: { date: { gte: dayStart, lte: dayEnd }, status: "APPROVED" },
      include: { party: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.rentedMillPayment.findMany({
      where: { date: { gte: dayStart, lte: dayEnd }, status: "APPROVED" },
      include: { party: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.rentedMillByproductSale.findMany({
      where: { date: { gte: dayStart, lte: dayEnd }, status: "APPROVED" },
      orderBy: { createdAt: "asc" },
    }),
    prisma.rentedMillFundTransaction.findMany({
      where: {
        date: { gte: dayStart, lte: dayEnd },
        status: "APPROVED",
        medium: "CASH",
      },
      include: { bankAccount: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.rentedMillBankAccount.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.rentedMillParty.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const priorFundIn = priorFundCashIn._sum.amount || 0;
  const priorFundOut = priorFundCashOut._sum.amount || 0;
  const priorCashIn =
    (priorBills._sum.paidAmount || 0) +
    (priorPayments._sum.amount || 0) +
    (priorSales._sum.paidAmount || 0) +
    priorFundIn;
  const priorCashOut = (priorExpenses._sum.amount || 0) + priorFundOut;
  const openingBalance = Math.max(0, priorCashIn - priorCashOut);

  // Inflows & Outflows for today from fund transactions
  const fundCashOutflows = todayFundTxs.filter(
    (tx) =>
      (tx.partyType === "BANK" && tx.transactionType === "DEPOSIT") ||
      ((tx.partyType === "OWNER_1" || tx.partyType === "OWNER_2") && tx.transactionType === "WITHDRAW")
  );

  const fundCashInflows = todayFundTxs.filter(
    (tx) =>
      (tx.partyType === "BANK" && tx.transactionType === "WITHDRAW") ||
      ((tx.partyType === "OWNER_1" || tx.partyType === "OWNER_2") && tx.transactionType === "DEPOSIT")
  );

  // Combined Left Table Entries (খরচ ও নগদ ক্যাশ প্রদান)
  interface ExpenseRowItem {
    id: string;
    isFund: boolean;
    category: string;
    description?: string | null;
    paidTo?: string | null;
    amount: number;
    rawExpense?: any;
    rawFund?: any;
  }

  const expenseRows: ExpenseRowItem[] = [
    ...todayExpenses.map((exp) => ({
      id: exp.id,
      isFund: false,
      category: exp.category,
      description: exp.description,
      paidTo: exp.paidTo,
      amount: exp.amount,
      rawExpense: exp,
    })),
    ...fundCashOutflows.map((tx) => {
      let category = "";
      let description = "";
      if (tx.partyType === "BANK") {
        category = "ব্যাংকে নগদ জমা";
        description = tx.bankAccount
          ? `${tx.bankAccount.bankName} (${tx.bankAccount.accountNumber})`
          : "ব্যাংক হিসাব";
      } else {
        const pName =
          tx.partnerName ||
          (tx.partyType === "OWNER_1"
            ? (settings.partner1Name || "নাহিদ হাসান")
            : (settings.partner2Name || "পার্টনার"));
        category = `মালিকের টাকা উত্তোলন (${pName})`;
        description = "মালিকের ব্যক্তিগত উত্তোলন";
      }
      return {
        id: tx.id,
        isFund: true,
        category,
        description,
        paidTo: tx.reference || null,
        amount: tx.amount,
        rawFund: tx,
      };
    }),
  ];

  const totalDayExpenses = expenseRows.reduce((s, x) => s + x.amount, 0);

  // Inflows on today
  const billCashIn = todayBills.reduce((s, b) => s + b.paidAmount, 0);
  const paymentCashIn = todayPayments.reduce((s, p) => s + p.amount, 0);
  const byproductCashIn = todaySales.reduce((s, sld) => s + sld.paidAmount, 0);

  // Right table entries (জমা ও ক্যাশ হিসাব - প্রতিটি এন্ট্রি পার্টির নামসহ আলাদা সারি)
  interface DepositRowItem {
    id: string;
    type: "OPENING" | "PAYMENT" | "BILL" | "SALE" | "FUND";
    label: string;
    subDetails?: string;
    amount: number;
    rawPayment?: any;
    rawBill?: any;
    rawSale?: any;
    rawFund?: any;
  }

  const depositRows: DepositRowItem[] = [
    {
      id: "opening",
      type: "OPENING",
      label: "পূর্বের জমা (পূর্ববর্তী অবশিষ্ট ক্যাশ)",
      subDetails: "গতকাল পর্যন্ত চলমান অবশিষ্ট ক্যাশ স্থিতি",
      amount: openingBalance,
    },
  ];

  // ১. পার্টির বকেয়া / বিল আদায় (প্রতিটি এন্ট্রি পার্টির নামসহ আলাদা সারি)
  todayPayments.forEach((p) => {
    if (p.amount > 0) {
      const partyName = p.party?.name || "অনির্দিষ্ট পার্টি";
      const details: string[] = [];
      if (p.receiptNo) details.push(`রশিদ: ${p.receiptNo}`);
      if (p.paymentMethod && p.paymentMethod !== "নগদ") details.push(p.paymentMethod);
      if (p.notes) details.push(p.notes);

      depositRows.push({
        id: p.id,
        type: "PAYMENT",
        label: `পার্টির বকেয়া আদায় — ${partyName}`,
        subDetails: details.length > 0 ? details.join(" · ") : undefined,
        amount: p.amount,
        rawPayment: p,
      });
    }
  });

  // ২. ধান ছাটাই বিল নগদ আদায় (বিলকালীন নগদ টাকা নেওয়া হলে)
  todayBills.forEach((b) => {
    if (b.paidAmount > 0) {
      const partyName = b.party?.name || "অনির্দিষ্ট পার্টি";
      const details: string[] = [];
      if (b.billNo) details.push(`বিল নং: ${b.billNo}`);
      if (b.notes) details.push(b.notes);

      depositRows.push({
        id: b.id,
        type: "BILL",
        label: `ধান ছাটাই বিল নগদ আদায় — ${partyName}`,
        subDetails: details.length > 0 ? details.join(" · ") : undefined,
        amount: b.paidAmount,
        rawBill: b,
      });
    }
  });

  // ৩. ভুষি ও কুঁড়া বিক্রয় জমা (ক্রেতার নামসহ আলাদা সারি)
  todaySales.forEach((sld) => {
    if (sld.paidAmount > 0) {
      const customerName = sld.customerName || "খুচরা ক্রেতা";
      const details: string[] = [];
      if (sld.invoiceNo) details.push(`চালান: ${sld.invoiceNo}`);
      if (sld.productType) details.push(`${sld.productType} (${toBn(sld.quantity)} ${sld.unit})`);
      if (sld.notes) details.push(sld.notes);

      depositRows.push({
        id: sld.id,
        type: "SALE",
        label: `ভুষি ও কুঁড়া বিক্রয় — ${customerName}`,
        subDetails: details.length > 0 ? details.join(" · ") : undefined,
        amount: sld.paidAmount,
        rawSale: sld,
      });
    }
  });

  // ৪. ব্যাংক থেকে নগদ উত্তোলন ও মালিকদের ক্যাশ জমা
  fundCashInflows.forEach((tx) => {
    let label = "";
    let subDetails: string | undefined = undefined;

    if (tx.partyType === "BANK") {
      const bName = tx.bankAccount ? `${tx.bankAccount.bankName} (${tx.bankAccount.accountNumber})` : "ব্যাংক";
      label = `ব্যাংক থেকে নগদ উত্তোলন — ${bName}`;
      subDetails = tx.reference ? `চেক/রেফা: ${tx.reference}` : undefined;
    } else {
      const pName =
        tx.partnerName ||
        (tx.partyType === "OWNER_1"
          ? (settings.partner1Name || "নাহিদ হাসান")
          : (settings.partner2Name || "পার্টনার"));
      label = `মালিকের টাকা জমা — ${pName}`;
      subDetails = tx.reference ? `রেফারেন্স: ${tx.reference}` : undefined;
    }

    depositRows.push({
      id: tx.id,
      type: "FUND",
      label,
      subDetails,
      amount: tx.amount,
      rawFund: tx,
    });
  });

  const totalDayDeposits = depositRows.reduce((s, r) => s + r.amount, 0);
  const closingCashBalance = totalDayDeposits - totalDayExpenses;

  return (
    <div className="space-y-6">
      {shouldAutoPrint && <AutoPrint />}
      <RentedMillTabs role={role} />

      {/* Screen Controls & Date Selector */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-rule pb-4 no-print">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink-900">
            দৈনিক জমা খরচ রিপোর্ট
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500">
            {settings.millName}, {settings.millAddress} · তারিখ: <b>{getBengaliDateLabel(dayStart)}</b>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form method="GET" className="flex items-center gap-1.5">
            <input
              type="date"
              name="date"
              defaultValue={selectedDateStr}
              className="rounded-lg border border-rule bg-white px-3 py-1.5 text-xs text-ink-900"
            />
            <button type="submit" className="btn-outline text-xs">
              তারিখ পরিবর্তন
            </button>
          </form>
          <PrintButton label="A4 প্রিন্ট করুন" />
        </div>
      </div>

      {/* Printable Report Header */}
      <ReportPrintHeader
        millName={settings.millName}
        millAddress={settings.millAddress}
        title="দৈনিক জমা খরচ রিপোর্ট"
        subTitle={`হিসাবের তারিখ: ${getBengaliDateLabel(dayStart)}`}
      />

      {/* Side-by-side Dual Table (Left: Expenses, Right: Deposits & Cash summary) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-2 print:gap-4 print:text-black">
        {/* বাম পাশের টেবিল (খরচের অংশ) */}
        <div className="rounded-xl border border-rule bg-white shadow-2xs overflow-hidden print:border-black print:rounded-none">
          <div className="border-b border-rule bg-slate-100/80 px-3 py-2 text-center print:bg-slate-200 print:border-black">
            <h2 className="text-sm font-bold text-ink-900 print:text-black">
              খরচের অংশ (খরচ বিবরণী)
            </h2>
          </div>
          <table className="w-full text-left text-xs print:text-xs">
            <thead>
              <tr className="border-b border-rule bg-slate-50 text-slate-700 print:border-black print:bg-slate-100 font-bold">
                <th className="py-2 px-2.5 w-12 text-center">ক্র. নং</th>
                <th className="py-2 px-2.5">বিবরণ / খরচের খাত</th>
                <th className="py-2 px-2.5 text-right w-28">খরচ টাকা</th>
                {role !== "PARTNER" && (
                  <th className="py-2 px-1 text-center w-12 no-print">একশন</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 print:divide-black">
              {expenseRows.length === 0 ? (
                <tr>
                  <td colSpan={role !== "PARTNER" ? 4 : 3} className="py-8 text-center text-slate-400 print:text-slate-600">
                    আজ কোনো খরচের এন্ট্রি নেই
                  </td>
                </tr>
              ) : (
                expenseRows.map((row, idx) => (
                  <tr key={row.id} className="hover:bg-slate-50/60">
                    <td className="py-2 px-2.5 text-center font-medium text-slate-500">
                      {toBn(idx + 1)}
                    </td>
                    <td className="py-2.5 px-2.5 font-medium text-ink-900 print:text-black">
                      <span className="font-bold">{row.category}</span>
                      {row.description && ` - ${row.description}`}
                      {row.paidTo && <span className="text-[11px] text-slate-500 block">বিবরণ/রেফারেন্স: {row.paidTo}</span>}
                    </td>
                    <td className="py-2 px-2.5 text-right font-bold text-red-700 print:text-black">
                      {formatBnCurrency(row.amount)}
                    </td>
                    {role !== "PARTNER" && (
                      <td className="py-2 px-1 text-center no-print">
                        {row.isFund && row.rawFund ? (
                          <FundTransactionRowActions
                            transaction={row.rawFund as any}
                            bankAccounts={bankAccounts as any}
                            role={role}
                            compact={true}
                          />
                        ) : (
                          <ExpenseRowActions expense={row.rawExpense} role={role} compact={true} />
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-rule bg-slate-100 font-bold text-xs print:border-black print:bg-slate-200">
                <td colSpan={2} className="py-2.5 px-3 text-right">
                  মোট খরচ:
                </td>
                <td className="py-2.5 px-3 text-right text-red-700 print:text-black font-extrabold text-sm">
                  {formatBnCurrency(totalDayExpenses)}
                </td>
                {role !== "PARTNER" && <td className="no-print"></td>}
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ডান পাশের টেবিল (জমা ও ক্যাশ হিসাবের অংশ) */}
        <div className="rounded-xl border border-rule bg-white shadow-2xs overflow-hidden print:border-black print:rounded-none">
          <div className="border-b border-rule bg-slate-100/80 px-3 py-2 text-center print:bg-slate-200 print:border-black">
            <h2 className="text-sm font-bold text-ink-900 print:text-black">
              জমা ও ক্যাশ হিসাবের অংশ
            </h2>
          </div>
          <table className="w-full text-left text-xs print:text-xs">
            <thead>
              <tr className="border-b border-rule bg-slate-50 text-slate-700 print:border-black print:bg-slate-100 font-bold">
                <th className="py-2 px-2.5 w-12 text-center">ক্র. নং</th>
                <th className="py-2 px-2.5">জমার বিবরণ</th>
                <th className="py-2 px-2.5 text-right w-28">জমা টাকা</th>
                {role !== "PARTNER" && (
                  <th className="py-2 px-1 text-center w-12 no-print">একশন</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 print:divide-black">
              {depositRows.map((row, idx) => (
                <tr key={`${row.type}-${row.id}`} className="hover:bg-slate-50/60">
                  <td className="py-2 px-2.5 text-center font-medium text-slate-500">
                    {row.type === "OPENING" ? "—" : toBn(idx)}
                  </td>
                  <td className="py-2.5 px-2.5 font-medium text-ink-900 print:text-black">
                    <span className="font-bold">{row.label}</span>
                    {row.subDetails && (
                      <span className="text-[11px] text-slate-500 print:text-slate-700 block">
                        {row.subDetails}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-2.5 text-right font-bold text-emerald-700 print:text-black">
                    {formatBnCurrency(row.amount)}
                  </td>
                  {role !== "PARTNER" && (
                    <td className="py-2 px-1 text-center no-print">
                      {row.type === "PAYMENT" && row.rawPayment ? (
                        <PaymentRowActions
                          payment={row.rawPayment}
                          parties={parties}
                          role={role}
                          compact={true}
                        />
                      ) : row.type === "BILL" && row.rawBill ? (
                        <MillingBillRowActions
                          bill={row.rawBill}
                          parties={parties}
                          role={role}
                          compact={true}
                        />
                      ) : row.type === "SALE" && row.rawSale ? (
                        <ByproductSaleRowActions
                          sale={row.rawSale}
                          role={role}
                          compact={true}
                        />
                      ) : row.type === "FUND" && row.rawFund ? (
                        <FundTransactionRowActions
                          transaction={row.rawFund as any}
                          bankAccounts={bankAccounts as any}
                          role={role}
                          compact={true}
                        />
                      ) : (
                        <span className="text-[10px] text-slate-300">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              {/* মোট জমা */}
              <tr className="border-t-2 border-rule bg-slate-50 font-bold text-xs print:border-black print:bg-slate-100">
                <td colSpan={2} className="py-2.5 px-3 text-right">
                  মোট জমা:
                </td>
                <td className="py-2.5 px-3 text-right text-emerald-800 print:text-black font-bold">
                  {formatBnCurrency(totalDayDeposits)}
                </td>
                {role !== "PARTNER" && <td className="no-print"></td>}
              </tr>
              {/* মোট খরচ */}
              <tr className="border-t border-slate-200 bg-slate-50 font-bold text-xs print:border-black print:bg-slate-100">
                <td colSpan={2} className="py-2.5 px-3 text-right text-red-700 print:text-black">
                  মোট খরচ (বাদ):
                </td>
                <td className="py-2.5 px-3 text-right text-red-700 print:text-black font-bold">
                  {formatBnCurrency(totalDayExpenses)}
                </td>
                {role !== "PARTNER" && <td className="no-print"></td>}
              </tr>
              {/* আজকের অবশিষ্ট ক্যাশ */}
              <tr className="border-t-2 border-rule bg-emerald-50/80 font-bold text-xs print:border-black print:bg-slate-200">
                <td colSpan={2} className="py-2.5 px-3 text-right text-emerald-950 print:text-black text-sm">
                  আজকের অবশিষ্ট ক্যাশ:
                </td>
                <td className="py-2.5 px-3 text-right text-emerald-800 print:text-black font-extrabold text-base">
                  {formatBnCurrency(closingCashBalance)}
                </td>
                {role !== "PARTNER" && <td className="no-print"></td>}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Print Signatures */}
      <div className="hidden print:grid grid-cols-2 gap-12 pt-16 text-center text-xs text-black">
        <div>
          <div className="border-t border-black pt-1 font-semibold">
            হিসাবরক্ষকের স্বাক্ষর
          </div>
        </div>
        <div>
          <div className="border-t border-black pt-1 font-semibold">
            মালিক / ম্যানেজারের স্বাক্ষর
          </div>
        </div>
      </div>
    </div>
  );
}
