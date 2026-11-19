import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDateTime, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { requireContext } from "@/server/auth";
import { getRiceMillSettings, resolveMillRole } from "@/lib/custom-milling";
import { CustomMillingTabs, PrintButton } from "../../custom-milling-ui";

export const metadata: Metadata = {
  title: "পার্টি লেজার বিবরণী",
};

interface LedgerEntry {
  id: string;
  date: Date;
  refNo: string;
  type: "OPENING" | "BILL" | "RECEIPT" | "PAYMENT";
  description: string;
  debit: number; // Bill / Charge (Customer owes more)
  credit: number; // Payment / Received (Customer owes less)
  balance: number; // Running due balance
  link?: string;
}

export default async function CustomMillingPartyLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ role?: string }>;
}) {
  const ctx = await requireContext();
  const { id } = await params;
  const sp = await searchParams;
  const settings = await getRiceMillSettings();
  const role = resolveMillRole(ctx, sp.role, settings);

  const party = await prisma.millParty.findUnique({
    where: { id },
    include: {
      batches: {
        orderBy: { date: "asc" },
      },
      vouchers: {
        orderBy: { date: "asc" },
      },
    },
  });

  if (!party) notFound();

  // Build merged chronological ledger
  const entries: LedgerEntry[] = [];
  let runningBalance = party.openingBalance || 0;

  // Opening balance row
  if (party.openingBalance !== 0) {
    entries.push({
      id: "opening",
      date: party.createdAt,
      refNo: "OPENING",
      type: "OPENING",
      description: "প্রারম্ভিক বকেয়া (Opening Balance)",
      debit: party.openingBalance > 0 ? party.openingBalance : 0,
      credit: party.openingBalance < 0 ? Math.abs(party.openingBalance) : 0,
      balance: runningBalance,
    });
  }

  // Raw items pool
  type RawItem =
    | { kind: "BATCH"; date: Date; batch: (typeof party.batches)[number] }
    | { kind: "VOUCHER"; date: Date; voucher: (typeof party.vouchers)[number] };

  const pool: RawItem[] = [
    ...party.batches.map((b) => ({ kind: "BATCH" as const, date: b.date, batch: b })),
    ...party.vouchers.map((v) => ({ kind: "VOUCHER" as const, date: v.date, voucher: v })),
  ];

  // Sort chronologically
  pool.sort((a, b) => a.date.getTime() - b.date.getTime());

  for (const item of pool) {
    if (item.kind === "BATCH") {
      const b = item.batch;
      const bill = Number(b.totalBillAmount || 0);
      runningBalance += bill;

      entries.push({
        id: b.id,
        date: b.date,
        refNo: b.batchNo,
        type: "BILL",
        description: `ধান মাড়াই ও শুকানো বিল (${b.paddyType}, ${b.standardBags75Kg} স্ট্যান্ডার্ড বস্তা)`,
        debit: bill,
        credit: 0,
        balance: runningBalance,
        link: `/custom-milling/batches/${b.id}/bill${sp.role ? `?role=${sp.role}` : ""}`,
      });
    } else {
      const v = item.voucher;
      const amt = Number(v.amount || 0);
      if (v.type === "RECEIPT") {
        runningBalance -= amt;
        entries.push({
          id: v.id,
          date: v.date,
          refNo: v.voucherNo,
          type: "RECEIPT",
          description: `নগদ/ব্যাংক বিল আদায় (${v.paymentMode}) ${v.note ? `— ${v.note}` : ""}`,
          debit: 0,
          credit: amt,
          balance: runningBalance,
        });
      } else {
        runningBalance += amt;
        entries.push({
          id: v.id,
          date: v.date,
          refNo: v.voucherNo,
          type: "PAYMENT",
          description: `রিফান্ড/ফেরত প্রদান (${v.paymentMode}) ${v.note ? `— ${v.note}` : ""}`,
          debit: amt,
          credit: 0,
          balance: runningBalance,
        });
      }
    }
  }

  const totalDebit = entries.reduce((sum, e) => sum + e.debit, 0);
  const totalCredit = entries.reduce((sum, e) => sum + e.credit, 0);

  return (
    <div className="space-y-6">
      {/* Header (Hidden on print) */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between no-print">
        <PageHeader
          title={`পার্টি লেজার — ${party.name}`}
          description={`যোগাযোগ: ${party.phone || "নাই"} · ঠিকানা: ${party.address || "নাই"}`}
        />
        <div className="flex items-center gap-2">
          <PrintButton />
          <Link
            href={`/custom-milling/parties${sp.role ? `?role=${sp.role}` : ""}`}
            prefetch={false}
            className="btn-outline text-xs"
          >
            ← সকল পার্টি
          </Link>
        </div>
      </div>

      <div className="no-print">
        <CustomMillingTabs role={role} />
      </div>

      {/* Screen Summary Cards (Hidden on print) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 no-print">
        <div className="rounded-xl border border-rule bg-white p-3.5 shadow-2xs">
          <p className="text-[11px] font-semibold text-slate-500">মোট মাড়াই বিল (Debit)</p>
          <p className="text-xl font-bold text-slate-900">৳ {formatNumber(totalDebit)}</p>
        </div>
        <div className="rounded-xl border border-rule bg-white p-3.5 shadow-2xs">
          <p className="text-[11px] font-semibold text-slate-500">মোট পরিশোধ/জমা (Credit)</p>
          <p className="text-xl font-bold text-emerald-700">৳ {formatNumber(totalCredit)}</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50/70 p-3.5 shadow-2xs">
          <p className="text-[11px] font-semibold text-red-900">বর্তমান অবশিষ্ট বাকি</p>
          <p className="text-xl font-bold text-red-950">৳ {formatNumber(party.currentDue)}</p>
        </div>
        <div className="rounded-xl border border-rule bg-white p-3.5 shadow-2xs flex items-center justify-center">
          <Link
            href={`/custom-milling/vouchers${sp.role ? `?role=${sp.role}` : ""}`}
            prefetch={false}
            className="btn-primary text-xs w-full text-center py-2"
          >
            💵 টাকা গ্রহণ করুন
          </Link>
        </div>
      </div>

      {/* Printable Ledger Statement Panel */}
      <section className="panel p-6 sm:p-8 bg-white print:border-none print:shadow-none print:p-0">
        {/* Print Mill Header */}
        <div className="border-b-2 border-slate-900 pb-4 text-center">
          <h1 className="text-2xl font-black text-slate-900">{settings.millName}</h1>
          <p className="text-xs text-slate-600 font-medium mt-0.5">
            {settings.millAddress} · ফোন: {settings.millPhone}
          </p>
          <div className="mt-2 inline-block rounded border border-slate-800 bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-900">
            পার্টি খতিয়ান / লেজার স্টেটমেন্ট
          </div>
        </div>

        {/* Party Info Header */}
        <div className="mt-4 flex flex-col justify-between gap-3 border-b border-rule pb-4 sm:flex-row text-xs">
          <div>
            <p className="text-slate-500 font-semibold">গ্রাহক / পার্টির বিবরণ:</p>
            <p className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>{party.name}</span>
              {party.isOwnerSelfParty && (
                <span className="rounded bg-amber-100 border border-amber-300 px-1.5 py-0.2 text-[10px] text-amber-900 font-bold">
                  নিজস্ব পার্টি (নাহিদ হাসান)
                </span>
              )}
            </p>
            {party.phone && <p className="text-slate-600">মোবাইল: {party.phone}</p>}
            {party.address && <p className="text-slate-600">ঠিকানা: {party.address}</p>}
          </div>

          <div className="sm:text-right">
            <p className="text-slate-500 font-semibold">বিবরণী প্রদানের তারিখ:</p>
            <p className="font-bold text-slate-900">{formatDateTime(new Date())}</p>
            <p className="mt-1 text-slate-500">মোট লেনদেন সংখ্যা: <span className="font-bold text-slate-900">{entries.length} টি</span></p>
            <p className="text-xs text-red-700 font-bold mt-1">
              বর্তমান বকেয়া: ৳ {formatNumber(party.currentDue)}
            </p>
          </div>
        </div>

        {/* Ledger Table */}
        <div className="mt-4 overflow-x-auto">
          {entries.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              এই পার্টির কোনো লেনদেন বা বিল পাওয়া যায়নি।
            </div>
          ) : (
            <table className="table w-full text-xs">
              <thead>
                <tr className="border-b-2 border-slate-300 bg-slate-50 text-slate-700">
                  <th className="py-2">তারিখ</th>
                  <th className="py-2">রেফারেন্স / ভাউচার</th>
                  <th className="py-2">বিবরণ</th>
                  <th className="num py-2">ডেবিট (বিল) ৳</th>
                  <th className="num py-2">ক্রেডিট (জমা) ৳</th>
                  <th className="num py-2">ব্যালেন্স (বকেয়া) ৳</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="whitespace-nowrap py-2 text-slate-600">
                      {formatDateTime(entry.date)}
                    </td>
                    <td className="whitespace-nowrap font-mono font-semibold py-2">
                      {entry.link ? (
                        <Link
                          href={entry.link}
                          prefetch={false}
                          className="text-brand-600 hover:underline print:text-slate-900"
                        >
                          {entry.refNo}
                        </Link>
                      ) : (
                        <span className="text-slate-700">{entry.refNo}</span>
                      )}
                    </td>
                    <td className="py-2 text-slate-800">{entry.description}</td>
                    <td className="num py-2 font-semibold text-slate-900">
                      {entry.debit > 0 ? formatNumber(entry.debit) : "—"}
                    </td>
                    <td className="num py-2 font-semibold text-emerald-700">
                      {entry.credit > 0 ? formatNumber(entry.credit) : "—"}
                    </td>
                    <td className={`num py-2 font-bold ${entry.balance > 0 ? "text-red-700" : "text-emerald-700"}`}>
                      {formatNumber(entry.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-900 bg-slate-100 font-bold text-slate-900">
                  <td colSpan={3} className="py-2.5 text-right font-bold">
                    সর্বমোট:
                  </td>
                  <td className="num py-2.5 font-black text-slate-900">
                    ৳ {formatNumber(totalDebit)}
                  </td>
                  <td className="num py-2.5 font-black text-emerald-800">
                    ৳ {formatNumber(totalCredit)}
                  </td>
                  <td className={`num py-2.5 font-black ${party.currentDue > 0 ? "text-red-800" : "text-emerald-800"}`}>
                    ৳ {formatNumber(party.currentDue)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Footer Note */}
        <div className="mt-8 border-t border-rule pt-4 text-center text-xs text-slate-500">
          <p>{settings.invoiceFooterNote}</p>
        </div>

        {/* Signature Blocks (Print Only) */}
        <div className="mt-16 hidden print:grid grid-cols-2 text-center text-xs text-slate-700">
          <div>
            <div className="mx-auto w-44 border-t border-slate-700 pt-1 font-semibold">
              গ্রাহকের স্বাক্ষর
            </div>
          </div>
          <div>
            <div className="mx-auto w-44 border-t border-slate-700 pt-1 font-semibold">
              কর্তৃপক্ষের স্বাক্ষর
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
