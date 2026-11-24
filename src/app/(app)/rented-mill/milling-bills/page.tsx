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
  PrintButton,
  RentedMillTabs,
} from "../rented-mill-ui";
import { MillingBillsClient } from "./milling-bills-client";
import { MillingBillRowActions } from "../rented-mill-edit-modals";

export const metadata: Metadata = {
  title: "ধান ছাটাই বিল ও পার্টি লেজার - শুভংকর অটো রাইস মিল",
};

interface UnifiedMillingBill {
  id: string;
  billNo: string;
  source: "AUTO_PADDY_RECEIPT" | "MANUAL";
  sourceLabel: string;
  date: Date;
  partyId: string;
  party: {
    id: string;
    name: string;
    phone: string | null;
    isSelfParty: boolean;
  };
  paddyQuantity: number;
  unit: string;
  details: string;
  millingRate: number;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  notes: string | null;
  status?: string;
}

export default async function MillingBillsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; partyId?: string }>;
}) {
  const ctx = await requireContext();
  const settings = await getRentedMillSettings();
  const role = resolveRentedMillRole(ctx, settings);

  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const filterPartyId = sp.partyId || "";

  const [parties, manualBills, paddyReceipts] = await Promise.all([
    prisma.rentedMillParty.findMany({
      orderBy: { name: "asc" },
      include: {
        bills: {
          where: { status: "APPROVED" },
          select: { totalAmount: true, paidAmount: true, dueAmount: true },
        },
        paddyReceipts: {
          where: { status: "APPROVED" },
          select: { totalBillAmount: true, bagsCount: true, standardBags75kg: true },
        },
        payments: {
          where: { status: "APPROVED" },
          select: { amount: true },
        },
      },
    }),
    prisma.rentedMillBill.findMany({
      where: {
        AND: [
          filterPartyId ? { partyId: filterPartyId } : {},
          { status: "APPROVED" },
          q
            ? {
                OR: [
                  { billNo: { contains: q, mode: "insensitive" } },
                  { party: { name: { contains: q, mode: "insensitive" } } },
                  { notes: { contains: q, mode: "insensitive" } },
                ],
              }
            : {},
        ],
      },
      include: { party: true },
      orderBy: { date: "desc" },
    }),
    prisma.rentedMillPaddyReceipt.findMany({
      where: {
        AND: [
          filterPartyId ? { partyId: filterPartyId } : {},
          { status: "APPROVED" },
          { totalBillAmount: { gt: 0 } },
          q
            ? {
                OR: [
                  { receiptNo: { contains: q, mode: "insensitive" } },
                  { party: { name: { contains: q, mode: "insensitive" } } },
                  { paddyName: { contains: q, mode: "insensitive" } },
                  { notes: { contains: q, mode: "insensitive" } },
                ],
              }
            : {},
        ],
      },
      include: { party: true },
      orderBy: { date: "desc" },
    }),
  ]);

  // Combine auto-generated bills from paddy receipt and legacy manual bills
  const unifiedBills: UnifiedMillingBill[] = [
    ...paddyReceipts.map((r) => ({
      id: r.id,
      billNo: r.receiptNo,
      source: "AUTO_PADDY_RECEIPT" as const,
      sourceLabel: "ধান প্রাপ্তি অটো বিল",
      date: r.date,
      partyId: r.partyId,
      party: r.party,
      paddyQuantity: r.standardBags75kg,
      unit: "৭৫-কেজি বস্তা",
      details: `${r.paddyName} · মূল: ${toBn(r.bagsCount)} বস্তা (নিট: ${toBn(Math.round(r.netSklKg || r.sklWeight).toLocaleString())} কেজি)`,
      millingRate: r.ratePerStandardBag,
      totalAmount: r.totalBillAmount,
      paidAmount: 0,
      dueAmount: r.totalBillAmount,
      notes: r.notes,
      status: r.status,
    })),
    ...manualBills.map((b) => ({
      id: b.id,
      billNo: b.billNo,
      source: "MANUAL" as const,
      sourceLabel: "ম্যানুয়াল বিল",
      date: b.date,
      partyId: b.partyId,
      party: b.party,
      paddyQuantity: b.paddyQuantity,
      unit: b.unit,
      details: b.notes || "",
      millingRate: b.millingRate,
      totalAmount: b.totalAmount,
      paidAmount: b.paidAmount,
      dueAmount: b.dueAmount,
      notes: b.notes,
      status: b.status,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Metrics
  const totalBillAmount = unifiedBills.reduce((sum, b) => sum + b.totalAmount, 0);
  const totalPaidAmount =
    parties.reduce(
      (sum, p) =>
        sum +
        p.payments.reduce((s, pm) => s + pm.amount, 0) +
        p.bills.reduce((s, b) => s + b.paidAmount, 0),
      0
    );
  const totalDueAmount = Math.max(0, totalBillAmount - totalPaidAmount);
  const totalBags =
    paddyReceipts.reduce((sum, r) => sum + r.bagsCount, 0) +
    manualBills.reduce((sum, b) => sum + (b.unit === "বস্তা" ? b.paddyQuantity : 0), 0);

  return (
    <div className="space-y-6">
      <RentedMillTabs role={role} />

      {/* Header and Action Buttons */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-rule pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink-900">
            ধান ছাটাই বিল ও পার্টি লেজার
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500">
            ধান প্রাপ্তি থেকে স্বয়ংক্রিয় বিল ও সকল পার্টির বকেয়া হিসাব (Read-Only)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <MillingBillsClient parties={parties} role={role} />
          <PrintButton label="বিল তালিকা প্রিন্ট" />
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-rule bg-white p-3.5 shadow-2xs">
          <p className="text-xs font-semibold text-slate-500">মোট ছাটাই বিল</p>
          <p className="mt-1 text-lg sm:text-xl font-bold text-ink-900">
            {formatBnCurrency(totalBillAmount)}
          </p>
          <p className="text-[11px] text-slate-500">
            মোট ধান: {toBn(totalBags)} বস্তা
          </p>
        </div>

        <div className="rounded-xl border border-rule bg-white p-3.5 shadow-2xs">
          <p className="text-xs font-semibold text-slate-500">মোট নগদ আদায়</p>
          <p className="mt-1 text-lg sm:text-xl font-bold text-emerald-700">
            {formatBnCurrency(totalPaidAmount)}
          </p>
          <p className="text-[11px] text-slate-500">জমা ও বকেয়া আদায় সহ</p>
        </div>

        <div className="rounded-xl border border-rule bg-white p-3.5 shadow-2xs">
          <p className="text-xs font-semibold text-slate-500">মোট বর্তমান বকেয়া</p>
          <p className="mt-1 text-lg sm:text-xl font-bold text-red-700">
            {formatBnCurrency(totalDueAmount)}
          </p>
          <p className="text-[11px] text-slate-500">সকল পার্টির নিকট পাওনা</p>
        </div>

        <div className="rounded-xl border border-rule bg-white p-3.5 shadow-2xs">
          <p className="text-xs font-semibold text-slate-500">মোট পার্টি সংখ্যা</p>
          <p className="mt-1 text-lg sm:text-xl font-bold text-blue-900">
            {toBn(parties.length)} জন
          </p>
          <p className="text-[11px] text-slate-500">নিবন্ধিত কাস্টমার</p>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex flex-wrap items-center gap-3 no-print">
        <form method="GET" className="flex flex-1 items-center gap-2 max-w-md">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="বিল নং, পার্টির নাম বা ধানের জাত খুঁজুন..."
            className="w-full rounded-lg border border-rule bg-white px-3 py-1.5 text-xs text-ink-900 focus:border-brand-500"
          />
          <button type="submit" className="btn-outline text-xs">
            সার্চ
          </button>
        </form>

        <div className="flex items-center gap-2">
          {filterPartyId && (
            <Link
              href="/rented-mill/milling-bills"
              className="text-xs text-brand-600 font-semibold hover:underline"
            >
              সব বিল দেখুন ✕
            </Link>
          )}
        </div>
      </div>

      {/* Main Table: Milling Bills */}
      <div className="rounded-xl border border-rule bg-white shadow-2xs overflow-hidden">
        <div className="border-b border-rule bg-slate-50/70 px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink-900">
            ধান ছাটাই বিলের তালিকা ({toBn(unifiedBills.length)} টি)
          </h2>
          <span className="text-xs text-slate-500 font-normal">
            (ধান গ্রহণ থেকে স্বয়ংক্রিয়ভাবে প্রস্তুতকৃত)
          </span>
        </div>

        {unifiedBills.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            কোনো ধান ছাটাই বিলের রেকর্ড পাওয়া যায়নি। উপরে{" "}
            <b>&ldquo;+ নতুন ধান প্রাপ্তি (অটো বিলসহ)&rdquo;</b> বাটনে ক্লিক করে ধান গ্রহণ করুন।
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-rule bg-slate-50 text-slate-600 font-bold">
                  <th className="py-2.5 px-3">বিল / রশিদ নং</th>
                  <th className="py-2.5 px-3">উৎস</th>
                  <th className="py-2.5 px-3">তারিখ</th>
                  <th className="py-2.5 px-3">পার্টির নাম</th>
                  <th className="py-2.5 px-3 text-right">পরিমাণ ও বিবরণ</th>
                  <th className="py-2.5 px-3 text-right">রেট</th>
                  <th className="py-2.5 px-3 text-right font-black text-ink-900">মোট বিল</th>
                  <th className="py-2.5 px-3 text-right text-emerald-700">নগদ জমা</th>
                  <th className="py-2.5 px-3 text-right font-black text-red-700">বাকি</th>
                  <th className="py-2.5 px-3 text-center no-print">লেজার</th>
                  {role !== "PARTNER" && (
                    <th className="py-2.5 px-3 text-center no-print">অ্যাকশন</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {unifiedBills.map((b) => (
                  <tr key={`${b.source}-${b.id}`} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3 font-mono font-bold text-brand-700">
                      {b.billNo}
                    </td>
                    <td className="py-2.5 px-3">
                      {b.source === "AUTO_PADDY_RECEIPT" ? (
                        <span className="rounded bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800">
                          🌾 অটো বিল
                        </span>
                      ) : (
                        <span className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          ম্যানুয়াল
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                      {getBengaliDateLabel(b.date)}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-ink-900">
                      <Link
                        href={`/rented-mill/party-ledger?partyId=${b.partyId}`}
                        className="hover:text-brand-600 hover:underline font-bold"
                      >
                        {b.party.name}
                      </Link>
                      {b.party.isSelfParty && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800 font-normal">
                          নিজস্ব
                        </span>
                      )}
                      {b.party.phone && (
                        <span className="block text-[11px] text-slate-400">
                          {b.party.phone}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-700 font-medium">
                      <div className="font-bold">
                        {toBn(b.paddyQuantity.toFixed(1))} {b.unit}
                      </div>
                      {b.details && (
                        <div className="text-[10px] text-slate-500">{b.details}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-600">
                      ৳{toBn(b.millingRate)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-ink-900">
                      {formatBnCurrency(b.totalAmount)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-emerald-700">
                      {formatBnCurrency(b.paidAmount)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-black text-red-700">
                      {formatBnCurrency(b.dueAmount)}
                    </td>
                    <td className="py-2.5 px-3 text-center no-print">
                      <Link
                        href={`/rented-mill/party-ledger?partyId=${b.partyId}`}
                        className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-700 hover:border-brand-300"
                      >
                        খতিয়ান →
                      </Link>
                    </td>
                    {role !== "PARTNER" && (
                      <td className="py-2.5 px-3 text-center no-print">
                        {b.source === "MANUAL" ? (
                          <MillingBillRowActions
                            bill={b}
                            parties={parties.map((p) => ({ id: p.id, name: p.name }))}
                            role={role}
                          />
                        ) : (
                          <Link
                            href={`/rented-mill/reports/paddy-receipt?date=${new Date(b.date).toISOString().split("T")[0]}`}
                            title="মূল ধান প্রাপ্তি রশিদে যান"
                            className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100 transition"
                          >
                            🌾 রশিদে দেখুন
                          </Link>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* পার্টি তালিকা ও মোট দেনা-পাওনা সারসংক্ষেপ */}
      <div className="rounded-xl border border-rule bg-white shadow-2xs overflow-hidden mt-6">
        <div className="border-b border-rule bg-slate-50/70 px-4 py-3">
          <h2 className="text-sm font-bold text-ink-900">
            সকল পার্টির মোট বকেয়া ও লেজার সামারি
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-rule bg-slate-50 text-slate-600 font-bold">
                <th className="py-2.5 px-3 font-semibold">পার্টির নাম</th>
                <th className="py-2.5 px-3 font-semibold">মোবাইল</th>
                <th className="py-2.5 px-3 font-semibold text-right">মোট বিল</th>
                <th className="py-2.5 px-3 font-semibold text-right">মোট জমা/পরিশোধ</th>
                <th className="py-2.5 px-3 font-semibold text-right">বর্তমান বাকি</th>
                <th className="py-2.5 px-3 font-semibold text-center no-print">লেজার স্টেটমেন্ট</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {parties.map((p) => {
                const pReceiptBilled = p.paddyReceipts.reduce(
                  (s, r) => s + (r.totalBillAmount || 0),
                  0
                );
                const pManualBilled = p.bills.reduce((s, b) => s + b.totalAmount, 0);
                const pTotalBilled = pReceiptBilled + pManualBilled;

                const pPaidAtBill = p.bills.reduce((s, b) => s + b.paidAmount, 0);
                const pSubsequentPaid = p.payments.reduce((s, pm) => s + pm.amount, 0);
                const pTotalPaid = pPaidAtBill + pSubsequentPaid;
                const pNetDue = Math.max(0, pTotalBilled - pTotalPaid);

                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-semibold text-ink-900">
                      {p.name}
                      {p.isSelfParty && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800">
                          নিজস্ব
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-slate-500">{p.phone || "—"}</td>
                    <td className="py-2 px-3 text-right font-medium">
                      {formatBnCurrency(pTotalBilled)}
                    </td>
                    <td className="py-2 px-3 text-right text-emerald-700">
                      {formatBnCurrency(pTotalPaid)}
                    </td>
                    <td className="py-2 px-3 text-right font-bold text-red-700">
                      {formatBnCurrency(pNetDue)}
                    </td>
                    <td className="py-2 px-3 text-center no-print">
                      <Link
                        href={`/rented-mill/party-ledger?partyId=${p.id}`}
                        className="text-brand-600 hover:underline font-semibold"
                      >
                        খতিয়ান দেখুন →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
