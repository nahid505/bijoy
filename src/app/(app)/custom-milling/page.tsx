import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDateTime, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { requireContext } from "@/server/auth";
import {
  calculateJVSettlement,
  getRiceMillSettings,
  resolveMillRole,
} from "@/lib/custom-milling";
import {
  BatchStatusBadge,
  CustomMillingTabs,
  MainSyncBadge,
} from "./custom-milling-ui";

export const metadata: Metadata = {
  title: "কাস্টম মিলিং (৬০:৪০ জেভি) ড্যাশবোর্ড",
};

export default async function CustomMillingDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const role = resolveMillRole(ctx, sp.role);
  const settings = await getRiceMillSettings();
  const jv = await calculateJVSettlement();

  // Today's Date Range (Dhaka timezone midnight to end of day)
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  // Today's batches count
  const todayBatches = await prisma.millBatch.findMany({
    where: { date: { gte: todayStart, lte: todayEnd } },
  });

  const todayPhysicalBags = todayBatches.reduce((sum, b) => sum + b.physicalBags, 0);
  const todayStd75Bags = todayBatches.reduce((sum, b) => sum + b.standardBags75Kg, 0);
  const inDryerBatches = await prisma.millBatch.count({ where: { status: "IN_DRYER" } });
  const inDryerBags = (
    await prisma.millBatch.findMany({
      where: { status: "IN_DRYER" },
      select: { standardBags75Kg: true },
    })
  ).reduce((sum, b) => sum + b.standardBags75Kg, 0);

  // Recent 5 batches
  const recentBatches = await prisma.millBatch.findMany({
    take: 6,
    orderBy: { createdAt: "desc" },
    include: { party: true },
  });

  // Recent 5 expenses
  const recentExpenses = await prisma.millExpense.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
  });

  // Pending Main Sync items count (For Nahid Hasan / Super Admin)
  const pendingSyncCount = await prisma.millBatch.count({
    where: { mainSyncStatus: "PENDING" },
  }) + await prisma.millExpense.count({
    where: { mainSyncStatus: "PENDING" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <PageHeader
            title={settings.millName}
            description={`${settings.millAddress} · ধান শুকানো, প্রসেসিং ও জব-ওয়ার্ক কাস্টম মিলিং`}
          />
        </div>
      </div>

      <CustomMillingTabs role={role} />

      {/* Quick Action Navigation Buttons */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5" aria-label="Quick Actions">
        {role !== "MILL_PARTNER" ? (
          <Link
            href="/custom-milling/batches/new"
            prefetch={false}
            className="flex items-center gap-2.5 rounded-xl border border-brand-600 bg-brand-600 px-4 py-3 text-sm font-bold text-white shadow-xs transition hover:bg-brand-700"
          >
            <span className="text-xl">⚖️</span>
            <span>নতুন ধান ও স্কেল</span>
          </Link>
        ) : (
          <Link
            href="/custom-milling/batches"
            prefetch={false}
            className="flex items-center gap-2.5 rounded-xl border border-rule bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
          >
            <span className="text-xl">⚖️</span>
            <span>ধানের ব্যাচ তালিকা</span>
          </Link>
        )}

        {role !== "MILL_PARTNER" && (
          <Link
            href="/custom-milling/expenses"
            prefetch={false}
            className="flex items-center gap-2.5 rounded-xl border border-rule bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-2xs transition hover:border-brand-500 hover:bg-brand-50"
          >
            <span className="text-xl">💸</span>
            <span>মিল খরচ এন্ট্রি</span>
          </Link>
        )}

        {role !== "MILL_PARTNER" && (
          <Link
            href="/custom-milling/vouchers"
            prefetch={false}
            className="flex items-center gap-2.5 rounded-xl border border-rule bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-2xs transition hover:border-brand-500 hover:bg-brand-50"
          >
            <span className="text-xl">💵</span>
            <span>বিল গ্রহণ / উত্তোলন</span>
          </Link>
        )}

        <Link
          href="/custom-milling/parties"
          prefetch={false}
          className="flex items-center gap-2.5 rounded-xl border border-rule bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-2xs transition hover:border-brand-500 hover:bg-brand-50"
        >
          <span className="text-xl">👥</span>
          <span>পার্টি লেজার তালিকা</span>
        </Link>

        {role !== "MILL_ACCOUNTANT" && (
          <Link
            href="/custom-milling/reports"
            prefetch={false}
            className="flex items-center gap-2.5 rounded-xl border border-rule bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-2xs transition hover:border-brand-500 hover:bg-brand-50"
          >
            <span className="text-xl">🤝</span>
            <span>৬০:৪০ পার্টনার হিসাব</span>
          </Link>
        )}
      </section>

      {/* Primary KPI Metrics: Today's Intake & Weighbridge Summary */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-4 shadow-2xs">
          <p className="text-xs font-semibold text-sky-800">আজকের ধান গ্রহণ (স্কেল)</p>
          <div className="mt-1 flex items-baseline justify-between">
            <p className="text-2xl font-extrabold text-sky-950">
              {formatNumber(todayPhysicalBags)} <span className="text-xs font-medium">বস্তা</span>
            </p>
            <span className="rounded-full bg-sky-200 px-2 py-0.5 text-[11px] font-bold text-sky-900">
              {todayBatches.length} টি গাড়ি
            </span>
          </div>
          <p className="mt-1 text-xs text-sky-700">
            স্ট্যান্ডার্ড (৭৫ কেজি): <strong className="font-bold">{formatNumber(todayStd75Bags)}</strong> বস্তা
          </p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 shadow-2xs">
          <p className="text-xs font-semibold text-amber-800">ড্রায়ারে চলমান (In Dryer)</p>
          <div className="mt-1 flex items-baseline justify-between">
            <p className="text-2xl font-extrabold text-amber-950">
              {formatNumber(inDryerBags)} <span className="text-xs font-medium">৭৫ কেজি বস্তা</span>
            </p>
            <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-bold text-amber-900">
              {inDryerBatches} ব্যাচ
            </span>
          </div>
          <p className="mt-1 text-xs text-amber-700">শুকানো শেষ হলে মিলিং ও ডেলিভারি হবে</p>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-2xs">
          <p className="text-xs font-semibold text-emerald-800">মিলের মোট রাজস্ব আয়</p>
          <div className="mt-1 flex items-baseline justify-between">
            <p className="text-2xl font-extrabold text-emerald-950">
              ৳ {formatNumber(jv.totalRevenue)}
            </p>
          </div>
          <p className="mt-1 text-xs text-emerald-700">
            বিলিং + নিজস্ব পার্টি + উপজাত (কুঁড়া/ভূসি)
          </p>
        </div>

        <div className="rounded-xl border border-purple-200 bg-purple-50/70 p-4 shadow-2xs">
          <p className="text-xs font-semibold text-purple-800">মিল ক্যাশ বুক স্থিতি (হাতে নগদ)</p>
          <div className="mt-1 flex items-baseline justify-between">
            <p className="text-2xl font-extrabold text-purple-950">
              ৳ {formatNumber(jv.millCashBalance)}
            </p>
            <Link
              href="/custom-milling/vouchers"
              prefetch={false}
              className="text-xs font-semibold text-purple-700 hover:underline"
            >
              ক্যাশ বিবরণী ↗
            </Link>
          </div>
          <p className="mt-1 text-xs text-purple-700">বিল আদায় - মিল ক্যাশ থেকে খরচ</p>
        </div>
      </section>

      {/* Joint Venture 60:40 Profit & Settlement Cards (Strictly HIDDEN from MILL_ACCOUNTANT) */}
      {role !== "MILL_ACCOUNTANT" ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">🤝</span>
              <h2 className="text-base font-bold text-ink-900">
                যৌথ উদ্যোগ পার্টনারশিপ লাভ-ক্ষতি ও চূড়ান্ত হিসাব (৬০% : ৪০%)
              </h2>
            </div>
            <Link
              href="/custom-milling/reports"
              prefetch={false}
              className="text-xs font-semibold text-brand-700 hover:underline"
            >
              বিস্তারিত পার্টনারশিপ রিপোর্ট ↗
            </Link>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Net Profit Summary */}
            <div className="panel p-4 space-y-2.5">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                নিট বণ্টনযোগ্য মুনাফা
              </p>
              <p className="text-3xl font-black text-ink-900">
                ৳ {formatNumber(jv.netProfit)}
              </p>
              <div className="space-y-1 text-xs text-slate-600 border-t border-rule pt-2">
                <div className="flex justify-between">
                  <span>মোট আয় (রাজস্ব):</span>
                  <span className="font-semibold text-emerald-700">৳ {formatNumber(jv.totalRevenue)}</span>
                </div>
                <div className="flex justify-between">
                  <span>মোট মিল খরচ:</span>
                  <span className="font-semibold text-red-700">৳ {formatNumber(jv.totalExpenses)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>মিলের মাসিক ভাড়া:</span>
                  <span>৳ {formatNumber(settings.monthlyRent)}/মাস</span>
                </div>
              </div>
            </div>

            {/* Partner 1: Nahid Hasan (60%) */}
            <div className="panel border-l-4 border-l-amber-500 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-amber-900">পার্টনার ১: {jv.partner1Name}</p>
                  <p className="text-[11px] text-slate-500">মালিক ও প্রধান ব্যবস্থাপক ({jv.partner1SharePct}%)</p>
                </div>
                <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                  {jv.partner1SharePct}% শেয়ার
                </span>
              </div>

              <div className="space-y-1.5 text-xs border-t border-rule pt-2">
                <div className="flex justify-between">
                  <span>৬০% লাভের অংশ:</span>
                  <strong className="text-ink-900">৳ {formatNumber(jv.partner1ShareAmount)}</strong>
                </div>
                <div className="flex justify-between text-emerald-700">
                  <span>পকেট থেকে দেওয়া খরচ (+):</span>
                  <span>৳ {formatNumber(jv.partner1OutOfPocket)}</span>
                </div>
                <div className="flex justify-between text-red-600">
                  <span>উত্তোলনকৃত টাকা (-):</span>
                  <span>৳ {formatNumber(jv.partner1Withdrawals)}</span>
                </div>
                <div className="flex justify-between border-t border-dashed border-slate-300 pt-1.5 text-sm font-extrabold text-amber-950">
                  <span>চূড়ান্ত নিষ্পত্তির বাকি:</span>
                  <span>৳ {formatNumber(jv.partner1NetSettlement)}</span>
                </div>
              </div>
            </div>

            {/* Partner 2 (40%) */}
            <div className="panel border-l-4 border-l-emerald-500 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-emerald-900">পার্টনার ২: {jv.partner2Name}</p>
                  <p className="text-[11px] text-slate-500">বিনিয়োগকারী পার্টনার ({jv.partner2SharePct}%)</p>
                </div>
                <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-900">
                  {jv.partner2SharePct}% শেয়ার
                </span>
              </div>

              <div className="space-y-1.5 text-xs border-t border-rule pt-2">
                <div className="flex justify-between">
                  <span>৪০% লাভের অংশ:</span>
                  <strong className="text-ink-900">৳ {formatNumber(jv.partner2ShareAmount)}</strong>
                </div>
                <div className="flex justify-between text-emerald-700">
                  <span>পকেট থেকে দেওয়া খরচ (+):</span>
                  <span>৳ {formatNumber(jv.partner2OutOfPocket)}</span>
                </div>
                <div className="flex justify-between text-red-600">
                  <span>উত্তোলনকৃত টাকা (-):</span>
                  <span>৳ {formatNumber(jv.partner2Withdrawals)}</span>
                </div>
                <div className="flex justify-between border-t border-dashed border-slate-300 pt-1.5 text-sm font-extrabold text-emerald-950">
                  <span>চূড়ান্ত নিষ্পত্তির বাকি:</span>
                  <span>৳ {formatNumber(jv.partner2NetSettlement)}</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Main Account Bridge Sync Alert for Super Admin (Nahid Hasan) */}
      {role === "SUPER_ADMIN" && pendingSyncCount > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xl text-white">
              🔄
            </span>
            <div>
              <p className="text-sm font-bold text-amber-950">
                {pendingSyncCount} টি লেনদেন মূল ব্যবসায় (Allahar Dan Enterprise) সিঙ্কের জন্য পেন্ডিং আছে
              </p>
              <p className="text-xs text-amber-800">
                নিজস্ব পার্টির ব্যাচ বিলিং ও পার্টনার ১ এর পকেট খরচের এন্ট্রি চেক করে মূল হিসাবে অন্তর্ভুক্ত করুন।
              </p>
            </div>
          </div>
          <Link
            href="/dashboard"
            prefetch={false}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-amber-700"
          >
            <span>মূল ড্যাশবোর্ডে সিঙ্ক দেখুন</span>
            <span>↗</span>
          </Link>
        </div>
      )}

      {/* Two Column Layout: Recent Batches & Recent Expenses */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Batches List */}
        <section className="panel lg:col-span-2">
          <div className="panel-head flex items-center justify-between">
            <h2 className="panel-title flex items-center gap-2">
              <span>🌾</span>
              <span>সাম্প্রতিক গৃহীত ধানের ব্যাচ (ওজন ও বিলিং)</span>
            </h2>
            <Link
              href="/custom-milling/batches"
              prefetch={false}
              className="text-xs font-semibold text-brand-700 hover:underline"
            >
              সব ব্যাচ ({recentBatches.length}) ↗
            </Link>
          </div>

          <div className="overflow-x-auto">
            {recentBatches.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                এখনো কোনো ধানের ব্যাচ এন্ট্রি করা হয়নি।
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>তারিখ ও ব্যাচ</th>
                    <th>পার্টি</th>
                    <th>ধানের জাত</th>
                    <th className="num">বস্তা</th>
                    <th className="num">৭৫ কেজি বস্তা</th>
                    <th>অবস্থা</th>
                    <th className="num">বিল</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recentBatches.map((b) => (
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
                        <span className="font-semibold">{b.party.name}</span>
                        {b.party.isOwnerSelfParty && (
                          <span className="ml-1 rounded bg-purple-100 px-1.5 py-0.2 text-[10px] font-bold text-purple-800">
                            নিজস্ব
                          </span>
                        )}
                        {b.vehicleNo && (
                          <span className="block text-[11px] text-slate-500">গাড়ি: {b.vehicleNo}</span>
                        )}
                      </td>
                      <td className="text-xs">{b.paddyType}</td>
                      <td className="num text-xs font-semibold">{formatNumber(b.physicalBags)}</td>
                      <td className="num text-xs font-extrabold text-ink-900">
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
                      <td className="num text-xs font-bold text-emerald-800">
                        {b.totalBillAmount > 0 ? `৳${formatNumber(b.totalBillAmount)}` : "—"}
                      </td>
                      <td className="text-right">
                        <Link
                          href={`/custom-milling/batches/${b.id}/bill`}
                          prefetch={false}
                          className="btn-outline btn-sm inline-flex items-center gap-1 text-xs"
                        >
                          <span>{b.totalBillAmount > 0 ? "বিল ও চালান" : "বিলিং"}</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Recent Expenses List */}
        <section className="panel">
          <div className="panel-head flex items-center justify-between">
            <h2 className="panel-title flex items-center gap-2">
              <span>💸</span>
              <span>সাম্প্রতিক মিল খরচ</span>
            </h2>
            <Link
              href="/custom-milling/expenses"
              prefetch={false}
              className="text-xs font-semibold text-brand-700 hover:underline"
            >
              সব খরচ ↗
            </Link>
          </div>

          <div className="p-3 divide-y divide-rule">
            {recentExpenses.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">কোনো খরচ রেকর্ড করা হয়নি।</p>
            ) : (
              recentExpenses.map((exp) => (
                <div key={exp.id} className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-ink-800">{exp.description}</p>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-0.5">
                      <span>{exp.category}</span>
                      <span>·</span>
                      <span className="rounded bg-slate-100 px-1 font-medium">
                        {exp.paidBy === "PARTNER_1" ? "পার্টনার ১" : exp.paidBy === "PARTNER_2" ? "পার্টনার ২" : "মিল ক্যাশ"}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-red-700">৳ {formatNumber(exp.amount)}</p>
                    <span className="text-[10px] text-slate-400">{new Date(exp.date).toLocaleDateString("bn-BD")}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
