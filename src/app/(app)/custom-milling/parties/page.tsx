import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { requireContext } from "@/server/auth";
import { getRiceMillSettings, resolveMillRole } from "@/lib/custom-milling";
import { createPartyAction } from "@/server/actions/custom-milling";
import { CustomMillingTabs } from "../custom-milling-ui";

export const metadata: Metadata = {
  title: "কাস্টম মিলিং পার্টি লেজার",
};

export default async function CustomMillingPartiesPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const settings = await getRiceMillSettings();
  const role = resolveMillRole(ctx, sp.role, settings);

  const parties = await prisma.millParty.findMany({
    orderBy: [{ isOwnerSelfParty: "desc" }, { name: "asc" }],
    include: {
      batches: {
        select: {
          id: true,
          totalBillAmount: true,
        },
      },
      vouchers: {
        where: { type: "RECEIPT" },
        select: {
          id: true,
          amount: true,
        },
      },
    },
  });

  const totalParties = parties.length;
  const totalDue = parties.reduce((sum, p) => sum + (p.currentDue || 0), 0);
  const ownerDue = parties
    .filter((p) => p.isOwnerSelfParty)
    .reduce((sum, p) => sum + (p.currentDue || 0), 0);
  const outsideDue = totalDue - ownerDue;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="কাস্টম মিলিং পার্টি লেজার (Party Ledgers)"
          description="ধান মাড়াই গ্রাহক ও নিজস্ব পার্টির লেনদেন, বিল ও বকেয়া হিসাব"
        />
      </div>

      <CustomMillingTabs role={role} />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-rule bg-white p-4 shadow-2xs">
          <p className="text-[11px] font-semibold text-slate-500">মোট নিবন্ধিত পার্টি</p>
          <p className="text-2xl font-black text-slate-900">{totalParties} জন</p>
          <span className="text-[10px] text-slate-400">কাস্টম মিলিং গ্রাহক</span>
        </div>

        <div className="rounded-xl border border-red-200 bg-red-50/70 p-4 shadow-2xs">
          <p className="text-[11px] font-semibold text-red-900">মোট বকেয়া পাওনা (Total Due)</p>
          <p className="text-2xl font-black text-red-950">৳ {formatNumber(totalDue)}</p>
          <span className="text-[10px] text-red-700">সকল পার্টি মিলিয়ে</span>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 shadow-2xs">
          <p className="text-[11px] font-semibold text-amber-900">নিজস্ব পার্টির বকেয়া (নাহিদ হাসান)</p>
          <p className="text-2xl font-black text-amber-950">৳ {formatNumber(ownerDue)}</p>
          <span className="text-[10px] text-amber-700">মূল ব্যবসায় সমন্বয়যোগ্য</span>
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 shadow-2xs">
          <p className="text-[11px] font-semibold text-blue-900">সাধারণ গ্রাহক বকেয়া</p>
          <p className="text-2xl font-black text-blue-950">৳ {formatNumber(outsideDue)}</p>
          <span className="text-[10px] text-blue-700">বহিরাগত পার্টিদের পাওনা</span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* New Party Creation Form (Disabled for MILL_PARTNER) */}
        {role !== "MILL_PARTNER" ? (
          <section className="panel p-4 sm:p-5">
            <div className="flex items-center gap-2 border-b border-rule pb-2 mb-4">
              <span className="text-lg">👥</span>
              <h2 className="panel-title">নতুন পার্টি যোগ করুন</h2>
            </div>

            <ActionForm action={createPartyAction} className="space-y-4">
              <Field label="পার্টির নাম (Party Name)" name="name">
                <input
                  id="name"
                  name="name"
                  placeholder="উদাঃ মেসার্স ভাই ভাই এন্টারপ্রাইজ / রহিম ব্যাপারী"
                  className="input"
                  required
                />
              </Field>

              <Field label="মোবাইল নম্বর" name="phone">
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  placeholder="017xxxxxxxx"
                  className="input"
                />
              </Field>

              <Field label="ঠিকানা" name="address">
                <input
                  id="address"
                  name="address"
                  placeholder="গ্রাম/বাজার, থানা, জেলা"
                  className="input"
                />
              </Field>

              <Field label="পূর্বের বকেয়া (Opening Balance)" name="openingBalance" hint="যদি পূর্বে কোনো পাওনা থাকে">
                <input
                  id="openingBalance"
                  name="openingBalance"
                  type="number"
                  step="0.01"
                  defaultValue="0"
                  placeholder="৳"
                  className="input-num"
                />
              </Field>

              {role === "SUPER_ADMIN" && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      name="isOwnerSelfParty"
                      className="mt-1 h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                    />
                    <div className="text-xs">
                      <span className="font-bold text-amber-950">
                        এটি মালিকের নিজস্ব অ্যাকাউন্ট (নাহিদ হাসান / আল্লাহ্‌র দান এন্টারপ্রাইজ)
                      </span>
                      <p className="text-[11px] text-amber-800 mt-0.5">
                        এই পার্টির বিলগুলো সরাসরি মূল ব্যবসার ড্যাশবোর্ডে ব্রিজ সিঙ্ক কার্ডে দেখানো হবে।
                      </p>
                    </div>
                  </label>
                </div>
              )}

              <SubmitButton pendingText="যোগ হচ্ছে…">
                ✓ পার্টি সংরক্ষণ করুন
              </SubmitButton>
            </ActionForm>
          </section>
        ) : (
          <section className="panel p-6 text-center text-slate-500">
            <span className="text-3xl">👀</span>
            <p className="mt-2 text-sm font-semibold text-slate-700">পার্টনার ভিউ (Read-Only)</p>
            <p className="text-xs text-slate-500 mt-1">
              আপনার অ্যাকাউন্টে শুধুমাত্র পার্টি ও লেজার দেখার অনুমতি রয়েছে।
            </p>
          </section>
        )}

        {/* Parties List Table */}
        <section className="panel lg:col-span-2">
          <div className="panel-head flex items-center justify-between">
            <h2 className="panel-title flex items-center gap-2">
              <span>📋</span>
              <span>পার্টি তালিকা ({parties.length})</span>
            </h2>
          </div>

          <div className="overflow-x-auto">
            {parties.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                কোনো পার্টি পাওয়া যায়নি।
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>পার্টির নাম ও যোগাযোগ</th>
                    <th>ব্যাচ সংখ্যা</th>
                    <th className="num">মোট বিল</th>
                    <th className="num">মোট পরিশোধ</th>
                    <th className="num">বর্তমান বাকি</th>
                    <th className="text-right">লেজার</th>
                  </tr>
                </thead>
                <tbody>
                  {parties.map((p) => {
                    const totalBilled = p.batches.reduce((sum, b) => sum + (b.totalBillAmount || 0), 0);
                    const totalPaid = p.vouchers.reduce((sum, v) => sum + (v.amount || 0), 0);

                    return (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="text-xs">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-ink-900">{p.name}</span>
                            {p.isOwnerSelfParty && (
                              <span className="rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                                👑 নিজস্ব পার্টি (নাহিদ হাসান)
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {p.phone && <span>📞 {p.phone} </span>}
                            {p.address && <span>📍 {p.address}</span>}
                          </div>
                        </td>
                        <td className="text-xs font-semibold text-slate-700">
                          {p.batches.length} টি ব্যাচ
                        </td>
                        <td className="num text-xs font-semibold text-slate-700">
                          ৳ {formatNumber(totalBilled)}
                        </td>
                        <td className="num text-xs font-semibold text-emerald-700">
                          ৳ {formatNumber(totalPaid)}
                        </td>
                        <td className={`num text-xs font-bold ${p.currentDue > 0 ? "text-red-700" : "text-emerald-700"}`}>
                          ৳ {formatNumber(p.currentDue)}
                        </td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Link
                              href={`/custom-milling/parties/${p.id}${sp.role ? `?role=${sp.role}` : ""}`}
                              prefetch={false}
                              className="btn-outline btn-sm text-xs font-semibold"
                            >
                              📖 লেজার
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
