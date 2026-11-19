import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDateTime, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { requireContext } from "@/server/auth";
import { getRiceMillSettings, resolveMillRole } from "@/lib/custom-milling";
import { updateBatchStatusAction, deleteBatchAction } from "@/server/actions/custom-milling";
import {
  BatchStatusBadge,
  CustomMillingTabs,
  MainSyncBadge,
} from "../../custom-milling-ui";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const batch = await prisma.millBatch.findUnique({ where: { id } });
  return { title: batch ? `ব্যাচ #${batch.batchNo} বিবরণ` : "ব্যাচ পাওয়া যায়নি" };
}

export default async function CustomMillingBatchDetailPage({
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <PageHeader
            title={`ধানের ব্যাচ #${batch.batchNo}`}
            description={`${formatDateTime(batch.date)} তারিখে ${batch.createdByName} কর্তৃক এন্ট্রি`}
          />
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/custom-milling/batches/${batch.id}/bill`}
            prefetch={false}
            className="btn-primary text-xs"
          >
            📄 বিলিং ও ডেলিভারি চালান
          </Link>
          <Link
            href="/custom-milling/batches"
            prefetch={false}
            className="btn-outline text-xs"
          >
            ← ব্যাচ তালিকা
          </Link>
        </div>
      </div>

      <CustomMillingTabs role={role} />

      {/* Status & Workflow Stage Bar */}
      <section className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">বর্তমান স্ট্যাটাস:</span>
            <BatchStatusBadge status={batch.status} />
            {batch.mainSyncStatus !== "NOT_APPLICABLE" && (
              <MainSyncBadge status={batch.mainSyncStatus} />
            )}
          </div>

          {/* Workflow Action Buttons (Disabled for MILL_PARTNER) */}
          {role !== "MILL_PARTNER" && (
            <div className="flex flex-wrap items-center gap-2">
              {batch.status === "RECEIVED" && (
                <ActionButton
                  action={updateBatchStatusAction.bind(null, batch.id, "IN_DRYER")}
                  label="🔥 ড্রায়ারে পাঠান (In Dryer)"
                  className="btn-secondary btn-sm text-xs font-semibold"
                />
              )}
              {batch.status === "IN_DRYER" && (
                <ActionButton
                  action={updateBatchStatusAction.bind(null, batch.id, "MILLED")}
                  label="⚙️ মিলিং সম্পন্ন চিহ্নিত করুন"
                  className="btn-secondary btn-sm text-xs font-semibold"
                />
              )}
              {batch.status === "MILLED" && (
                <ActionButton
                  action={updateBatchStatusAction.bind(null, batch.id, "DELIVERED")}
                  label="🚚 ডেলিভারি সম্পন্ন"
                  className="btn-secondary btn-sm text-xs font-semibold"
                />
              )}
              {role === "SUPER_ADMIN" && (
                <ActionButton
                  action={deleteBatchAction.bind(null, batch.id)}
                  label="মুছুন"
                  confirmText="আপনি কি নিশ্চিত এই ব্যাচটি মুছে ফেলতে চান?"
                  className="btn-danger btn-sm text-xs"
                />
              )}
            </div>
          )}
        </div>
      </section>

      {/* Main Specs & Weight Summary Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="panel p-4">
          <p className="text-xs font-semibold text-slate-500">পার্টির তথ্য</p>
          <p className="mt-1 text-base font-bold text-ink-900">{batch.party.name}</p>
          {batch.party.isOwnerSelfParty && (
            <span className="inline-block mt-0.5 rounded bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-900">
              ★ নিজস্ব পার্টি (নাহিদ হাসান)
            </span>
          )}
          {batch.party.phone && (
            <p className="text-xs text-slate-500 font-mono mt-1">{batch.party.phone}</p>
          )}
          {batch.party.address && (
            <p className="text-xs text-slate-400 mt-0.5">{batch.party.address}</p>
          )}
        </div>

        <div className="panel p-4">
          <p className="text-xs font-semibold text-slate-500">ধান ও গাড়ির তথ্য</p>
          <p className="mt-1 text-base font-bold text-ink-900">{batch.paddyType}</p>
          <p className="text-xs text-slate-600 mt-1">গাড়ি: {batch.vehicleNo || "উলেখ নেই"}</p>
          <p className="text-xs text-slate-500 mt-0.5">মোট বস্তা: <strong className="font-bold">{formatNumber(batch.physicalBags)}</strong> টি</p>
        </div>

        <div className="panel p-4">
          <p className="text-xs font-semibold text-slate-500">ওজন বিবরণ (কেজি)</p>
          <div className="mt-1 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">গ্রস ওজন:</span>
              <span className="font-mono">{formatNumber(batch.grossWeightKg)} kg</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>খালি গাড়ি:</span>
              <span className="font-mono">-{formatNumber(batch.tareWeightKg)} kg</span>
            </div>
            <div className="flex justify-between text-red-600">
              <span>ঢলতা:</span>
              <span className="font-mono">-{formatNumber(batch.dhaltaKg)} kg</span>
            </div>
            <div className="flex justify-between font-bold text-ink-900 border-t border-rule pt-1">
              <span>নেট ওজন:</span>
              <span className="font-mono">{formatNumber(batch.netWeightKg)} kg</span>
            </div>
          </div>
        </div>

        <div className="panel bg-brand-50/60 border-brand-200 p-4 text-center flex flex-col justify-center">
          <p className="text-xs font-bold text-brand-900 uppercase tracking-wide">
            ৭৫ কেজি স্ট্যান্ডার্ড বস্তা
          </p>
          <p className="text-4xl font-black text-brand-700 my-1">
            {formatNumber(batch.standardBags75Kg)}
          </p>
          <p className="text-[11px] text-brand-800 font-medium">
            (নেট {formatNumber(batch.netWeightKg)} কেজি ÷ ৭৫)
          </p>
        </div>
      </div>

      {/* Billing Summary Box */}
      <section className="panel">
        <div className="panel-head flex items-center justify-between">
          <h2 className="panel-title flex items-center gap-2">
            <span>💳</span>
            <span>বিলিং সারসংক্ষেপ</span>
          </h2>
          <Link
            href={`/custom-milling/batches/${batch.id}/bill`}
            prefetch={false}
            className="text-xs font-semibold text-brand-700 hover:underline"
          >
            {batch.totalBillAmount > 0 ? "বিল এডিট ও প্রিন্ট চালান ↗" : "+ বিল গণনা করুন ↗"}
          </Link>
        </div>

        <div className="p-4">
          {batch.totalBillAmount === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-slate-500">এই ব্যাচের বিল এখনো গণনা করা হয়নি।</p>
              <Link
                href={`/custom-milling/batches/${batch.id}/bill`}
                prefetch={false}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-brand-700"
              >
                <span>ড্রায়ার ও মিলিং বিল গণনা করুন</span>
              </Link>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-rule p-3 bg-slate-50">
                <p className="text-xs text-slate-500">ড্রায়ার শুকানো বিল</p>
                <p className="text-lg font-bold text-ink-900">৳ {formatNumber(batch.dryerFee)}</p>
                <span className="text-[11px] text-slate-400">@ ৳{batch.dryerRatePerBag}/বস্তা</span>
              </div>
              <div className="rounded-lg border border-rule p-3 bg-slate-50">
                <p className="text-xs text-slate-500">মিলিং প্রসেসিং বিল</p>
                <p className="text-lg font-bold text-ink-900">৳ {formatNumber(batch.millingFee)}</p>
                <span className="text-[11px] text-slate-400">@ ৳{batch.millingRatePerBag}/বস্তা</span>
              </div>
              <div className="rounded-lg border border-rule p-3 bg-slate-50">
                <p className="text-xs text-slate-500">উপজাত আয় (কুঁড়া/ভূসি)</p>
                <p className="text-lg font-bold text-ink-900">৳ {formatNumber(batch.byProductIncome)}</p>
                <span className="text-[11px] text-slate-400">কুঁড়া: {batch.branKg} kg · ভূসি: {batch.huskKg} kg</span>
              </div>
              <div className="rounded-lg border border-emerald-300 p-3 bg-emerald-50">
                <p className="text-xs font-bold text-emerald-900">সর্বমোট বিলিং টাকা</p>
                <p className="text-2xl font-black text-emerald-900">৳ {formatNumber(batch.totalBillAmount)}</p>
                <span className="text-[11px] text-emerald-700">উৎপাদিত চাল: {batch.riceOutputBags} বস্তা</span>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
