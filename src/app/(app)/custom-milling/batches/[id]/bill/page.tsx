import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDateTime, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { requireContext } from "@/server/auth";
import { getRiceMillSettings, resolveMillRole } from "@/lib/custom-milling";
import { CustomMillingTabs } from "../../../custom-milling-ui";
import { BillingForm } from "./billing-form";
import { PrintButton } from "./print-button";

export const metadata: Metadata = {
  title: "কাস্টম মিলিং বিলিং ও ডেলিভারি চালান",
};

export default async function CustomMillingBillingPage({
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

  const batch = await prisma.millBatch.findUnique({
    where: { id },
    include: { party: true },
  });

  if (!batch) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between no-print">
        <PageHeader
          title={`বিলিং ও চালান — ব্যাচ #${batch.batchNo}`}
          description={`${batch.party.name} · ${batch.paddyType} · ৭৫ কেজি স্ট্যান্ডার্ড বস্তা: ${batch.standardBags75Kg}`}
        />
        <div className="flex items-center gap-2">
          <PrintButton />
          <Link
            href={`/custom-milling/batches/${batch.id}`}
            prefetch={false}
            className="btn-outline text-xs"
          >
            ← ব্যাচ বিবরণ
          </Link>
        </div>
      </div>

      <div className="no-print">
        <CustomMillingTabs role={role} />
      </div>

      {/* Billing Input Form (Screen Only) */}
      <section className="panel p-4 sm:p-6 no-print">
        <div className="flex items-center justify-between border-b border-rule pb-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">💳</span>
            <h2 className="text-base font-bold text-ink-900">
              ড্রায়ার ও মিলিং বিলিং ক্যালকুলেটর ({batch.standardBags75Kg} স্ট্যান্ডার্ড বস্তা)
            </h2>
          </div>
          <span className="text-xs font-semibold text-brand-700 bg-brand-50 px-2.5 py-1 rounded-md">
            ১ বস্তা = {settings.bagStandardKg} কেজি
          </span>
        </div>

        <BillingForm
          batch={batch}
          defaultDryerRate={settings.defaultDryerRate}
          defaultMillingRate={settings.defaultMillingRate}
          defaultBranRate={settings.branRatePerKg}
          defaultHuskRate={settings.huskRatePerKg}
          role={role}
        />
      </section>

      {/* Printable Delivery Challan / Invoice (Screen preview & Print) */}
      <div className="printable-challan-wrapper">
        <div className="mx-auto max-w-[800px] rounded-xl border border-slate-300 bg-white p-6 sm:p-8 shadow-xs print:m-0 print:max-w-none print:border-none print:p-2 print:shadow-none">
          {/* Challan Header */}
          <div className="border-b-2 border-slate-900 pb-4 text-center">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">{settings.millName}</h1>
            <p className="text-xs sm:text-sm text-slate-600 mt-1">{settings.millAddress}</p>
            <p className="text-xs text-slate-600 font-mono">মোবাইল: {settings.millPhone}</p>
            <div className="mt-2 inline-block rounded-full bg-slate-900 px-4 py-1 text-xs font-bold uppercase tracking-wider text-white">
              ধান শুকানো, মিলিং ও ডেলিভারি চালান / ক্যাশ মেমো
            </div>
          </div>

          {/* Challan Meta */}
          <div className="mt-4 grid grid-cols-2 gap-4 text-xs border-b border-slate-200 pb-4">
            <div>
              <p><span className="text-slate-500">চালান / ব্যাচ নং:</span> <strong className="font-mono text-sm">{batch.batchNo}</strong></p>
              <p className="mt-1"><span className="text-slate-500">তারিখ:</span> <strong>{formatDateTime(batch.date)}</strong></p>
              <p className="mt-1"><span className="text-slate-500">গাড়ি / ট্রলি নং:</span> <strong>{batch.vehicleNo || "—"}</strong></p>
            </div>
            <div className="text-right">
              <p><span className="text-slate-500">পার্টির নাম:</span> <strong className="text-sm">{batch.party.name}</strong></p>
              {batch.party.phone && <p className="mt-1"><span className="text-slate-500">মোবাইল:</span> <span className="font-mono">{batch.party.phone}</span></p>}
              {batch.party.address && <p className="mt-1"><span className="text-slate-500">ঠিকানা:</span> {batch.party.address}</p>}
            </div>
          </div>

          {/* Weight & Bag Calculation Table */}
          <div className="mt-4">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">১. স্কেল ও ওজন বিবরণ:</h4>
            <table className="w-full text-xs border border-slate-300">
              <thead className="bg-slate-100 text-slate-800">
                <tr>
                  <th className="border border-slate-300 p-2 text-left">ধানের জাত</th>
                  <th className="border border-slate-300 p-2 text-right">মোট বস্তা</th>
                  <th className="border border-slate-300 p-2 text-right">মোট ওজন (Gross)</th>
                  <th className="border border-slate-300 p-2 text-right">খালি গাড়ি (Tare)</th>
                  <th className="border border-slate-300 p-2 text-right">ঢলতা (Dhalta)</th>
                  <th className="border border-slate-300 p-2 text-right">নেট ওজন</th>
                  <th className="border border-slate-300 p-2 text-right bg-slate-200 font-bold">৭৫ কেজি স্ট্যান্ডার্ড বস্তা</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-slate-300 p-2 font-semibold">{batch.paddyType}</td>
                  <td className="border border-slate-300 p-2 text-right">{formatNumber(batch.physicalBags)} টি</td>
                  <td className="border border-slate-300 p-2 text-right font-mono">{formatNumber(batch.grossWeightKg)} kg</td>
                  <td className="border border-slate-300 p-2 text-right font-mono text-slate-500">-{formatNumber(batch.tareWeightKg)} kg</td>
                  <td className="border border-slate-300 p-2 text-right font-mono text-red-600">-{formatNumber(batch.dhaltaKg)} kg</td>
                  <td className="border border-slate-300 p-2 text-right font-mono font-bold">{formatNumber(batch.netWeightKg)} kg</td>
                  <td className="border border-slate-300 p-2 text-right font-mono font-black text-sm bg-slate-100">
                    {formatNumber(batch.standardBags75Kg)} বস্তা
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Billing & Processing Table */}
          <div className="mt-5">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">২. ড্রায়ার, মিলিং ও উপজাত বিলিং:</h4>
            <table className="w-full text-xs border border-slate-300">
              <thead className="bg-slate-100 text-slate-800">
                <tr>
                  <th className="border border-slate-300 p-2 text-left">বিবরণ</th>
                  <th className="border border-slate-300 p-2 text-center">পরিমাণ / স্ট্যান্ডার্ড বস্তা</th>
                  <th className="border border-slate-300 p-2 text-right">দর (টাকা)</th>
                  <th className="border border-slate-300 p-2 text-right">মোট টাকা</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-slate-300 p-2">ধান ড্রায়ারে শুকানো ফি (Dryer Fee)</td>
                  <td className="border border-slate-300 p-2 text-center">{batch.standardBags75Kg} বস্তা</td>
                  <td className="border border-slate-300 p-2 text-right font-mono">৳ {batch.dryerRatePerBag}</td>
                  <td className="border border-slate-300 p-2 text-right font-mono font-semibold">৳ {formatNumber(batch.dryerFee)}</td>
                </tr>
                <tr>
                  <td className="border border-slate-300 p-2">ধান মিলিং প্রসেসিং ফি (Milling Fee)</td>
                  <td className="border border-slate-300 p-2 text-center">{batch.standardBags75Kg} বস্তা</td>
                  <td className="border border-slate-300 p-2 text-right font-mono">৳ {batch.millingRatePerBag}</td>
                  <td className="border border-slate-300 p-2 text-right font-mono font-semibold">৳ {formatNumber(batch.millingFee)}</td>
                </tr>
                {batch.byProductIncome > 0 && (
                  <tr>
                    <td className="border border-slate-300 p-2">মিলের উপজাত গ্রহণ (কুঁড়া {batch.branKg} kg + তুষ {batch.huskKg} kg)</td>
                    <td className="border border-slate-300 p-2 text-center">মিল আয়</td>
                    <td className="border border-slate-300 p-2 text-right font-mono">—</td>
                    <td className="border border-slate-300 p-2 text-right font-mono font-semibold">৳ {formatNumber(batch.byProductIncome)}</td>
                  </tr>
                )}
                {batch.riceOutputBags > 0 && (
                  <tr className="bg-emerald-50/50">
                    <td className="border border-slate-300 p-2 font-bold text-emerald-900" colSpan={3}>
                      ডেলিভারিকৃত চালের সংখ্যা:
                    </td>
                    <td className="border border-slate-300 p-2 text-right font-bold text-emerald-950 font-mono">
                      {batch.riceOutputBags} বস্তা
                    </td>
                  </tr>
                )}
                <tr className="bg-slate-100 font-bold text-sm">
                  <td className="border border-slate-300 p-2.5" colSpan={3}>সর্বমোট প্রদেয় বিলিং টাকা:</td>
                  <td className="border border-slate-300 p-2.5 text-right font-mono text-base font-black text-slate-950">
                    ৳ {formatNumber(batch.totalBillAmount)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Footer Note */}
          <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-2.5 text-center text-xs text-slate-600 font-medium italic">
            {settings.invoiceFooterNote}
          </div>

          {/* Signatures */}
          <div className="mt-12 grid grid-cols-2 gap-8 text-xs text-center">
            <div className="border-t border-slate-400 pt-2">
              <p className="font-semibold text-slate-800">কাস্টমার / পার্টির স্বাক্ষর</p>
              <p className="text-[10px] text-slate-400">মাল বুঝিয়া পাইলাম</p>
            </div>
            <div className="border-t border-slate-400 pt-2">
              <p className="font-semibold text-slate-800">মিল কর্তৃপক্ষের স্বাক্ষর</p>
              <p className="text-[10px] text-slate-400 font-mono">{batch.createdByName}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
