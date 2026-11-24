import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
} from "../../../rented-mill-ui";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const party = await prisma.rentedMillParty.findUnique({ where: { id } });
  return {
    title: `${party?.name || "পার্টি"} - লেজার খতিয়ান (ভাড়া অটো রাইস মিল)`,
  };
}

export default async function PartyLedgerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireContext();
  const settings = await getRentedMillSettings();
  const role = resolveRentedMillRole(ctx, settings);
  const { id } = await params;

  const party = await prisma.rentedMillParty.findUnique({
    where: { id },
    include: {
      bills: { orderBy: { date: "asc" } },
      paddyReceipts: {
        where: { status: "APPROVED", totalBillAmount: { gt: 0 } },
        orderBy: { date: "asc" },
      },
      payments: { orderBy: { date: "asc" } },
    },
  });

  if (!party) notFound();

  // Combine bills, auto-generated paddy receipts, and payments into a unified ledger timeline
  type LedgerRow = {
    id: string;
    date: Date;
    type: "BILL" | "PAYMENT";
    reference: string;
    description: string;
    debit: number; // bill amount
    credit: number; // paid amount
  };

  const rows: LedgerRow[] = [
    ...party.paddyReceipts.map((r) => ({
      id: `paddy-${r.id}`,
      date: r.date,
      type: "BILL" as const,
      reference: r.receiptNo,
      description: `ধান গ্রহণ বিল (${toBn(r.standardBags75kg.toFixed(1))} ৭৫-কেজি বস্তা @ ৳${toBn(r.ratePerStandardBag)}) · ${r.paddyName}`,
      debit: r.totalBillAmount,
      credit: 0,
    })),
    ...party.bills.map((b) => ({
      id: `bill-${b.id}`,
      date: b.date,
      type: "BILL" as const,
      reference: b.billNo,
      description: `ধান ছাটাই (${toBn(b.paddyQuantity)} ${b.unit} @ ৳${toBn(b.millingRate)})`,
      debit: b.totalAmount,
      credit: b.paidAmount,
    })),
    ...party.payments.map((p) => ({
      id: `pay-${p.id}`,
      date: p.date,
      type: "PAYMENT" as const,
      reference: p.receiptNo,
      description: `বকেয়া জমা (${p.paymentMethod}) ${p.notes ? `· ${p.notes}` : ""}`,
      debit: 0,
      credit: p.amount,
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  let runningBalance = party.openingBalance || 0;
  const ledgerEntries = rows.map((r) => {
    runningBalance += r.debit - r.credit;
    return {
      ...r,
      balance: runningBalance,
    };
  });

  const totalBilled =
    party.paddyReceipts.reduce((s, r) => s + r.totalBillAmount, 0) +
    party.bills.reduce((s, b) => s + b.totalAmount, 0);
  const totalPaid =
    party.bills.reduce((s, b) => s + b.paidAmount, 0) +
    party.payments.reduce((s, p) => s + p.amount, 0);
  const currentDue = Math.max(0, runningBalance);

  return (
    <div className="space-y-6">
      <RentedMillTabs role={role} />

      {/* Header and Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-rule pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/rented-mill/milling-bills"
              className="text-xs text-brand-600 font-semibold hover:underline no-print"
            >
              ← ধান ছাটাই বিল তালিকায় ফেরত
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink-900 mt-1">
            {party.name} - লেজার খতিয়ান
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            মোবাইল: {party.phone || "—"} · ঠিকানা: {party.address || "—"}
            {party.isSelfParty && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 font-medium">
                নিজস্ব পার্টি / আল্লাহর দান এন্টারপ্রাইজ
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <PrintButton label="লেজার স্টেটমেন্ট প্রিন্ট" />
        </div>
      </div>

      {/* Print Statement Header */}
      <div className="hidden print:block text-center border-b pb-3 mb-4">
        <h2 className="text-2xl font-bold">{settings.millName}</h2>
        <p className="text-xs text-slate-600">{settings.millAddress} · {settings.millPhone}</p>
        <p className="text-base font-bold mt-2">পার্টি লেজার স্টেটমেন্ট</p>
        <p className="text-sm font-semibold">{party.name} {party.phone ? `(${party.phone})` : ""}</p>
        <p className="text-xs text-slate-500">প্রিন্ট তারিখ: {getBengaliDateLabel(new Date())}</p>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-rule bg-white p-4 shadow-2xs">
          <p className="text-xs font-semibold text-slate-500">মোট ছাটাই বিল (ডেবিট)</p>
          <p className="mt-1 text-lg sm:text-xl font-bold text-ink-900">
            {formatBnCurrency(totalBilled)}
          </p>
          <p className="text-[11px] text-slate-500">{toBn(party.bills.length)} টি ছাটাই বিল</p>
        </div>

        <div className="rounded-xl border border-rule bg-white p-4 shadow-2xs">
          <p className="text-xs font-semibold text-slate-500">মোট জমা / পরিশোধ (ক্রেডিট)</p>
          <p className="mt-1 text-lg sm:text-xl font-bold text-emerald-700">
            {formatBnCurrency(totalPaid)}
          </p>
          <p className="text-[11px] text-slate-500">নগদ ও আদায়কৃত টাকা</p>
        </div>

        <div className="rounded-xl border border-rule bg-white p-4 shadow-2xs">
          <p className="text-xs font-semibold text-slate-500">বর্তমান বকেয়া ব্যালেন্স</p>
          <p className="mt-1 text-lg sm:text-xl font-bold text-red-700">
            {formatBnCurrency(currentDue)}
          </p>
          <p className="text-[11px] text-slate-500">
            {currentDue > 0 ? "মিলের প্রাপ্য বাকি" : "পরিশোধিত / কোনো বাকি নেই"}
          </p>
        </div>
      </div>

      {/* Detailed Ledger Table */}
      <div className="rounded-xl border border-rule bg-white shadow-2xs overflow-hidden">
        <div className="border-b border-rule bg-slate-50/70 px-4 py-3">
          <h2 className="text-sm font-bold text-ink-900">
            লেনদেনের বিস্তারিত বিবরণী (খতিয়ান)
          </h2>
        </div>

        {ledgerEntries.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            এই পার্টির কোনো লেনদেন পাওয়া যায়নি।
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-rule bg-slate-50 text-slate-600">
                  <th className="py-2.5 px-3 font-semibold">তারিখ</th>
                  <th className="py-2.5 px-3 font-semibold">ভাউচার/বিল নং</th>
                  <th className="py-2.5 px-3 font-semibold">বিবরণ</th>
                  <th className="py-2.5 px-3 font-semibold text-right">বিল (ডেবিট)</th>
                  <th className="py-2.5 px-3 font-semibold text-right">জমা (ক্রেডিট)</th>
                  <th className="py-2.5 px-3 font-semibold text-right">জের / ব্যালেন্স</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ledgerEntries.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3 text-slate-500">
                      {getBengaliDateLabel(row.date)}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-ink-800">
                      {row.reference}
                    </td>
                    <td className="py-2.5 px-3 text-ink-900">
                      {row.description}
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-ink-900">
                      {row.debit > 0 ? formatBnCurrency(row.debit) : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-emerald-700">
                      {row.credit > 0 ? formatBnCurrency(row.credit) : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-ink-900">
                      {formatBnCurrency(row.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-rule bg-slate-50 font-bold text-xs">
                  <td colSpan={3} className="py-2.5 px-3 text-right">
                    মোট:
                  </td>
                  <td className="py-2.5 px-3 text-right text-ink-900">
                    {formatBnCurrency(totalBilled)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-emerald-700">
                    {formatBnCurrency(totalPaid)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-red-700">
                    {formatBnCurrency(currentDue)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
