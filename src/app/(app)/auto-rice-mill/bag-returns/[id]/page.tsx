import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, toBnDigits } from "@/lib/format";
import { ActionButton } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { deleteBagReturnAction } from "@/server/actions/bag-return";
import { getBagReturnVoucher, getSupplierBagBalance } from "@/server/services/bag-tracking";
import { RICE_MILL_ACCESS } from "@/lib/rice-mill";

export const metadata: Metadata = { title: "বস্তা ফেরত চালান" };

export default async function BagReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission("auto_rice_mill:bag_return:view");
  const v = await getBagReturnVoucher(ctx.business.id, id);
  if (!v) notFound();

  const balance = await getSupplierBagBalance(ctx.business.id, v.supplierId);
  const totalReturned = v.returnedJuteBags + v.returnedPlasticBags;
  const canDelete = can(ctx, "auto_rice_mill:bag_return:create");

  return (
    <>
      <PageHeader
        title={`বস্তা ফেরত চালান: ${v.voucherNo}`}
        description={`${v.supplier.name}-কে খালি বস্তা ফেরত প্রদানের বিবরণ`}
        crumbs={[
          { label: "অটো রাইস মিল", href: "/purchases/paddy" },
          { label: "খালি বস্তা ফেরত", href: "/auto-rice-mill/bag-returns" },
          { label: v.voucherNo },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              prefetch={false}
              href={`/auto-rice-mill/bag-returns/${v.id}/print`}
              className="btn-primary flex items-center gap-1.5"
            >
              <span>🖨</span>
              <span>চালান প্রিন্ট করুন</span>
            </Link>
            <Link prefetch={false} href="/auto-rice-mill/bag-returns" className="btn-secondary">
              ← তালিকায় ফিরুন
            </Link>
            {canDelete && (
              <ActionButton
                action={deleteBagReturnAction.bind(null, v.id)}
                label="মুছুন"
                className="btn-danger"
                confirmText={`বস্তা ফেরত চালান ${v.voucherNo} মুছে ফেলতে চান?`}
              />
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel p-5 lg:col-span-2 space-y-5">
          <div className="flex flex-wrap items-center justify-between border-b border-rule pb-3">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">চালান নম্বর</p>
              <h2 className="text-xl font-bold text-ink-900">{v.voucherNo}</h2>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">তারিখ</p>
              <p className="text-sm font-semibold text-ink-900">{formatDate(v.date)}</p>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">সরবরাহকারীর তথ্য</h3>
            <div className="rounded-lg border border-rule bg-ink-50 p-3">
              <p className="text-base font-bold text-ink-900">
                <Link
                  prefetch={false}
                  href={`/suppliers/${v.supplier.id}/ledger`}
                  className="hover:text-brand-700 hover:underline"
                >
                  {v.supplier.name}
                </Link>
              </p>
              {v.supplier.mobile && <p className="text-xs text-slate-600 mt-0.5">📞 {v.supplier.mobile}</p>}
              {v.supplier.address && <p className="text-xs text-slate-600">📍 {v.supplier.address}</p>}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">ফেরতকৃত খালি বস্তার বিবরণ</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 text-center">
                <span className="text-xs font-semibold text-amber-900">চটের বস্তা ফেরত</span>
                <p className="mt-1 text-3xl font-black text-amber-950 tabular-nums">
                  {toBnDigits(v.returnedJuteBags)} <span className="text-sm font-normal text-amber-800">টি</span>
                </p>
              </div>

              <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-4 text-center">
                <span className="text-xs font-semibold text-blue-900">প্লাস্টিক বস্তা ফেরত</span>
                <p className="mt-1 text-3xl font-black text-blue-950 tabular-nums">
                  {toBnDigits(v.returnedPlasticBags)} <span className="text-sm font-normal text-blue-800">টি</span>
                </p>
              </div>

              <div className="rounded-lg border-2 border-emerald-400 bg-emerald-50 p-4 text-center">
                <span className="text-xs font-semibold text-emerald-900">মোট ফেরত বস্তা</span>
                <p className="mt-1 text-3xl font-black text-emerald-950 tabular-nums">
                  {toBnDigits(totalReturned)} <span className="text-sm font-normal text-emerald-800">টি</span>
                </p>
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">পরিবহন ও চালান তথ্য</h3>
            <dl className="grid gap-2 rounded-lg border border-rule p-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-500">ড্রাইভারের নাম</dt>
                <dd className="font-semibold text-ink-900">{v.driverName || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">গাড়ি নম্বর</dt>
                <dd className="font-semibold text-ink-900">{v.vehicleNo || "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500">মন্তব্য / নোট</dt>
                <dd className="whitespace-pre-line text-ink-800">{v.note || "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="pt-2 text-xs text-slate-400 flex justify-between">
            <span>তৈরি করেছেন: {v.createdBy.name}</span>
            <span>তৈরির সময়: {v.createdAt.toLocaleString("bn-BD")}</span>
          </div>
        </section>

        {/* সাইডবারে সরবরাহকারীর বর্তমান অবশিষ্ট পাওনা সামারি */}
        <section className="space-y-4">
          <div className="panel p-4 border-2 border-amber-300 bg-amber-50/50">
            <h3 className="text-sm font-bold text-amber-950 mb-1">📦 বর্তমান অবশিষ্ট বস্তা পাওনা</h3>
            <p className="text-xs text-amber-800 mb-3">এই ফেরত চালানের পর সরবরাহকারীর মোট পাওনা ব্যালেন্স</p>

            <div className="space-y-2">
              <div className="flex justify-between rounded bg-white p-2.5 border border-amber-200">
                <span className="text-xs text-slate-600">অবশিষ্ট চটের বস্তা:</span>
                <span className="font-bold text-ink-900 tabular-nums">{toBnDigits(balance.dueJuteBags)} টি</span>
              </div>
              <div className="flex justify-between rounded bg-white p-2.5 border border-amber-200">
                <span className="text-xs text-slate-600">অবশিষ্ট প্লাস্টিক বস্তা:</span>
                <span className="font-bold text-ink-900 tabular-nums">{toBnDigits(balance.duePlasticBags)} টি</span>
              </div>
              <div className="flex justify-between rounded bg-amber-100 p-2.5 border border-amber-300 font-bold text-amber-950">
                <span className="text-xs">সর্বমোট অবশিষ্ট পাওনা:</span>
                <span className="text-base tabular-nums">{toBnDigits(balance.dueTotalBags)} টি</span>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-amber-200/60 text-[11px] text-slate-500 space-y-1">
              <p>• মোট গৃহীত: চট {toBnDigits(balance.receivedJuteBags)}, প্লাস্টিক {toBnDigits(balance.receivedPlasticBags)}</p>
              <p>• মোট ফেরত: চট {toBnDigits(balance.returnedJuteBags)}, প্লাস্টিক {toBnDigits(balance.returnedPlasticBags)}</p>
            </div>

            <div className="mt-4">
              <Link
                prefetch={false}
                href={`/suppliers/${v.supplier.id}/ledger`}
                className="btn-secondary w-full text-center text-xs"
              >
                সরবরাহকারী খতিয়ান দেখুন
              </Link>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
