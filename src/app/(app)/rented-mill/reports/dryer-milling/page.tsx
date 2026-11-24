import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireContext } from "@/server/auth";
import {
  getRentedMillSettings,
  resolveRentedMillRole,
  parseDryerNames,
} from "@/lib/rented-mill";
import { getBengaliDateLabel, toBn } from "@/lib/format";
import {
  AutoPrint,
  PrintButton,
  RentedMillTabs,
  ReportPrintHeader,
} from "../../rented-mill-ui";
import { DryerMillingClient, DryerMillingRowActions } from "./dryer-milling-client";

export const metadata: Metadata = {
  title: "দৈনিক ডায়ার / ছাটাই রিপোর্ট - শুভংকর অটো রাইস মিল",
};

export default async function DryerMillingReportPage({
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

  // Fetch entries on the selected date
  const [entries, allParties] = await Promise.all([
    prisma.rentedMillDryerMilling.findMany({
      where: { date: { gte: dayStart, lte: dayEnd }, status: "APPROVED" },
      include: { party: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.rentedMillParty.findMany({
      include: {
        paddyReceipts: { where: { status: "APPROVED" }, select: { standardBags75kg: true } },
        dryerMillings: { where: { status: "APPROVED" }, select: { usedBags: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  // Compute party current stock (Total standard bags received - total bags milled)
  const partyStockMap = new Map<string, number>();
  const partiesForClient = allParties.map((p) => {
    const totalReceived = p.paddyReceipts.reduce((s, r) => s + r.standardBags75kg, 0);
    const totalUsed = p.dryerMillings.reduce((s, m) => s + m.usedBags, 0);
    const stock = Math.max(0, totalReceived - totalUsed);
    partyStockMap.set(p.id, stock);
    return {
      id: p.id,
      name: p.name,
      isSelfParty: p.isSelfParty,
      currentStockBags: stock,
    };
  });

  const totalUsedBags = entries.reduce((s, e) => s + e.usedBags, 0);
  const totalMilledKg = entries.reduce((s, e) => s + e.milledKg, 0);
  const dryerNames = parseDryerNames(settings.dryerNames);

  return (
    <div className="space-y-6">
      {shouldAutoPrint && <AutoPrint />}
      <RentedMillTabs role={role} />

      {/* Screen Controls & Date Selector */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-rule pb-4 no-print">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink-900">
            দৈনিক ডায়ার / ছাটাই রিপোর্ট
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500">
            {settings.millName}, {settings.millAddress} · তারিখ: <b>{getBengaliDateLabel(dayStart)}</b>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DryerMillingClient
            parties={partiesForClient}
            role={role}
            dryerNames={parseDryerNames(settings.dryerNames)}
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
        title="দৈনিক ডায়ার / ছাটাই রিপোর্ট"
        subTitle={`হিসাবের তারিখ: ${getBengaliDateLabel(dayStart)}`}
      />

      {/* Main Table */}
      <div className="rounded-xl border border-rule bg-white shadow-2xs overflow-hidden print:border-black print:rounded-none">
        <table className="w-full text-left text-xs print:text-xs">
          <thead>
            <tr className="border-b border-rule bg-slate-100/90 text-slate-800 print:border-black print:bg-slate-200 font-bold">
              <th className="py-2.5 px-3 w-12 text-center">ক্রমিক নং</th>
              <th className="py-2.5 px-3">পার্টির নাম</th>
              <th className="py-2.5 px-3 text-center">ডায়ার নং</th>
              <th className="py-2.5 px-3 text-right">ব্যবহৃত বস্তার সংখ্যা</th>
              <th className="py-2.5 px-3 text-right">ছাটাইকৃত কেজি</th>
              <th className="py-2.5 px-3 text-right">বর্তমান মজুদ (বস্তা)</th>
              {role !== "PARTNER" && (
                <th className="py-2.5 px-3 text-center w-16 no-print">একশন</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 print:divide-black">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={role !== "PARTNER" ? 7 : 6} className="py-12 text-center text-slate-400 print:text-slate-600">
                  নির্বাচিত তারিখে কোনো ডায়ার / ছাটাই এন্ট্রি নেই। উপরে <b>&ldquo;নতুন ডায়ার / ছাটাই এন্ট্রি&rdquo;</b> বাটনে ক্লিক করে তথ্য যোগ করুন।
                </td>
              </tr>
            ) : (
              entries.map((item, idx) => {
                const stock = partyStockMap.get(item.partyId) ?? 0;
                return (
                  <tr key={item.id} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3 text-center font-semibold text-slate-600 print:text-black">
                      {toBn(idx + 1)}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-ink-900 print:text-black">
                      {item.party.name}
                      {item.party.isSelfParty && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800 font-normal">
                          নিজস্ব
                        </span>
                      )}
                      {item.notes && (
                        <span className="block text-[10px] text-slate-400 print:text-slate-600 font-normal">
                          {item.notes}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-800 print:bg-transparent print:p-0 print:text-black">
                        {item.dryerNo}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-amber-900 print:text-black">
                      {toBn(item.usedBags.toFixed(2))}
                    </td>
                    <td className="py-2.5 px-3 text-right font-black text-emerald-700 print:text-black">
                      {toBn(item.milledKg.toLocaleString("bn-BD"))} কেজি
                    </td>
                    <td className="py-2.5 px-3 text-right font-extrabold text-brand-700 print:text-black">
                      {toBn(stock.toFixed(2))} বস্তা
                    </td>
                    {role !== "PARTNER" && (
                      <td className="py-2.5 px-3 text-center no-print">
                        <DryerMillingRowActions
                          entry={item}
                          parties={allParties}
                          dryerNames={dryerNames}
                          role={role}
                        />
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-rule bg-slate-100 font-bold text-xs print:border-black print:bg-slate-200">
              <td colSpan={3} className="py-2.5 px-3 text-right">
                সর্বমোট:
              </td>
              <td className="py-2.5 px-3 text-right text-amber-950 print:text-black font-extrabold text-sm">
                {toBn(totalUsedBags.toFixed(2))} বস্তা
              </td>
              <td className="py-2.5 px-3 text-right text-emerald-800 print:text-black font-extrabold text-sm">
                {toBn(totalMilledKg.toLocaleString("bn-BD"))} কেজি
              </td>
              <td className="py-2.5 px-3 text-right text-slate-600 print:text-black">
                (পার্টিভিত্তিক মজুদ)
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
            ডায়ার ইনচার্জের স্বাক্ষর
          </div>
        </div>
        <div>
          <div className="border-t border-black pt-1 font-semibold">
            মিলিং সুপারের স্বাক্ষর
          </div>
        </div>
        <div>
          <div className="border-t border-black pt-1 font-semibold">
            ম্যানেজার / মালিকের স্বাক্ষর
          </div>
        </div>
      </div>
    </div>
  );
}
