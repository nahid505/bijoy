import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireContext } from "@/server/auth";
import {
  getRentedMillSettings,
  resolveRentedMillRole,
} from "@/lib/rented-mill";
import { formatBnCurrency, getBengaliDateLabel, toBn } from "@/lib/format";
import {
  ReportPrintHeader,
  RentedMillTabs,
} from "../rented-mill-ui";
import { PartyLedgerClient, type PartyOption } from "./party-ledger-client";
import {
  ReceiptRowActions,
  DryerMillingRowActions,
  PaymentRowActions,
  MillingBillRowActions,
} from "../rented-mill-edit-modals";

export const metadata: Metadata = {
  title: "পার্টি খতিয়ান — শুভংকর অটো রাইস মিল, দিনাজপুর",
};

export default async function RentedMillPartyLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ partyId?: string }>;
}) {
  const { partyId: selectedPartyId } = await searchParams;
  const ctx = await requireContext();
  const settings = await getRentedMillSettings();
  const role = resolveRentedMillRole(ctx, settings);

  // Fetch all parties with their ledgers
  const allParties = await prisma.rentedMillParty.findMany({
    orderBy: { name: "asc" },
    include: {
      bills: { where: { status: "APPROVED" }, orderBy: { date: "asc" } },
      payments: { where: { status: "APPROVED" }, orderBy: { date: "asc" } },
      paddyReceipts: { where: { status: "APPROVED" }, orderBy: { date: "asc" } },
      dryerMillings: { where: { status: "APPROVED" }, orderBy: { date: "asc" } },
    },
  });

  // Calculate party metrics
  const partySummaries = allParties.map((p) => {
    const totalReceivedBags = p.paddyReceipts.reduce((acc, r) => acc + (r.bagsCount || 0), 0);
    const totalReceivedStd75 = p.paddyReceipts.reduce((acc, r) => acc + (r.standardBags75kg || 0), 0);
    const totalReceivedKg = p.paddyReceipts.reduce((acc, r) => acc + (r.netSklKg > 0 ? r.netSklKg : (r.sklWeight || 0)), 0);
    const totalMilledBags = p.dryerMillings.reduce((acc, d) => acc + (d.usedBags || 0), 0);
    const totalMilledKg = p.dryerMillings.reduce((acc, d) => {
      if (d.milledKg > 0) return acc + d.milledKg;
      return acc + d.usedBags * 75;
    }, 0);
    const currentStock = totalReceivedBags - totalMilledBags;
    const currentStockKg = Math.max(0, totalReceivedKg - totalMilledKg);

    const receiptBills = p.paddyReceipts.reduce((acc, r) => acc + (r.totalBillAmount || 0), 0);
    const manualBills = p.bills.reduce((acc, b) => acc + (b.totalAmount || 0), 0);
    const totalBilled = receiptBills + manualBills;

    const billPaid = p.bills.reduce((acc, b) => acc + (b.paidAmount || 0), 0);
    const paymentPaid = p.payments.reduce((acc, pay) => acc + (pay.amount || 0), 0);
    const totalPaid = billPaid + paymentPaid;
    const totalDue = Math.max(0, totalBilled - totalPaid);

    return {
      party: p,
      totalReceivedBags,
      totalReceivedStd75,
      totalReceivedKg,
      totalMilledBags,
      totalMilledKg,
      currentStock,
      currentStockKg,
      totalBilled,
      totalPaid,
      totalDue,
    };
  });

  const partyOptions: PartyOption[] = partySummaries.map((s) => ({
    id: s.party.id,
    name: s.party.name,
    phone: s.party.phone,
    address: s.party.address,
    isSelfParty: s.party.isSelfParty,
    currentStock: s.currentStock,
    totalDue: s.totalDue,
  }));

  const selectedData = selectedPartyId
    ? partySummaries.find((s) => s.party.id === selectedPartyId)
    : null;

  // If a party is selected, construct chronological timelines
  let stockTimeline: Array<{
    date: Date;
    type: "RECEIPT" | "MILLING";
    refNo: string;
    details: string;
    weightKg: number;
    inflowBags: number;
    outflowBags: number;
    inflowKg: number;
    outflowKg: number;
    balanceBags: number;
    balanceKg: number;
    notes: string | null;
    rawData: any;
  }> = [];

  let financialTimeline: Array<{
    date: Date;
    refNo: string;
    description: string;
    debit: number;
    credit: number;
    balanceDue: number;
    kind: "RECEIPT_BILL" | "MANUAL_BILL" | "BILL_CASH" | "PAYMENT";
    rawData: any;
  }> = [];

  if (selectedData) {
    const p = selectedData.party;

    // 1. Build Stock Timeline
    const rawStockEvents: Array<{
      date: Date;
      type: "RECEIPT" | "MILLING";
      refNo: string;
      details: string;
      weightKg: number;
      bags: number;
      notes: string | null;
      rawData: any;
    }> = [];

    p.paddyReceipts.forEach((r) => {
      const netKg = r.netSklKg > 0 ? r.netSklKg : r.sklWeight;
      const bagBreakdown =
        r.juteBags > 0 || r.plasticBags > 0
          ? `[চট: ${toBn(r.juteBags)}, প্লা: ${toBn(r.plasticBags)}]`
          : "";
      rawStockEvents.push({
        date: r.date,
        type: "RECEIPT",
        refNo: r.receiptNo,
        details: `${r.paddyName} ${bagBreakdown} (নিট: ${toBn(Math.round(netKg).toLocaleString())} কেজি · ৭৫-স্টা: ${toBn(r.standardBags75kg.toFixed(1))}টি)`,
        weightKg: netKg,
        bags: r.bagsCount,
        notes: r.notes,
        rawData: r,
      });
    });

    p.dryerMillings.forEach((d) => {
      const milledKg = d.milledKg > 0 ? d.milledKg : d.usedBags * 75;
      rawStockEvents.push({
        date: d.date,
        type: "MILLING",
        refNo: d.entryNo,
        details: `ডায়ার নং: ${d.dryerNo}${d.notes ? ` (${d.notes})` : ""}`,
        weightKg: milledKg,
        bags: d.usedBags,
        notes: d.notes,
        rawData: d,
      });
    });

    // Sort ascending by date
    rawStockEvents.sort((a, b) => a.date.getTime() - b.date.getTime());

    let runningStock = 0;
    let runningStockKg = 0;
    stockTimeline = rawStockEvents.map((evt) => {
      if (evt.type === "RECEIPT") {
        runningStock += evt.bags;
        runningStockKg += evt.weightKg;
        return {
          date: evt.date,
          type: "RECEIPT",
          refNo: evt.refNo,
          details: evt.details,
          weightKg: evt.weightKg,
          inflowBags: evt.bags,
          outflowBags: 0,
          inflowKg: evt.weightKg,
          outflowKg: 0,
          balanceBags: runningStock,
          balanceKg: runningStockKg,
          notes: evt.notes,
          rawData: evt.rawData,
        };
      } else {
        runningStock -= evt.bags;
        runningStockKg -= evt.weightKg;
        return {
          date: evt.date,
          type: "MILLING",
          refNo: evt.refNo,
          details: evt.details,
          weightKg: evt.weightKg,
          inflowBags: 0,
          outflowBags: evt.bags,
          inflowKg: 0,
          outflowKg: evt.weightKg,
          balanceBags: runningStock,
          balanceKg: runningStockKg,
          notes: evt.notes,
          rawData: evt.rawData,
        };
      }
    });

    // 2. Build Financial Timeline
    const rawFinancialEvents: Array<{
      date: Date;
      refNo: string;
      description: string;
      debit: number;
      credit: number;
      orderRank: number; // 0 for bill debit, 1 for bill immediate cash, 2 for payment
      kind: "RECEIPT_BILL" | "MANUAL_BILL" | "BILL_CASH" | "PAYMENT";
      rawData: any;
    }> = [];

    // Paddy Receipts with milling billing charge
    p.paddyReceipts.forEach((r) => {
      if (r.totalBillAmount > 0) {
        rawFinancialEvents.push({
          date: r.date,
          refNo: r.receiptNo,
          description: `ধান গ্রহণ বিল (${toBn(r.standardBags75kg.toFixed(1))} ৭৫-কেজি বস্তা @ ৳${toBn(r.ratePerStandardBag)})${r.notes ? ` - ${r.notes}` : ""}`,
          debit: r.totalBillAmount,
          credit: 0,
          orderRank: 0,
          kind: "RECEIPT_BILL",
          rawData: r,
        });
      }
    });

    p.bills.forEach((b) => {
      rawFinancialEvents.push({
        date: b.date,
        refNo: b.billNo,
        description: `ধান ছাটাই বিল (${toBn(b.paddyQuantity)} ${b.unit} @ ৳${toBn(b.millingRate)})${b.notes ? ` - ${b.notes}` : ""}`,
        debit: b.totalAmount,
        credit: 0,
        orderRank: 0,
        kind: "MANUAL_BILL",
        rawData: b,
      });

      if (b.paidAmount > 0) {
        rawFinancialEvents.push({
          date: b.date,
          refNo: b.billNo,
          description: "বিলকালীন নগদ পরিশোধ",
          debit: 0,
          credit: b.paidAmount,
          orderRank: 1,
          kind: "BILL_CASH",
          rawData: b,
        });
      }
    });

    p.payments.forEach((pay) => {
      rawFinancialEvents.push({
        date: pay.date,
        refNo: pay.receiptNo,
        description: `বকেয়া বিল আদায় / পেমেন্ট জমা (${pay.paymentMethod || "নগদ"})${pay.notes ? ` - ${pay.notes}` : ""}`,
        debit: 0,
        credit: pay.amount,
        orderRank: 2,
        kind: "PAYMENT",
        rawData: pay,
      });
    });

    // Sort ascending by date, then orderRank
    rawFinancialEvents.sort((a, b) => {
      const diff = a.date.getTime() - b.date.getTime();
      if (diff !== 0) return diff;
      return a.orderRank - b.orderRank;
    });

    let runningDue = 0;
    financialTimeline = rawFinancialEvents.map((evt) => {
      runningDue += evt.debit - evt.credit;
      return {
        date: evt.date,
        refNo: evt.refNo,
        description: evt.description,
        debit: evt.debit,
        credit: evt.credit,
        balanceDue: runningDue,
        kind: evt.kind,
        rawData: evt.rawData,
      };
    });
  }

  // Aggregate stats across all parties
  const grandTotalParties = partySummaries.length;
  const grandTotalStock = partySummaries.reduce((acc, s) => acc + s.currentStock, 0);
  const grandTotalStockKg = partySummaries.reduce((acc, s) => acc + s.currentStockKg, 0);
  const grandTotalReceivedKg = partySummaries.reduce((acc, s) => acc + s.totalReceivedKg, 0);
  const grandTotalMilledKg = partySummaries.reduce((acc, s) => acc + s.totalMilledKg, 0);
  const grandTotalBilled = partySummaries.reduce((acc, s) => acc + s.totalBilled, 0);
  const grandTotalPaid = partySummaries.reduce((acc, s) => acc + s.totalPaid, 0);
  const grandTotalDue = partySummaries.reduce((acc, s) => acc + s.totalDue, 0);

  return (
    <div className="space-y-6">
      {/* Top Navigation Tabs */}
      <RentedMillTabs role={role} />

      {/* Print Header */}
      <ReportPrintHeader
        millName={settings.millName}
        millAddress={settings.millAddress}
        title="পার্টি খতিয়ান ও হিসাব স্টেটমেন্ট"
        subTitle={
          selectedData
            ? `পার্টি: ${selectedData.party.name} · মোবাইল: ${selectedData.party.phone || "—"} · ঠিকানা: ${selectedData.party.address || "—"} · প্রিন্ট তারিখ: ${getBengaliDateLabel(new Date())}`
            : `সকল পার্টির সার্বিক মজুদ ও হিসাব সারসংক্ষেপ · প্রিন্ট তারিখ: ${getBengaliDateLabel(new Date())}`
        }
      />

      {/* Client Controls: Party Selector, Money Receipt Button, Print Button */}
      <PartyLedgerClient
        parties={partyOptions}
        selectedPartyId={selectedPartyId}
        role={role}
      />

      {/* CASE 1: Specific Party Selected */}
      {selectedData ? (
        <div className="space-y-6">
          {/* Party Profile & Key Metrics Card */}
          <div className="rounded-2xl border border-rule bg-white p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-rule pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-ink-900">{selectedData.party.name}</h2>
                  {selectedData.party.isSelfParty && (
                    <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">
                      নিজস্ব পার্টি
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-ink-600">
                  মোবাইল: <span className="font-semibold">{selectedData.party.phone || "—"}</span>
                  {" · "}
                  ঠিকানা: <span className="font-semibold">{selectedData.party.address || "—"}</span>
                </p>
              </div>
              <div className="text-right">
                <Link
                  href="/rented-mill/party-ledger"
                  className="no-print text-xs font-semibold text-brand-600 hover:underline"
                >
                  ← সকল পার্টির তালিকায় ফিরে যান
                </Link>
              </div>
            </div>

            {/* 4 Summary KPI Tiles */}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                <p className="text-[11px] font-semibold text-emerald-800">🌾 হাতে থাকা ধান মজুদ</p>
                <p className="mt-1 text-xl sm:text-2xl font-black text-emerald-950">
                  {toBn(selectedData.currentStock)} <span className="text-xs font-normal">বস্তা</span>
                </p>
                <p className="mt-0.5 text-xs font-bold text-teal-800">
                  মজুদ: {toBn(Math.round(selectedData.currentStockKg).toLocaleString())} কেজি
                </p>
                <p className="mt-0.5 text-[10px] text-emerald-700">
                  প্রাপ্তি: {toBn(selectedData.totalReceivedBags)} বস্তা ({toBn(Math.round(selectedData.totalReceivedKg).toLocaleString())} কেজি) · ছাটাই: {toBn(selectedData.totalMilledBags)} বস্তা
                </p>
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3">
                <p className="text-[11px] font-semibold text-blue-800">📜 মোট ছাটাই বিল</p>
                <p className="mt-1 text-xl sm:text-2xl font-black text-blue-950">
                  {formatBnCurrency(selectedData.totalBilled)}
                </p>
                <p className="mt-0.5 text-[10px] text-blue-700">
                  মোট বিল সংখ্যা: {toBn(selectedData.party.bills.length)} টি
                </p>
              </div>

              <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-3">
                <p className="text-[11px] font-semibold text-teal-800">💵 মোট জমা / পরিশোধ</p>
                <p className="mt-1 text-xl sm:text-2xl font-black text-teal-950">
                  {formatBnCurrency(selectedData.totalPaid)}
                </p>
                <p className="mt-0.5 text-[10px] text-teal-700">নগদ ও ব্যাংক আদায় সহ</p>
              </div>

              <div className={`rounded-xl border p-3 ${
                selectedData.totalDue > 0
                  ? "border-red-200 bg-red-50/50"
                  : "border-slate-200 bg-slate-50/50"
              }`}>
                <p className="text-[11px] font-semibold text-red-800">⚠️ মোট বকেয়া (Due)</p>
                <p className={`mt-1 text-xl sm:text-2xl font-black ${
                  selectedData.totalDue > 0 ? "text-red-700" : "text-slate-800"
                }`}>
                  {formatBnCurrency(selectedData.totalDue)}
                </p>
                <p className="mt-0.5 text-[10px] text-ink-500">
                  {selectedData.totalDue > 0 ? "পরিশোধ বাকি রয়েছে" : "কোনো বকেয়া নেই"}
                </p>
              </div>
            </div>
          </div>

          {/* SECTION 1: ধান ও স্টক খতিয়ান */}
          <div className="rounded-2xl border border-rule bg-white shadow-xs overflow-hidden">
            <div className="border-b border-rule bg-ink-50/50 px-5 py-3 flex items-center justify-between">
              <h3 className="text-sm sm:text-base font-bold text-ink-900 flex items-center gap-2">
                <span>🌾</span> ১. ধান প্রাপ্তি ও স্টক খতিয়ান
              </h3>
              <span className="text-xs text-ink-600 font-medium">
                মোট রেকর্ড: {toBn(stockTimeline.length)} টি
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-rule bg-ink-50 text-[11px] sm:text-xs font-bold text-ink-700 uppercase">
                    <th className="py-2.5 px-3">তারিখ</th>
                    <th className="py-2.5 px-3">ধরণ</th>
                    <th className="py-2.5 px-3">রশিদ / এন্ট্রি নং</th>
                    <th className="py-2.5 px-3">বিবরণ / ধানের নাম</th>
                    <th className="py-2.5 px-3 text-right">স্কেল ওজন (কেজি)</th>
                    <th className="py-2.5 px-3 text-right">জমা ধান (বস্তা)</th>
                    <th className="py-2.5 px-3 text-right">ছাটাই ধান (বস্তা)</th>
                    <th className="py-2.5 px-3 text-right bg-emerald-50/60 font-black text-emerald-950">
                      হাতে মজুদ (বস্তা)
                    </th>
                    <th className="py-2.5 px-3 text-right bg-teal-50/70 font-black text-teal-950">
                      হাতে মজুদ (কেজি)
                    </th>
                    {role !== "PARTNER" && (
                      <th className="py-2.5 px-3 text-center no-print">অ্যাকশন</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule font-medium">
                  {stockTimeline.length === 0 ? (
                    <tr>
                      <td colSpan={role !== "PARTNER" ? 10 : 9} className="py-8 text-center text-ink-400">
                        এই পার্টির কোনো ধান জমা বা ছাটাইয়ের রেকর্ড পাওয়া যায়নি।
                      </td>
                    </tr>
                  ) : (
                    stockTimeline.map((row, idx) => (
                      <tr key={idx} className="hover:bg-ink-50/40">
                        <td className="py-2.5 px-3 whitespace-nowrap text-ink-700">
                          {getBengaliDateLabel(row.date)}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {row.type === "RECEIPT" ? (
                            <span className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                              ধান প্রাপ্তি
                            </span>
                          ) : (
                            <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                              ডায়ার ছাটাই
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap font-mono font-semibold text-ink-800">
                          {row.refNo}
                        </td>
                        <td className="py-2.5 px-3 text-ink-800">
                          {row.details}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-ink-700">
                          {row.weightKg > 0 ? `${toBn(Math.round(row.weightKg).toLocaleString())} কেজি` : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-bold text-emerald-700">
                          {row.inflowBags > 0 ? `+${toBn(row.inflowBags)}` : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-bold text-amber-700">
                          {row.outflowBags > 0 ? `-${toBn(row.outflowBags)}` : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-black text-emerald-950 bg-emerald-50/40">
                          {toBn(row.balanceBags)} বস্তা
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-black text-teal-950 bg-teal-50/40">
                          {toBn(Math.round(row.balanceKg).toLocaleString())} কেজি
                        </td>
                        {role !== "PARTNER" && (
                          <td className="py-2.5 px-3 text-center no-print">
                            {row.type === "RECEIPT" ? (
                              <ReceiptRowActions
                                receipt={row.rawData}
                                parties={partyOptions}
                                role={role}
                              />
                            ) : (
                              <DryerMillingRowActions
                                entry={row.rawData}
                                parties={partyOptions}
                                dryerNames={settings.dryerNames ? JSON.parse(settings.dryerNames) : undefined}
                                role={role}
                              />
                            )}
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
                {stockTimeline.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-ink-800 bg-ink-100/70 font-bold text-ink-900">
                      <td colSpan={4} className="py-2.5 px-3 text-right">
                        সর্বমোট যোগফল:
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-ink-800">
                        <div>প্রাপ্ত: {toBn(Math.round(selectedData.totalReceivedKg).toLocaleString())} কেজি</div>
                        {selectedData.totalMilledKg > 0 && (
                          <div className="text-[11px] text-amber-800">
                            ছাটাই: {toBn(Math.round(selectedData.totalMilledKg).toLocaleString())} কেজি
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right text-emerald-800">
                        {toBn(selectedData.totalReceivedBags)} বস্তা
                      </td>
                      <td className="py-2.5 px-3 text-right text-amber-800">
                        {toBn(selectedData.totalMilledBags)} বস্তা
                      </td>
                      <td className="py-2.5 px-3 text-right text-emerald-950 font-black bg-emerald-100/60">
                        {toBn(selectedData.currentStock)} বস্তা
                      </td>
                      <td className="py-2.5 px-3 text-right text-teal-950 font-black bg-teal-100/60">
                        {toBn(Math.round(selectedData.currentStockKg).toLocaleString())} কেজি
                      </td>
                      {role !== "PARTNER" && <td className="no-print"></td>}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* SECTION 2: আর্থিক লেনদেন ও বকেয়া খতিয়ান */}
          <div className="rounded-2xl border border-rule bg-white shadow-xs overflow-hidden">
            <div className="border-b border-rule bg-ink-50/50 px-5 py-3 flex items-center justify-between">
              <h3 className="text-sm sm:text-base font-bold text-ink-900 flex items-center gap-2">
                <span>💰</span> ২. আর্থিক লেনদেন ও বিল পরিশোধ খতিয়ান
              </h3>
              <span className="text-xs text-ink-600 font-medium">
                মোট এন্ট্রি: {toBn(financialTimeline.length)} টি
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-rule bg-ink-50 text-[11px] sm:text-xs font-bold text-ink-700 uppercase">
                    <th className="py-2.5 px-3">তারিখ</th>
                    <th className="py-2.5 px-3">ভাউচার / বিল নং</th>
                    <th className="py-2.5 px-3">লেনদেনের বিবরণ</th>
                    <th className="py-2.5 px-3 text-right">বিল টাকা (ডেবিট +)</th>
                    <th className="py-2.5 px-3 text-right">জমা টাকা (ক্রেডিট -)</th>
                    <th className="py-2.5 px-3 text-right bg-red-50/60 font-black text-red-950">
                      চলমান বাকি (ব্যালেন্স)
                    </th>
                    {role !== "PARTNER" && (
                      <th className="py-2.5 px-3 text-center no-print">অ্যাকশন</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule font-medium">
                  {financialTimeline.length === 0 ? (
                    <tr>
                      <td colSpan={role !== "PARTNER" ? 7 : 6} className="py-8 text-center text-ink-400">
                        এই পার্টির কোনো বিল বা আর্থিক লেনদেনের রেকর্ড নেই।
                      </td>
                    </tr>
                  ) : (
                    financialTimeline.map((row, idx) => (
                      <tr key={idx} className="hover:bg-ink-50/40">
                        <td className="py-2.5 px-3 whitespace-nowrap text-ink-700">
                          {getBengaliDateLabel(row.date)}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap font-mono font-semibold text-ink-800">
                          {row.refNo}
                        </td>
                        <td className="py-2.5 px-3 text-ink-800">
                          {row.description}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-ink-900">
                          {row.debit > 0 ? formatBnCurrency(row.debit) : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-emerald-700">
                          {row.credit > 0 ? formatBnCurrency(row.credit) : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-black text-red-800 bg-red-50/30">
                          {formatBnCurrency(row.balanceDue)}
                        </td>
                        {role !== "PARTNER" && (
                          <td className="py-2.5 px-3 text-center no-print">
                            {row.kind === "PAYMENT" ? (
                              <PaymentRowActions
                                payment={row.rawData}
                                parties={partyOptions}
                                role={role}
                              />
                            ) : row.kind === "MANUAL_BILL" || row.kind === "BILL_CASH" ? (
                              <MillingBillRowActions
                                bill={row.rawData}
                                parties={partyOptions}
                                role={role}
                              />
                            ) : row.kind === "RECEIPT_BILL" ? (
                              <ReceiptRowActions
                                receipt={row.rawData}
                                parties={partyOptions}
                                role={role}
                              />
                            ) : null}
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
                {financialTimeline.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-ink-800 bg-ink-100/70 font-bold text-ink-900">
                      <td colSpan={3} className="py-2.5 px-3 text-right">
                        মোট যোগফল:
                      </td>
                      <td className="py-2.5 px-3 text-right font-black">
                        {formatBnCurrency(selectedData.totalBilled)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-black text-emerald-800">
                        {formatBnCurrency(selectedData.totalPaid)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-black text-red-800 bg-red-100/60">
                        {formatBnCurrency(selectedData.totalDue)}
                      </td>
                      {role !== "PARTNER" && <td className="no-print"></td>}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Signature Blocks for Print A4 */}
          <div className="hidden print:grid grid-cols-2 gap-12 pt-16 mt-12 border-t border-dashed border-gray-400 text-xs sm:text-sm">
            <div className="text-center">
              <div className="border-t border-black w-48 mx-auto pt-1 font-bold">
                পার্টির স্বাক্ষর
              </div>
            </div>
            <div className="text-center">
              <div className="border-t border-black w-48 mx-auto pt-1 font-bold">
                হিসাবরক্ষক / মিল কর্তৃপক্ষ
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* CASE 2: No specific party selected -> All Parties Summary */
        <div className="space-y-6">
          {/* Top KPI Cards for All Parties */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-rule bg-white p-4 shadow-xs">
              <p className="text-xs font-semibold text-ink-600">👥 মোট পার্টি সংখ্যা</p>
              <p className="mt-1 text-2xl font-black text-ink-900">
                {toBn(grandTotalParties)} <span className="text-xs font-normal">জন</span>
              </p>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-xs">
              <p className="text-xs font-semibold text-emerald-800">🌾 মিলে সর্বমোট মজুদ ধান</p>
              <p className="mt-1 text-2xl font-black text-emerald-950">
                {toBn(grandTotalStock)} <span className="text-xs font-normal">বস্তা</span>
              </p>
            </div>

            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 shadow-xs">
              <p className="text-xs font-semibold text-blue-800">📜 সর্বমোট ছাটাই বিল</p>
              <p className="mt-1 text-2xl font-black text-blue-950">
                {formatBnCurrency(grandTotalBilled)}
              </p>
              <p className="mt-0.5 text-[10px] text-blue-700">
                মোট আদায়: {formatBnCurrency(grandTotalPaid)}
              </p>
            </div>

            <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 shadow-xs">
              <p className="text-xs font-semibold text-red-800">⚠️ সর্বমোট বকেয়া (Due)</p>
              <p className="mt-1 text-2xl font-black text-red-700">
                {formatBnCurrency(grandTotalDue)}
              </p>
              <p className="mt-0.5 text-[10px] text-red-600">সব পার্টির মোট বাকি</p>
            </div>
          </div>

          {/* Master Table of All Parties */}
          <div className="rounded-2xl border border-rule bg-white shadow-xs overflow-hidden">
            <div className="border-b border-rule bg-ink-50/50 px-5 py-3.5 flex items-center justify-between">
              <h3 className="text-sm sm:text-base font-bold text-ink-900 flex items-center gap-2">
                <span>📋</span> সকল পার্টির মজুদ ও লেনদেন সারসংক্ষেপ
              </h3>
              <span className="text-xs text-ink-600 font-medium">
                মোট {toBn(partySummaries.length)} জন পার্টি
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-rule bg-ink-50 text-[11px] sm:text-xs font-bold text-ink-700 uppercase">
                    <th className="py-2.5 px-3">ক্রমিক</th>
                    <th className="py-2.5 px-3">পার্টির নাম</th>
                    <th className="py-2.5 px-3">মোবাইল ও ঠিকানা</th>
                    <th className="py-2.5 px-3 text-right">মোট ধান প্রাপ্তি</th>
                    <th className="py-2.5 px-3 text-right">ছাটাইকৃত ধান</th>
                    <th className="py-2.5 px-3 text-right bg-emerald-50/60 font-black text-emerald-950">
                      বর্তমান ধান মজুদ
                    </th>
                    <th className="py-2.5 px-3 text-right">মোট ছাটাই বিল</th>
                    <th className="py-2.5 px-3 text-right">মোট জমা/পরিশোধ</th>
                    <th className="py-2.5 px-3 text-right bg-red-50/60 font-black text-red-950">
                      মোট বাকি (Due)
                    </th>
                    <th className="py-2.5 px-3 text-center no-print">খতিয়ান বিবরণ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule font-medium">
                  {partySummaries.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-ink-400">
                        এখনো কোনো পার্টি যুক্ত করা হয়নি।
                      </td>
                    </tr>
                  ) : (
                    partySummaries.map((s, idx) => (
                      <tr key={s.party.id} className="hover:bg-ink-50/50">
                        <td className="py-2.5 px-3 text-ink-600 tabular-nums">
                          {toBn(idx + 1)}
                        </td>
                        <td className="py-2.5 px-3">
                          <Link
                            href={`/rented-mill/party-ledger?partyId=${s.party.id}`}
                            className="font-bold text-brand-600 hover:underline"
                          >
                            {s.party.name}
                          </Link>
                          {s.party.isSelfParty && (
                            <span className="ml-1.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                              নিজস্ব
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-ink-600">
                          {s.party.phone || "—"} {s.party.address ? `· ${s.party.address}` : ""}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-ink-700">
                          {toBn(s.totalReceivedBags)} বস্তা
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-amber-800">
                          {toBn(s.totalMilledBags)} বস্তা
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-black text-emerald-950 bg-emerald-50/30">
                          <div>{toBn(s.currentStock)} বস্তা</div>
                          <div className="text-[11px] font-bold text-teal-800">
                            {toBn(Math.round(s.currentStockKg).toLocaleString())} কেজি
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-ink-800">
                          {formatBnCurrency(s.totalBilled)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-emerald-700 font-semibold">
                          {formatBnCurrency(s.totalPaid)}
                        </td>
                        <td className={`py-2.5 px-3 text-right tabular-nums font-black bg-red-50/30 ${
                          s.totalDue > 0 ? "text-red-700" : "text-slate-600"
                        }`}>
                          {formatBnCurrency(s.totalDue)}
                        </td>
                        <td className="py-2.5 px-3 text-center no-print">
                          <Link
                            href={`/rented-mill/party-ledger?partyId=${s.party.id}`}
                            className="rounded-lg bg-ink-100 hover:bg-brand-50 hover:text-brand-700 px-2.5 py-1 text-xs font-semibold text-ink-700 transition"
                          >
                            বিস্তারিত খতিয়ান →
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {partySummaries.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-ink-800 bg-ink-100/70 font-bold text-ink-900">
                      <td colSpan={3} className="py-3 px-3 text-right">
                        সর্বমোট যোগফল:
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div>{toBn(partySummaries.reduce((a, b) => a + b.totalReceivedBags, 0))} বস্তা</div>
                        <div className="text-[11px] text-ink-600 font-semibold">
                          ({toBn(Math.round(grandTotalReceivedKg).toLocaleString())} কেজি)
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right text-amber-800">
                        <div>{toBn(partySummaries.reduce((a, b) => a + b.totalMilledBags, 0))} বস্তা</div>
                        <div className="text-[11px] text-amber-700 font-semibold">
                          ({toBn(Math.round(grandTotalMilledKg).toLocaleString())} কেজি)
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right text-emerald-950 font-black bg-emerald-100/60">
                        <div>{toBn(grandTotalStock)} বস্তা</div>
                        <div className="text-[11px] font-bold text-teal-900">
                          {toBn(Math.round(grandTotalStockKg).toLocaleString())} কেজি
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right">
                        {formatBnCurrency(grandTotalBilled)}
                      </td>
                      <td className="py-3 px-3 text-right text-emerald-800">
                        {formatBnCurrency(grandTotalPaid)}
                      </td>
                      <td className="py-3 px-3 text-right text-red-800 font-black bg-red-100/60">
                        {formatBnCurrency(grandTotalDue)}
                      </td>
                      <td className="no-print"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Signature Blocks for Print A4 */}
          <div className="hidden print:grid grid-cols-2 gap-12 pt-16 mt-12 border-t border-dashed border-gray-400 text-xs sm:text-sm">
            <div className="text-center">
              <div className="border-t border-black w-48 mx-auto pt-1 font-bold">
                যাচাইকারী কর্মকর্তা
              </div>
            </div>
            <div className="text-center">
              <div className="border-t border-black w-48 mx-auto pt-1 font-bold">
                হিসাবরক্ষক / মিল কর্তৃপক্ষ
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
