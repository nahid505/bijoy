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
import { PaddyReceiptClient, ReceiptRowActions } from "./paddy-receipt-client";

export const metadata: Metadata = {
  title: "দৈনিক ধান প্রাপ্তি হিসাব রিপোর্ট - শুভংকর অটো রাইস মিল",
};

export default async function PaddyReceiptReportPage({
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

  const [receipts, parties] = await Promise.all([
    prisma.rentedMillPaddyReceipt.findMany({
      where: { date: { gte: dayStart, lte: dayEnd }, status: "APPROVED" },
      include: { party: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.rentedMillParty.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        phone: true,
        address: true,
        isSelfParty: true,
      },
    }),
  ]);

  const totalJuteBags = receipts.reduce((s, r) => s + (r.juteBags || 0), 0);
  const totalPlasticBags = receipts.reduce((s, r) => s + (r.plasticBags || 0), 0);
  const totalPhysicalBags = receipts.reduce((s, r) => s + r.bagsCount, 0);
  const totalGrossSkl = receipts.reduce((s, r) => s + r.sklWeight, 0);
  const totalDhalta = receipts.reduce((s, r) => s + (r.dhaltaKg || 0), 0);
  const totalNetSkl = receipts.reduce((s, r) => s + (r.netSklKg || r.sklWeight), 0);
  const totalStandardBags = receipts.reduce((s, r) => s + r.standardBags75kg, 0);
  const totalBillAmount = receipts.reduce((s, r) => s + (r.totalBillAmount || 0), 0);
  const totalMaunds = totalNetSkl > 0 ? (totalNetSkl / 40).toFixed(2) : "০.০০";

  return (
    <div className="space-y-6">
      {shouldAutoPrint && <AutoPrint />}
      <RentedMillTabs role={role} />

      {/* Controls & Filter */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-rule pb-4 no-print">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink-900">
            দৈনিক ধান প্রাপ্তি হিসাব রিপোর্ট
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500">
            {settings.millName}, {settings.millAddress} · তারিখ: <b>{getBengaliDateLabel(dayStart)}</b>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PaddyReceiptClient
            parties={parties}
            role={role}
            defaultMillingRate={settings.defaultMillingRate || 100}
          />
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
        title="দৈনিক ধান প্রাপ্তি হিসাব রিপোর্ট"
        subTitle={`হিসাবের তারিখ: ${getBengaliDateLabel(dayStart)}`}
      />

      {/* Main Table */}
      <div className="rounded-xl border border-rule bg-white shadow-2xs overflow-x-auto print:border-black print:rounded-none">
        <table className="w-full min-w-[850px] text-left text-xs print:text-[11px]">
          <thead>
            <tr className="border-b border-rule bg-slate-100/90 text-slate-800 print:border-black print:bg-slate-200 font-bold">
              <th className="py-2.5 px-2.5 w-10 text-center">ক্রমিক</th>
              <th className="py-2.5 px-2.5">রশিদ নং ও সময়</th>
              <th className="py-2.5 px-3">পার্টির নাম ও বিবরণ</th>
              <th className="py-2.5 px-2.5">ধানের নাম</th>
              <th className="py-2.5 px-2.5 text-right">বস্তা (চট + প্লা)</th>
              <th className="py-2.5 px-2.5 text-right">মোট SKL (কেজি)</th>
              <th className="py-2.5 px-2.5 text-right">ধলতা (কেজি)</th>
              <th className="py-2.5 px-2.5 text-right text-blue-900 font-black">নিট SKL (কেজি)</th>
              <th className="py-2.5 px-2.5 text-right">৭৫-এ স্ট্যান্ডার্ড বস্তা</th>
              <th className="py-2.5 px-2.5 text-right">দর (টাকা)</th>
              <th className="py-2.5 px-3 text-right text-emerald-800 font-black">মোট বিল (টাকা)</th>
              {role !== "PARTNER" && (
                <th className="py-2.5 px-2 text-center w-16 no-print">একশন</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 print:divide-black">
            {receipts.length === 0 ? (
              <tr>
                <td
                  colSpan={role !== "PARTNER" ? 12 : 11}
                  className="py-12 text-center text-slate-400 print:text-slate-600"
                >
                  নির্বাচিত তারিখে কোনো ধান প্রাপ্তির রেকর্ড পাওয়া যায়নি। উপরে <b>&ldquo;নতুন ধান গ্রহণ এন্ট্রি&rdquo;</b> বাটনে ক্লিক করে ধান গ্রহণ করুন।
                </td>
              </tr>
            ) : (
              receipts.map((r, idx) => {
                const netWeight = r.netSklKg > 0 ? r.netSklKg : r.sklWeight;
                const maundsForThis = (netWeight / 40).toFixed(1);
                return (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-2.5 text-center font-semibold text-slate-600 print:text-black">
                      {toBn(idx + 1)}
                    </td>
                    <td className="py-2.5 px-2.5">
                      <div className="font-mono font-bold text-ink-900">{r.receiptNo}</div>
                      <div className="text-[10px] text-slate-500">
                        {r.receiptTime ? toBn(r.receiptTime) : "—"}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-ink-900 print:text-black">
                        {r.party.name}
                        {r.party.isSelfParty && (
                          <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800 font-normal">
                            নিজস্ব
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 print:text-slate-700">
                        {r.party.address || "ঠিকানা উল্লেখ নেই"}
                        {r.party.phone ? ` · ${r.party.phone}` : ""}
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 font-semibold text-ink-800 print:text-black">
                      {r.paddyName}
                      {r.notes && (
                        <span className="block text-[10px] text-slate-400 print:text-slate-600 font-normal">
                          {r.notes}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-medium text-ink-900 print:text-black">
                      <div className="font-bold">{toBn(r.bagsCount)}</div>
                      <div className="text-[10px] text-slate-500">
                        (চট: {toBn(r.juteBags || 0)}, প্লা: {toBn(r.plasticBags || 0)})
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-bold text-slate-700 print:text-black">
                      {toBn(r.sklWeight.toLocaleString("bn-BD"))}
                    </td>
                    <td className="py-2.5 px-2.5 text-right text-amber-800 font-medium print:text-black">
                      {toBn((r.dhaltaKg || 0).toLocaleString("bn-BD"))}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-black text-blue-900 print:text-black">
                      <div>{toBn(netWeight.toLocaleString("bn-BD"))}</div>
                      <div className="text-[10px] text-slate-500 font-normal">
                        ({toBn(maundsForThis)} মণ)
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-bold text-brand-700 print:text-black">
                      {toBn(r.standardBags75kg.toFixed(2))}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-medium text-slate-700 print:text-black">
                      ৳{toBn(r.ratePerStandardBag || 100)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-black text-emerald-800 print:text-black">
                      {formatBnCurrency(r.totalBillAmount || 0)}
                    </td>
                    {role !== "PARTNER" && (
                      <td className="py-2.5 px-2 text-center no-print">
                        <ReceiptRowActions receipt={r} parties={parties} role={role} />
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-rule bg-slate-100 font-bold text-xs print:border-black print:bg-slate-200">
              <td colSpan={4} className="py-2.5 px-3 text-right">
                সর্বমোট:
              </td>
              <td className="py-2.5 px-2.5 text-right text-ink-900 print:text-black font-bold">
                <div>{toBn(totalPhysicalBags)} বস্তা</div>
                <div className="text-[10px] text-slate-500 font-normal">
                  (চট: {toBn(totalJuteBags)}, প্লা: {toBn(totalPlasticBags)})
                </div>
              </td>
              <td className="py-2.5 px-2.5 text-right text-slate-700 print:text-black font-bold">
                {toBn(totalGrossSkl.toLocaleString("bn-BD"))}
              </td>
              <td className="py-2.5 px-2.5 text-right text-amber-800 print:text-black font-bold">
                {toBn(totalDhalta.toFixed(1))}
              </td>
              <td className="py-2.5 px-2.5 text-right text-blue-900 print:text-black font-black">
                <div>{toBn(totalNetSkl.toLocaleString("bn-BD"))}</div>
                <div className="text-[10px] text-slate-500 font-normal">
                  ({toBn(totalMaunds)} মণ)
                </div>
              </td>
              <td className="py-2.5 px-2.5 text-right text-brand-700 print:text-black font-black">
                {toBn(totalStandardBags.toFixed(2))}
              </td>
              <td className="py-2.5 px-2.5 text-right text-slate-400">—</td>
              <td className="py-2.5 px-3 text-right text-emerald-800 print:text-black font-black text-sm">
                {formatBnCurrency(totalBillAmount)}
              </td>
              {role !== "PARTNER" && <td className="no-print"></td>}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Print Signatures */}
      <div className="hidden print:grid grid-cols-3 gap-8 pt-16 text-center text-xs text-black">
        <div>
          <div className="border-t border-black pt-1 font-semibold">
            স্কেল অপারেটরের স্বাক্ষর
          </div>
        </div>
        <div>
          <div className="border-t border-black pt-1 font-semibold">
            হিসাবরক্ষকের স্বাক্ষর
          </div>
        </div>
        <div>
          <div className="border-t border-black pt-1 font-semibold">
            মালিকের স্বাক্ষর
          </div>
        </div>
      </div>
    </div>
  );
}
