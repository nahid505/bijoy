import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDateTime, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { requireContext } from "@/server/auth";
import { resolveMillRole } from "@/lib/custom-milling";
import { deleteBatchAction, updateBatchStatusAction } from "@/server/actions/custom-milling";
import { ActionButton } from "@/components/forms";
import {
  BatchStatusBadge,
  CustomMillingTabs,
  MainSyncBadge,
} from "../custom-milling-ui";

export const metadata: Metadata = {
  title: "ধান গ্রহণ ও ওজন স্কেল তালিকা (Batches)",
};

export default async function CustomMillingBatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; role?: string }>;
}) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const role = resolveMillRole(ctx, sp.role);
  const q = sp.q?.trim();
  const status = sp.status?.trim();

  const where = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { batchNo: { contains: q, mode: "insensitive" as const } },
            { paddyType: { contains: q, mode: "insensitive" as const } },
            { vehicleNo: { contains: q, mode: "insensitive" as const } },
            { party: { name: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const batches = await prisma.millBatch.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { party: true },
  });

  const totalBags = batches.reduce((sum, b) => sum + b.physicalBags, 0);
  const totalStdBags = batches.reduce((sum, b) => sum + b.standardBags75Kg, 0);
  const totalBill = batches.reduce((sum, b) => sum + b.totalBillAmount, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="ধান গ্রহণ ও ওজন স্কেল (Weighbridge Batches)"
          description="গাড়ির মোট ওজন, খালি ওজন, ঢলতা ও ৭৫ কেজি স্ট্যান্ডার্ড বস্তা হিসাব"
        />
        {role !== "MILL_PARTNER" && (
          <Link
            href="/custom-milling/batches/new"
            prefetch={false}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-brand-700"
          >
            <span>+ নতুন ধান এন্ট্রি ও ওজন স্কেল</span>
          </Link>
        )}
      </div>

      <CustomMillingTabs role={role} />

      {/* Summary KPI Banner */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-xl border border-rule bg-white p-3.5 shadow-2xs">
        <div>
          <p className="text-[11px] font-semibold text-slate-500">মোট তালিকাভুক্ত ব্যাচ</p>
          <p className="text-xl font-bold text-ink-900">{batches.length} টি</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-slate-500">মোট বস্তা (Physical Bags)</p>
          <p className="text-xl font-bold text-ink-900">{formatNumber(totalBags)} টি</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-brand-700">৭৫ কেজি স্ট্যান্ডার্ড বস্তা</p>
          <p className="text-xl font-extrabold text-brand-800">{formatNumber(totalStdBags)} টি</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-slate-500">মোট বিলিং টাকা</p>
          <p className="text-xl font-bold text-emerald-800">৳ {formatNumber(totalBill)}</p>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="panel p-3">
        <form method="GET" className="flex flex-wrap items-center gap-2.5">
          {sp.role && <input type="hidden" name="role" value={sp.role} />}
          <div className="min-w-[200px] flex-1">
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="ব্যাচ নম্বর, পার্টির নাম, ধানের জাত বা গাড়ির নম্বর দিয়ে খুঁজুন..."
              className="input w-full"
            />
          </div>
          <select name="status" defaultValue={status ?? ""} className="input w-44">
            <option value="">সব অবস্থা (Status)</option>
            <option value="RECEIVED">ধান গৃহীত (স্কেল)</option>
            <option value="IN_DRYER">ড্রায়ারে চলমান</option>
            <option value="MILLED">মিলিং সম্পন্ন</option>
            <option value="DELIVERED">ডেলিভার্ড</option>
          </select>
          <button type="submit" className="btn-secondary">
            খুঁজুন
          </button>
          {(q || status) && (
            <Link href="/custom-milling/batches" prefetch={false} className="btn-outline">
              রিসেট
            </Link>
          )}
        </form>
      </div>

      {/* Batches Table */}
      <section className="panel">
        <div className="overflow-x-auto">
          {batches.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              কোনো ধানের ব্যাচ পাওয়া যায়নি।
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>তারিখ ও ব্যাচ</th>
                  <th>পার্টি</th>
                  <th>ধানের জাত / গাড়ি</th>
                  <th className="num">গ্রস ওজন</th>
                  <th className="num">খালি ওজন</th>
                  <th className="num">ঢলতা</th>
                  <th className="num">নেট ওজন</th>
                  <th className="num">৭৫ কেজি বস্তা</th>
                  <th>অবস্থা</th>
                  <th className="num">বিলিং</th>
                  <th className="text-right">অ্যাকশন</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="text-xs whitespace-nowrap">
                      <Link
                        href={`/custom-milling/batches/${b.id}`}
                        prefetch={false}
                        className="font-mono font-bold text-brand-700 hover:underline"
                      >
                        {b.batchNo}
                      </Link>
                      <span className="block text-[11px] text-slate-400">
                        {formatDateTime(b.date)}
                      </span>
                    </td>
                    <td className="text-xs">
                      <Link
                        href={`/custom-milling/parties/${b.partyId}`}
                        prefetch={false}
                        className="font-bold text-ink-800 hover:underline"
                      >
                        {b.party.name}
                      </Link>
                      {b.party.isOwnerSelfParty && (
                        <span className="ml-1 rounded bg-purple-100 px-1.5 py-0.2 text-[10px] font-bold text-purple-800">
                          নিজস্ব
                        </span>
                      )}
                      {b.party.phone && (
                        <span className="block text-[11px] text-slate-400 font-mono">{b.party.phone}</span>
                      )}
                    </td>
                    <td className="text-xs">
                      <span className="font-semibold text-ink-900">{b.paddyType}</span>
                      {b.vehicleNo && (
                        <span className="block text-[11px] text-slate-500">গাড়ি: {b.vehicleNo}</span>
                      )}
                    </td>
                    <td className="num text-xs font-mono">{formatNumber(b.grossWeightKg)} kg</td>
                    <td className="num text-xs font-mono text-slate-500">-{formatNumber(b.tareWeightKg)} kg</td>
                    <td className="num text-xs font-mono text-red-600">-{formatNumber(b.dhaltaKg)} kg</td>
                    <td className="num text-xs font-mono font-bold text-ink-900">
                      {formatNumber(b.netWeightKg)} kg
                    </td>
                    <td className="num text-xs font-black text-brand-800 bg-brand-50/50">
                      {formatNumber(b.standardBags75Kg)}
                    </td>
                    <td>
                      <BatchStatusBadge status={b.status} />
                      {b.mainSyncStatus !== "NOT_APPLICABLE" && (
                        <div className="mt-0.5">
                          <MainSyncBadge status={b.mainSyncStatus} />
                        </div>
                      )}
                    </td>
                    <td className="num text-xs font-extrabold text-emerald-800">
                      {b.totalBillAmount > 0 ? `৳${formatNumber(b.totalBillAmount)}` : "—"}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <Link
                          href={`/custom-milling/batches/${b.id}/bill`}
                          prefetch={false}
                          className="btn-outline btn-sm text-xs font-semibold"
                        >
                          {b.totalBillAmount > 0 ? "বিল ও প্রিন্ট" : "বিলিং"}
                        </Link>

                        {/* Super Admin Delete Option */}
                        {role === "SUPER_ADMIN" && (
                          <ActionButton
                            action={deleteBatchAction.bind(null, b.id)}
                            label="মুছুন"
                            confirmText="আপনি কি নিশ্চিত এই ব্যাচ রেকর্ডটি মুছে ফেলতে চান?"
                            className="btn-danger btn-sm text-xs"
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
