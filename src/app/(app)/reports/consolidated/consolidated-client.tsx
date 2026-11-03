"use client";

import React, { useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/format";
import type {
  ConsolidatedFinancialsResult,
  ConsolidatedStatementLine,
} from "@/server/services/consolidatedFinancials";

interface Props {
  report: ConsolidatedFinancialsResult;
  currency: string;
  asOfDateStr: string;
  fromDateStr: string;
  toDateStr: string;
  book: string;
}

export function ConsolidatedReportClient({
  report,
  currency,
  asOfDateStr,
  fromDateStr,
  toDateStr,
  book,
}: Props) {
  const [activeTab, setActiveTab] = useState<"BS" | "PL" | "TB" | "ELIM">("BS");

  const money = (val: number | null | undefined) => {
    if (val === null || val === undefined || isNaN(val)) return "-";
    if (Math.abs(val) < 0.005) return "0.00";
    return formatMoney(val, currency);
  };

  const excelExportUrl = `/api/reports/consolidated/excel?asOf=${asOfDateStr}&from=${fromDateStr}&to=${toDateStr}&book=${book}`;

  const groupName = report.group?.name || "এন্টারপ্রাইজ সম্মিলিত গ্রুপ";
  const entities = report.entities;

  // Elimination totals
  const totalSalesEliminated = report.eliminations
    .filter((e) => e.type === "SALES_PURCHASE")
    .reduce((sum, e) => sum + e.amount, 0);

  const totalContraEliminated = report.eliminations
    .filter((e) => e.type === "RECEIVABLE_PAYABLE")
    .reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="space-y-6">
      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 no-print">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            গ্রুপের নাম ও প্রতিষ্ঠান
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-lg font-bold text-ink-900">{groupName}</span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
              {entities.length} টি কনসার্ন
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {report.group?.code ? `কোড: ${report.group.code}` : "প্যারেন্ট-সাবসিডিয়ারি কনসোলিডেশন"}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            ব্যালেন্স শিট সমতা
          </div>
          <div className="mt-2 flex items-center gap-2">
            {report.balanceSheet.isBalanced ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                <span className="h-2 w-2 rounded-full bg-emerald-600"></span>
                সম্পদ = দায় + মূলধন (Balanced)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                <span className="h-2 w-2 rounded-full bg-amber-600"></span>
                অমিল রয়েছে (Unbalanced)
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            মোট সম্পদ: {money(report.balanceSheet.totalAssets.consolidated)}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            ইন্টার-কোম্পানি সেলস এলিমিনেশন
          </div>
          <div className="mt-2 text-xl font-bold text-rose-600">
            {money(totalSalesEliminated)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            অভ্যন্তরীণ কেনাবেচার দ্বৈত গণনা মুক্ত
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            পারস্পরিক কন্ট্রা দেনা-পাওনা সমন্বয়
          </div>
          <div className="mt-2 text-xl font-bold text-indigo-600">
            {money(totalContraEliminated)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            গ্রুপের অভ্যন্তরীণ বাকি সমন্বয়
          </p>
        </div>
      </div>

      {/* ── Filter Bar & Actions ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card shadow-sm no-print">
        <form method="get" action="/reports/consolidated" className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="asOf" className="block text-xs font-semibold text-muted-foreground mb-1">
              হিসাবের তারিখ (As of Date)
            </label>
            <input
              type="date"
              id="asOf"
              name="asOf"
              defaultValue={asOfDateStr}
              className="input input-sm border border-border rounded-lg px-2.5 py-1 text-sm bg-background"
            />
          </div>

          <div>
            <label htmlFor="from" className="block text-xs font-semibold text-muted-foreground mb-1">
              শুরুর তারিখ (P&L From)
            </label>
            <input
              type="date"
              id="from"
              name="from"
              defaultValue={fromDateStr}
              className="input input-sm border border-border rounded-lg px-2.5 py-1 text-sm bg-background"
            />
          </div>

          <div>
            <label htmlFor="to" className="block text-xs font-semibold text-muted-foreground mb-1">
              শেষের তারিখ (P&L To)
            </label>
            <input
              type="date"
              id="to"
              name="to"
              defaultValue={toDateStr}
              className="input input-sm border border-border rounded-lg px-2.5 py-1 text-sm bg-background"
            />
          </div>

          <button
            type="submit"
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm"
          >
            ফিল্টার প্রয়োগ করুন
          </button>
        </form>

        <div className="flex items-center gap-2">
          <a
            href={excelExportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm"
          >
            <span>📊</span>
            Excel (.xlsx) ডাউনলোড
          </a>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-border bg-background hover:bg-muted transition text-ink-900 shadow-sm"
          >
            <span>🖨️</span>
            প্রিন্ট / PDF ভিউ
          </button>
        </div>
      </div>

      {/* ── Statement Tabs ── */}
      <div className="border-b border-border no-print">
        <nav className="flex space-x-6">
          <button
            onClick={() => setActiveTab("BS")}
            className={`pb-3 text-sm font-semibold border-b-2 transition ${
              activeTab === "BS"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            ব্যালেন্স শীট (Consolidated Balance Sheet)
          </button>
          <button
            onClick={() => setActiveTab("PL")}
            className={`pb-3 text-sm font-semibold border-b-2 transition ${
              activeTab === "PL"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            লাভ-ক্ষতি বিবরণী (Consolidated P&L)
          </button>
          <button
            onClick={() => setActiveTab("TB")}
            className={`pb-3 text-sm font-semibold border-b-2 transition ${
              activeTab === "TB"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            ট্রায়াল ব্যালেন্স (Consolidated Trial Balance)
          </button>
          <button
            onClick={() => setActiveTab("ELIM")}
            className={`pb-3 text-sm font-semibold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === "ELIM"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>এলিমিনেশন অডিট লগ (Eliminations)</span>
            <span className="px-1.5 py-0.5 text-xs rounded-full bg-muted font-bold">
              {report.eliminations.length}
            </span>
          </button>
        </nav>
      </div>

      {/* ── Printable Header ── */}
      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-bold text-center text-ink-900">{groupName}</h1>
        <h2 className="text-lg font-semibold text-center text-slate-700">
          {activeTab === "BS" && "সম্মিলিত ব্যালেন্স শীট (Consolidated Balance Sheet)"}
          {activeTab === "PL" && "সম্মিলিত লাভ-ক্ষতি বিবরণী (Consolidated Profit & Loss)"}
          {activeTab === "TB" && "সম্মিলিত রেওয়ামিল (Consolidated Trial Balance)"}
          {activeTab === "ELIM" && "ইন্টার-কোম্পানি এলিমিনেশন অডিট রিপোর্ট"}
        </h2>
        <p className="text-xs text-center text-slate-500 mt-1">
          হিসাবের তারিখ: {asOfDateStr} | মুদ্রা: {currency} | প্রতিষ্ঠান সংখ্যা: {entities.length}
        </p>
      </div>

      {/* ── Tab 1: Balance Sheet ── */}
      {activeTab === "BS" && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-muted/70 border-b border-border text-xs font-semibold text-muted-foreground uppercase">
                <th className="py-3 px-4 min-w-[220px]">লেজার খাত (Group COA)</th>
                {entities.map((e) => (
                  <th key={e.id} className="py-3 px-3 text-right min-w-[120px]">
                    {e.name}
                    {e.intercompanyCode && (
                      <span className="block text-[10px] text-muted-foreground font-normal">
                        [{e.intercompanyCode}]
                      </span>
                    )}
                  </th>
                ))}
                <th className="py-3 px-3 text-right bg-muted/90 min-w-[120px] font-bold">
                  সমষ্টি (Raw Total)
                </th>
                <th className="py-3 px-3 text-right text-rose-600 min-w-[110px]">
                  এলিমিনেশন Dr
                </th>
                <th className="py-3 px-3 text-right text-emerald-600 min-w-[110px]">
                  এলিমিনেশন Cr
                </th>
                <th className="py-3 px-4 text-right bg-primary/10 text-primary min-w-[130px] font-bold">
                  কনসোলিডেটেড মোট
                </th>
                <th className="py-3 px-3 min-w-[150px] text-xs font-normal">
                  সমন্বয় বিবরণ
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {/* ASSETS */}
              <tr className="bg-blue-50/50">
                <td
                  colSpan={entities.length + 6}
                  className="py-2.5 px-4 font-bold text-blue-900 text-sm tracking-wide"
                >
                  ১. সম্পদসমূহ (ASSETS)
                </td>
              </tr>
              {report.balanceSheet.assets.map((line) => (
                <RenderRow key={line.category} line={line} entities={entities} money={money} />
              ))}
              <RenderSubtotal
                title="সর্বমোট সম্পদ (Total Assets)"
                subtotal={report.balanceSheet.totalAssets}
                entities={entities}
                money={money}
                className="bg-blue-50 font-bold text-blue-950"
              />

              {/* LIABILITIES */}
              <tr className="bg-amber-50/50">
                <td
                  colSpan={entities.length + 6}
                  className="py-2.5 px-4 font-bold text-amber-900 text-sm tracking-wide"
                >
                  ২. দায়সমূহ (LIABILITIES)
                </td>
              </tr>
              {report.balanceSheet.liabilities.map((line) => (
                <RenderRow key={line.category} line={line} entities={entities} money={money} />
              ))}
              <RenderSubtotal
                title="সর্বমোট দায় (Total Liabilities)"
                subtotal={report.balanceSheet.totalLiabilities}
                entities={entities}
                money={money}
                className="bg-amber-50/50 font-semibold"
              />

              {/* EQUITY */}
              <tr className="bg-emerald-50/50">
                <td
                  colSpan={entities.length + 6}
                  className="py-2.5 px-4 font-bold text-emerald-900 text-sm tracking-wide"
                >
                  ৩. মালিকানাস্বত্ব (EQUITY)
                </td>
              </tr>
              {report.balanceSheet.equity.map((line) => (
                <RenderRow key={line.category} line={line} entities={entities} money={money} />
              ))}
              <RenderSubtotal
                title="সর্বমোট মূলধন ও পুঞ্জীভূত মুনাফা (Total Equity)"
                subtotal={report.balanceSheet.totalEquity}
                entities={entities}
                money={money}
                className="bg-emerald-50/50 font-semibold"
              />

              {/* TOTAL LIABILITIES & EQUITY */}
              <RenderSubtotal
                title="মোট দায় ও মূলধন (Total Liabilities & Equity)"
                subtotal={report.balanceSheet.totalLiabilitiesAndEquity}
                entities={entities}
                money={money}
                className="bg-primary/20 font-bold text-primary-950 text-base border-t-2 border-primary"
              />
            </tbody>
          </table>
        </div>
      )}

      {/* ── Tab 2: Profit & Loss ── */}
      {activeTab === "PL" && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-muted/70 border-b border-border text-xs font-semibold text-muted-foreground uppercase">
                <th className="py-3 px-4 min-w-[220px]">লেজার খাত (Group COA)</th>
                {entities.map((e) => (
                  <th key={e.id} className="py-3 px-3 text-right min-w-[120px]">
                    {e.name}
                    {e.intercompanyCode && (
                      <span className="block text-[10px] text-muted-foreground font-normal">
                        [{e.intercompanyCode}]
                      </span>
                    )}
                  </th>
                ))}
                <th className="py-3 px-3 text-right bg-muted/90 min-w-[120px] font-bold">
                  সমষ্টি (Raw Total)
                </th>
                <th className="py-3 px-3 text-right text-rose-600 min-w-[110px]">
                  এলিমিনেশন Dr
                </th>
                <th className="py-3 px-3 text-right text-emerald-600 min-w-[110px]">
                  এলিমিনেশন Cr
                </th>
                <th className="py-3 px-4 text-right bg-primary/10 text-primary min-w-[130px] font-bold">
                  কনসোলিডেটেড মোট
                </th>
                <th className="py-3 px-3 min-w-[150px] text-xs font-normal">
                  সমন্বয় বিবরণ
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {/* REVENUE */}
              <tr className="bg-emerald-50/50">
                <td
                  colSpan={entities.length + 6}
                  className="py-2.5 px-4 font-bold text-emerald-900 text-sm tracking-wide"
                >
                  ১. রাজস্ব ও পরিচালন আয় (Revenue)
                </td>
              </tr>
              {report.profitAndLoss.revenueLines.map((line) => (
                <RenderRow key={line.category} line={line} entities={entities} money={money} />
              ))}
              <RenderSubtotal
                title="মোট রাজস্ব (Net Sales Revenue)"
                subtotal={report.profitAndLoss.netSales}
                entities={entities}
                money={money}
                className="bg-emerald-50/50 font-semibold"
              />

              {/* COGS */}
              <tr className="bg-amber-50/50">
                <td
                  colSpan={entities.length + 6}
                  className="py-2.5 px-4 font-bold text-amber-900 text-sm tracking-wide"
                >
                  ২. সরাসরি ব্যয় ও পণ্য ক্রয় (Cost of Goods Sold)
                </td>
              </tr>
              {report.profitAndLoss.cogsLines.map((line) => (
                <RenderRow key={line.category} line={line} entities={entities} money={money} />
              ))}
              <RenderSubtotal
                title="বিক্রীত পণ্যের মোট ব্যয় (Total Cost of Sales)"
                subtotal={report.profitAndLoss.costOfSales}
                entities={entities}
                money={money}
                className="bg-amber-50/50 font-semibold"
              />

              {/* GROSS PROFIT */}
              <RenderSubtotal
                title="মোট লাভ (Gross Profit)"
                subtotal={report.profitAndLoss.grossProfit}
                entities={entities}
                money={money}
                className="bg-blue-100 font-bold text-blue-950 text-base"
              />

              {/* OPEX */}
              <tr className="bg-slate-50">
                <td
                  colSpan={entities.length + 6}
                  className="py-2.5 px-4 font-bold text-slate-900 text-sm tracking-wide"
                >
                  ৩. পরিচালন ও প্রশাসনিক ব্যয় (Operating Expenses)
                </td>
              </tr>
              {report.profitAndLoss.opexLines.map((line) => (
                <RenderRow key={line.category} line={line} entities={entities} money={money} />
              ))}
              <RenderSubtotal
                title="মোট পরিচালন ব্যয় (Total Operating Expenses)"
                subtotal={report.profitAndLoss.operatingExpenses}
                entities={entities}
                money={money}
                className="bg-slate-100 font-semibold"
              />

              {/* OTHER INCOME */}
              {report.profitAndLoss.otherIncomeLines.length > 0 && (
                <>
                  <tr className="bg-slate-50">
                    <td
                      colSpan={entities.length + 6}
                      className="py-2.5 px-4 font-bold text-slate-900 text-sm tracking-wide"
                    >
                      ৪. অন্যান্য বিবিধ আয় (Other Income)
                    </td>
                  </tr>
                  {report.profitAndLoss.otherIncomeLines.map((line) => (
                    <RenderRow key={line.category} line={line} entities={entities} money={money} />
                  ))}
                </>
              )}

              {/* NET PROFIT */}
              <RenderSubtotal
                title="নিট মুনাফা / (ক্ষতি) (Consolidated Net Profit)"
                subtotal={report.profitAndLoss.netProfit}
                entities={entities}
                money={money}
                className="bg-emerald-100 font-bold text-emerald-950 text-base border-t-2 border-emerald-600"
              />
            </tbody>
          </table>
        </div>
      )}

      {/* ── Tab 3: Trial Balance ── */}
      {activeTab === "TB" && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-muted/70 border-b border-border text-xs font-semibold text-muted-foreground uppercase">
                <th className="py-3 px-4 min-w-[220px]">লেজার খাত (Group COA)</th>
                {entities.map((e) => (
                  <th key={e.id} className="py-3 px-3 text-right min-w-[120px]">
                    {e.name}
                  </th>
                ))}
                <th className="py-3 px-3 text-right bg-muted/90 min-w-[120px] font-bold">
                  সমষ্টি (Raw Total)
                </th>
                <th className="py-3 px-3 text-right text-rose-600 min-w-[110px]">
                  এলিমিনেশন Dr
                </th>
                <th className="py-3 px-3 text-right text-emerald-600 min-w-[110px]">
                  এলিমিনেশন Cr
                </th>
                <th className="py-3 px-4 text-right bg-primary/10 text-primary min-w-[130px] font-bold">
                  কনসোলিডেটেড মোট
                </th>
                <th className="py-3 px-3 min-w-[120px] text-xs font-normal">প্রকৃতি</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.trialBalance.lines.map((line) => (
                <tr key={line.category} className="hover:bg-muted/50 transition">
                  <td className="py-2.5 px-4 font-medium text-ink-900">{line.name}</td>
                  {entities.map((e) => (
                    <td key={e.id} className="py-2.5 px-3 text-right font-mono text-xs">
                      {money(line.entityBalances[e.id])}
                    </td>
                  ))}
                  <td className="py-2.5 px-3 text-right font-mono text-xs font-semibold bg-muted/40">
                    {money(line.rawTotal)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs text-rose-600">
                    {line.eliminationDr ? money(line.eliminationDr) : "-"}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs text-emerald-600">
                    {line.eliminationCr ? money(line.eliminationCr) : "-"}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs font-bold bg-primary/5 text-primary">
                    {money(line.consolidatedTotal)}
                  </td>
                  <td className="py-2.5 px-3 text-xs text-muted-foreground">{line.nature}</td>
                </tr>
              ))}

              <RenderSubtotal
                title="সর্বমোট ডেবিট (Total Debit)"
                subtotal={report.trialBalance.totalDebit}
                entities={entities}
                money={money}
                className="bg-blue-50 font-bold"
              />
              <RenderSubtotal
                title="সর্বমোট ক্রেডিট (Total Credit)"
                subtotal={report.trialBalance.totalCredit}
                entities={entities}
                money={money}
                className="bg-amber-50 font-bold"
              />
            </tbody>
          </table>
        </div>
      )}

      {/* ── Tab 4: Eliminations Audit ── */}
      {activeTab === "ELIM" && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <div className="p-4 border-b border-border bg-muted/30">
            <h3 className="text-base font-bold text-ink-900">
              ইন্টার-কোম্পানি লেনদেন এলিমিনেশন অডিট ট্রেইল
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              আন্তর্জাতিক অ্যাকাউন্টিং মানদণ্ড (IFRS 10 / IAS 27) অনুযায়ী সকল সিস্টার কনসার্নের মধ্যকার অভ্যন্তরীণ বিক্রি-ক্রয় ও পারস্পরিক বাকি হিসাবের সমন্বয় বিবরণী।
            </p>
          </div>

          {report.eliminations.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              নির্বাচিত সময়ে কোনো ইন্টার-কোম্পানি লেনদেন সমন্বয়ের প্রয়োজন হয়নি।
            </div>
          ) : (
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-muted/70 border-b border-border text-xs font-semibold text-muted-foreground uppercase">
                  <th className="py-3 px-4">ধরন (Elimination Type)</th>
                  <th className="py-3 px-4">পক্ষ ১ (বিক্রেতা / পাওনাদার)</th>
                  <th className="py-3 px-4">পক্ষ ২ (ক্রেতা / দেনাদার)</th>
                  <th className="py-3 px-4 text-right">পরিমাণ (Amount)</th>
                  <th className="py-3 px-4">ডেবিট হিসাব খাত</th>
                  <th className="py-3 px-4">ক্রেডিট হিসাব খাত</th>
                  <th className="py-3 px-4">সমন্বয়ের বিবরণ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.eliminations.map((el, idx) => (
                  <tr key={idx} className="hover:bg-muted/40 transition">
                    <td className="py-3 px-4">
                      {el.type === "SALES_PURCHASE" ? (
                        <span className="inline-flex px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800">
                          বিক্রয়-ক্রয় এলিমিনেশন
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded text-xs font-semibold bg-indigo-100 text-indigo-800">
                          দেনা-পাওনা কন্ট্রা সমন্বয়
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-medium text-ink-900">
                      {el.sellerOrCreditor.name}
                    </td>
                    <td className="py-3 px-4 font-medium text-ink-900">
                      {el.buyerOrDebtor.name}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-ink-900">
                      {money(el.amount)}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-rose-600 bg-rose-50/30">
                      {el.drAccount}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-emerald-600 bg-emerald-50/30">
                      {el.crAccount}
                    </td>
                    <td className="py-3 px-4 text-xs text-muted-foreground">{el.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function RenderRow({
  line,
  entities,
  money,
}: {
  line: ConsolidatedStatementLine;
  entities: { id: string }[];
  money: (val: number | null | undefined) => string;
}) {
  return (
    <tr className="hover:bg-muted/40 transition">
      <td className="py-2.5 px-4 font-medium text-ink-900">{line.name}</td>
      {entities.map((e) => (
        <td key={e.id} className="py-2.5 px-3 text-right font-mono text-xs">
          {money(line.entityBalances[e.id])}
        </td>
      ))}
      <td className="py-2.5 px-3 text-right font-mono text-xs font-semibold bg-muted/40">
        {money(line.rawTotal)}
      </td>
      <td className="py-2.5 px-3 text-right font-mono text-xs text-rose-600">
        {line.eliminationDr ? money(line.eliminationDr) : "-"}
      </td>
      <td className="py-2.5 px-3 text-right font-mono text-xs text-emerald-600">
        {line.eliminationCr ? money(line.eliminationCr) : "-"}
      </td>
      <td className="py-2.5 px-4 text-right font-mono text-xs font-bold bg-primary/5 text-primary">
        {money(line.consolidatedTotal)}
      </td>
      <td className="py-2.5 px-3 text-xs text-muted-foreground italic">
        {line.eliminationNote || ""}
      </td>
    </tr>
  );
}

function RenderSubtotal({
  title,
  subtotal,
  entities,
  money,
  className = "",
}: {
  title: string;
  subtotal: {
    entityValues: Record<string, number>;
    rawTotal: number;
    elimination: number;
    consolidated: number;
  };
  entities: { id: string }[];
  money: (val: number | null | undefined) => string;
  className?: string;
}) {
  return (
    <tr className={`border-t border-b border-border ${className}`}>
      <td className="py-3 px-4">{title}</td>
      {entities.map((e) => (
        <td key={e.id} className="py-3 px-3 text-right font-mono text-xs font-semibold">
          {money(subtotal.entityValues[e.id])}
        </td>
      ))}
      <td className="py-3 px-3 text-right font-mono text-xs font-bold bg-black/5">
        {money(subtotal.rawTotal)}
      </td>
      <td colSpan={2} className="py-3 px-3 text-center font-mono text-xs font-semibold text-muted-foreground">
        {subtotal.elimination !== 0 ? money(Math.abs(subtotal.elimination)) : "-"}
      </td>
      <td className="py-3 px-4 text-right font-mono text-xs font-bold bg-primary/10">
        {money(subtotal.consolidated)}
      </td>
      <td></td>
    </tr>
  );
}
