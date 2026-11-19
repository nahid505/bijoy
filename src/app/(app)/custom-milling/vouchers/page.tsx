import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { formatDateTime, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms";
import { requireContext } from "@/server/auth";
import { calculateJVSettlement, getRiceMillSettings, resolveMillRole } from "@/lib/custom-milling";
import { createVoucherAction, deleteVoucherAction } from "@/server/actions/custom-milling";
import { CustomMillingTabs } from "../custom-milling-ui";

export const metadata: Metadata = {
  title: "মিল ক্যাশ বুক ও ভাউচার (কাস্টম মিলিং)",
};

export default async function CustomMillingVouchersPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const settings = await getRiceMillSettings();
  const role = resolveMillRole(ctx, sp.role, settings);
  const jv = await calculateJVSettlement();

  const parties = await prisma.millParty.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, phone: true, currentDue: true, isOwnerSelfParty: true },
  });

  const vouchers = await prisma.millVoucher.findMany({
    orderBy: { date: "desc" },
    include: { party: true },
  });

  const totalReceipts = vouchers
    .filter((v) => v.type === "RECEIPT")
    .reduce((sum, v) => sum + v.amount, 0);

  const totalWithdrawals = vouchers
    .filter((v) => v.type === "PAYMENT")
    .reduce((sum, v) => sum + v.amount, 0);

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="মিল ক্যাশ বুক ও ভাউচার (Cashbook & Vouchers)"
          description="কাস্টমারদের বিল আদায় ও পার্টনারদের লাভ/টাকা উত্তোলনের হিসাব"
        />
      </div>

      <CustomMillingTabs role={role} />

      {/* KPI Balances */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-purple-200 bg-purple-50/70 p-4 shadow-2xs">
          <p className="text-[11px] font-semibold text-purple-900">মিল ক্যাশ স্থিতি (হাতে নগদ)</p>
          <p className="text-2xl font-black text-purple-950">৳ {formatNumber(jv.millCashBalance)}</p>
          <span className="text-[10px] text-purple-700">আদায় + উপজাত - মিল ক্যাশ খরচ - উত্তোলন</span>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-2xs">
          <p className="text-[11px] font-semibold text-emerald-900">মোট পার্টি বিল আদায় (Receipts)</p>
          <p className="text-2xl font-black text-emerald-950">৳ {formatNumber(totalReceipts)}</p>
          <span className="text-[10px] text-emerald-700">কাস্টমারদের থেকে সংগৃহীত</span>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 shadow-2xs">
          <p className="text-[11px] font-semibold text-amber-900">পার্টনার ১ (নাহিদ হাসান) উত্তোলন</p>
          <p className="text-2xl font-black text-amber-950">৳ {formatNumber(jv.partner1Withdrawals)}</p>
          <span className="text-[10px] text-amber-700">লাভ/তহবিল থেকে গৃহীত</span>
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 shadow-2xs">
          <p className="text-[11px] font-semibold text-blue-900">পার্টনার ২ (৪০%) উত্তোলন</p>
          <p className="text-2xl font-black text-blue-950">৳ {formatNumber(jv.partner2Withdrawals)}</p>
          <span className="text-[10px] text-blue-700">লাভ/তহবিল থেকে গৃহীত</span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* New Voucher Entry Form (Disabled for MILL_PARTNER) */}
        {role !== "MILL_PARTNER" ? (
          <section className="panel p-4 sm:p-5">
            <div className="flex items-center gap-2 border-b border-rule pb-2 mb-4">
              <span className="text-lg">💵</span>
              <h2 className="panel-title">নতুন ভাউচার এন্ট্রি</h2>
            </div>

            <ActionForm action={createVoucherAction} className="space-y-4">
              <Field
                label="তারিখ"
                name="date"
                hint={role === "MILL_ACCOUNTANT" ? "হিসাবরক্ষক হিসেবে আজকের তারিখ লক করা" : undefined}
              >
                <input
                  id="date"
                  name="date"
                  type="date"
                  defaultValue={todayStr}
                  readOnly={role === "MILL_ACCOUNTANT"}
                  className={`input ${role === "MILL_ACCOUNTANT" ? "bg-slate-100 cursor-not-allowed" : ""}`}
                  required
                />
              </Field>

              <Field label="ভাউচারের ধরন (Type)" name="type">
                <select id="type" name="type" className="input font-bold" required>
                  <option value="RECEIPT">📥 টাকা গ্রহণ / বিল আদায় (RECEIPT)</option>
                  <option value="PAYMENT">📤 টাকা প্রদান / পার্টনার উত্তোলন (PAYMENT)</option>
                </select>
              </Field>

              <Field label="পার্টি নির্বাচন (বিল আদায়ের ক্ষেত্রে)" name="partyId" hint="টাকা গ্রহণের ক্ষেত্রে প্রযোজ্য">
                <select id="partyId" name="partyId" className="input">
                  <option value="">— পার্টি নির্বাচন করুন —</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.isOwnerSelfParty ? "★ [নিজস্ব পার্টি]" : ""} (বাকি: ৳{formatNumber(p.currentDue)})
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="পার্টনার টার্গেট (উত্তোলনের ক্ষেত্রে)" name="partnerTarget" hint="পার্টনার টাকা উত্তোলনের ক্ষেত্রে">
                <select id="partnerTarget" name="partnerTarget" className="input">
                  <option value="">— পার্টনার নির্বাচন করুন —</option>
                  <option value="PARTNER_1">পার্টনার ১ (নাহিদ হাসান - ৬০%)</option>
                  <option value="PARTNER_2">পার্টনার ২ (৪০%)</option>
                </select>
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="মাধ্যম (Mode)" name="paymentMode">
                  <select id="paymentMode" name="paymentMode" className="input" defaultValue="CASH">
                    <option value="CASH">ক্যাশ (Cash)</option>
                    <option value="BANK">ব্যাংক (Bank)</option>
                    <option value="BKASH">বিকাশ / নগদ (MFS)</option>
                  </select>
                </Field>

                <Field label="টাকার পরিমাণ" name="amount">
                  <input
                    id="amount"
                    name="amount"
                    type="number"
                    min="1"
                    placeholder="৳"
                    className="input-num text-base font-bold text-ink-900"
                    required
                  />
                </Field>
              </div>

              <Field label="নোট / বিবরণ" name="note">
                <input
                  id="note"
                  name="note"
                  placeholder="চেক নম্বর, ব্যাংক বা মন্তব্য..."
                  className="input"
                />
              </Field>

              <SubmitButton pendingText="সংরক্ষণ হচ্ছে…">
                ✓ ভাউচার সংরক্ষণ করুন
              </SubmitButton>
            </ActionForm>
          </section>
        ) : (
          <section className="panel p-6 text-center text-slate-500">
            <span className="text-3xl">👀</span>
            <p className="mt-2 text-sm font-semibold text-slate-700">পার্টনার ভিউ (Read-Only)</p>
            <p className="text-xs text-slate-500 mt-1">
              আপনার অ্যাকাউন্টে শুধুমাত্র ক্যাশ বুক দেখার অনুমতি রয়েছে।
            </p>
          </section>
        )}

        {/* Vouchers Table */}
        <section className="panel lg:col-span-2">
          <div className="panel-head flex items-center justify-between">
            <h2 className="panel-title flex items-center gap-2">
              <span>📋</span>
              <span>ভাউচার ও লেনদেন তালিকা ({vouchers.length})</span>
            </h2>
          </div>

          <div className="overflow-x-auto">
            {vouchers.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                এখনো কোনো ভাউচার রেকর্ড করা হয়নি।
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>তারিখ ও ভাউচার</th>
                    <th>ধরন</th>
                    <th>পার্টি / পার্টনার</th>
                    <th>মাধ্যম</th>
                    <th className="num">টাকা</th>
                    <th>মন্তব্য</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {vouchers.map((v) => (
                    <tr key={v.id} className="hover:bg-slate-50">
                      <td className="text-xs whitespace-nowrap">
                        <span className="font-mono font-bold text-ink-800">{v.voucherNo}</span>
                        <span className="block text-[11px] text-slate-400">{formatDateTime(v.date)}</span>
                      </td>
                      <td className="text-xs">
                        {v.type === "RECEIPT" ? (
                          <span className="rounded bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800 text-[11px]">
                            📥 বিল গ্রহণ
                          </span>
                        ) : (
                          <span className="rounded bg-amber-100 px-2 py-0.5 font-bold text-amber-800 text-[11px]">
                            📤 পার্টনার উত্তোলন
                          </span>
                        )}
                      </td>
                      <td className="text-xs font-semibold text-ink-900">
                        {v.party ? (
                          <span>{v.party.name}</span>
                        ) : v.partnerTarget === "PARTNER_1" ? (
                          <span className="text-amber-900">পার্টনার ১ (নাহিদ হাসান)</span>
                        ) : v.partnerTarget === "PARTNER_2" ? (
                          <span className="text-blue-900">পার্টনার ২ (৪০%)</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="text-xs font-mono text-slate-600">{v.paymentMode}</td>
                      <td className={`num text-xs font-bold ${v.type === "RECEIPT" ? "text-emerald-700" : "text-amber-800"}`}>
                        {v.type === "RECEIPT" ? "+" : "-"}৳ {formatNumber(v.amount)}
                      </td>
                      <td className="text-xs text-slate-500">{v.note || "—"}</td>
                      <td className="text-right">
                        {role === "SUPER_ADMIN" && (
                          <ActionButton
                            action={deleteVoucherAction.bind(null, v.id)}
                            label="মুছুন"
                            confirmText="আপনি কি নিশ্চিত এই ভাউচারটি মুছে ফেলতে চান?"
                            className="btn-danger btn-sm text-xs"
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
