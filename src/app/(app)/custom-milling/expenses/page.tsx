import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { formatDateTime, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms";
import { requireContext } from "@/server/auth";
import { getRiceMillSettings, resolveMillRole } from "@/lib/custom-milling";
import { createExpenseAction, deleteExpenseAction } from "@/server/actions/custom-milling";
import { CustomMillingTabs, MainSyncBadge } from "../custom-milling-ui";

export const metadata: Metadata = {
  title: "মিলিং খরচ ও ব্যয় ব্যবস্থাপনা",
};

const CATEGORY_LABELS: Record<string, string> = {
  MILL_RENT: "মিলের ভাড়া (Rent)",
  ELECTRICITY_FUEL: "বিদ্যুৎ ও জ্বালানি / ডিজেল",
  LABOUR: "শ্রমিক মজুরি (Labour)",
  PARTS_MAINTENANCE: "যন্ত্রাংশ ও মেরামত",
  OTHER: "অন্যান্য মিল খরচ",
};

const PAID_BY_LABELS: Record<string, { label: string; bg: string }> = {
  MILL_CASH: { label: "মিলের ক্যাশ থেকে", bg: "bg-slate-100 text-slate-800" },
  PARTNER_1: { label: "পার্টনার ১ (নাহিদ হাসান)", bg: "bg-amber-100 text-amber-900 border-amber-300" },
  PARTNER_2: { label: "পার্টনার ২ (৪০%)", bg: "bg-emerald-100 text-emerald-900 border-emerald-300" },
};

export default async function CustomMillingExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const settings = await getRiceMillSettings();
  const role = resolveMillRole(ctx, sp.role, settings);

  const expenses = await prisma.millExpense.findMany({
    orderBy: { date: "desc" },
  });

  const totalExpense = expenses.reduce((sum, e) => sum + e.amount, 0);
  const partner1Total = expenses.filter((e) => e.paidBy === "PARTNER_1").reduce((sum, e) => sum + e.amount, 0);
  const partner2Total = expenses.filter((e) => e.paidBy === "PARTNER_2").reduce((sum, e) => sum + e.amount, 0);
  const millCashTotal = expenses.filter((e) => e.paidBy === "MILL_CASH").reduce((sum, e) => sum + e.amount, 0);

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="মিলিং খরচ ও ব্যয় ব্যবস্থাপনা"
          description="ভাড়া, বিদ্যুৎ, শ্রমিক মজুরি ও পার্টনারদের পকেট খরচের হিসাব"
        />
      </div>

      <CustomMillingTabs role={role} />

      {/* Expense Summary Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-rule bg-white p-3.5 shadow-2xs">
          <p className="text-[11px] font-semibold text-slate-500">মোট মিল খরচ</p>
          <p className="text-xl font-bold text-red-700">৳ {formatNumber(totalExpense)}</p>
        </div>
        <div className="rounded-xl border border-rule bg-white p-3.5 shadow-2xs">
          <p className="text-[11px] font-semibold text-slate-500">মিলের ক্যাশ থেকে পরিশোধ</p>
          <p className="text-xl font-bold text-slate-800">৳ {formatNumber(millCashTotal)}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 shadow-2xs">
          <p className="text-[11px] font-semibold text-amber-900">পার্টনার ১ (নাহিদ হাসান) পকেট থেকে</p>
          <p className="text-xl font-bold text-amber-950">৳ {formatNumber(partner1Total)}</p>
          <span className="text-[10px] text-amber-700">জেভি হিসেবে সমন্বয়যোগ্য (+)</span>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 shadow-2xs">
          <p className="text-[11px] font-semibold text-emerald-900">পার্টনার ২ (৪০%) পকেট থেকে</p>
          <p className="text-xl font-bold text-emerald-950">৳ {formatNumber(partner2Total)}</p>
          <span className="text-[10px] text-emerald-700">জেভি হিসেবে সমন্বয়যোগ্য (+)</span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Expense Entry Form (Disabled for MILL_PARTNER) */}
        {role !== "MILL_PARTNER" ? (
          <section className="panel p-4 sm:p-5">
            <div className="flex items-center gap-2 border-b border-rule pb-2 mb-4">
              <span className="text-lg">➕</span>
              <h2 className="panel-title">নতুন খরচ এন্ট্রি</h2>
            </div>

            <ActionForm action={createExpenseAction} className="space-y-4">
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

              <Field label="খরচের খাত (Category)" name="category">
                <select id="category" name="category" className="input" required>
                  <option value="MILL_RENT">মিলের ভাড়া (Rent)</option>
                  <option value="ELECTRICITY_FUEL">বিদ্যুৎ ও জ্বালানি / ডিজেল</option>
                  <option value="LABOUR">শ্রমিক মজুরি (Labour)</option>
                  <option value="PARTS_MAINTENANCE">যন্ত্রাংশ ও মেরামত</option>
                  <option value="OTHER">অন্যান্য মিল খরচ</option>
                </select>
              </Field>

              <Field label="খরচের বিবরণ" name="description" hint="উদাঃ জেনারেটর ডিজেল ২০ লিটার, বয়লার মেরামত">
                <input
                  id="description"
                  name="description"
                  placeholder="বিবরণ লিখুন..."
                  className="input"
                  required
                />
              </Field>

              <Field label="টাকার পরিমাণ (Amount)" name="amount">
                <input
                  id="amount"
                  name="amount"
                  type="number"
                  step="1"
                  min="1"
                  placeholder="৳"
                  className="input-num text-base font-bold text-red-700"
                  required
                />
              </Field>

              <Field
                label="টাকা পরিশোধের উৎস (Paid By)"
                name="paidBy"
                hint="কে এই টাকা পরিশোধ করেছেন?"
              >
                <select id="paidBy" name="paidBy" className="input" defaultValue="MILL_CASH" required>
                  <option value="MILL_CASH">মিলের ক্যাশ থেকে (Mill Cash)</option>
                  <option value="PARTNER_1">পার্টনার ১ (নাহিদ হাসান - পকেট থেকে)</option>
                  <option value="PARTNER_2">পার্টনার ২ (৪০% - পকেট থেকে)</option>
                </select>
              </Field>

              <SubmitButton pendingText="সংরক্ষণ হচ্ছে…">
                ✓ খরচ সংরক্ষণ করুন
              </SubmitButton>
            </ActionForm>
          </section>
        ) : (
          <section className="panel p-6 text-center text-slate-500">
            <span className="text-3xl">👀</span>
            <p className="mt-2 text-sm font-semibold text-slate-700">পার্টনার ভিউ (Read-Only)</p>
            <p className="text-xs text-slate-500 mt-1">
              আপনার অ্যাকাউন্টে শুধুমাত্র খরচের হিসাব দেখার অনুমতি রয়েছে।
            </p>
          </section>
        )}

        {/* Expenses List Table */}
        <section className="panel lg:col-span-2">
          <div className="panel-head flex items-center justify-between">
            <h2 className="panel-title flex items-center gap-2">
              <span>📋</span>
              <span>খরচের তালিকা ({expenses.length})</span>
            </h2>
          </div>

          <div className="overflow-x-auto">
            {expenses.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                কোনো খরচ রেকর্ড করা হয়নি।
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>তারিখ</th>
                    <th>খাত</th>
                    <th>বিবরণ</th>
                    <th>উৎস (Paid By)</th>
                    <th className="num">টাকা</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => {
                    const payer = PAID_BY_LABELS[e.paidBy] || { label: e.paidBy, bg: "bg-slate-100 text-slate-800" };
                    return (
                      <tr key={e.id} className="hover:bg-slate-50">
                        <td className="text-xs whitespace-nowrap">
                          {formatDateTime(e.date)}
                          <span className="block text-[10px] text-slate-400">এন্ট্রি: {e.createdByName}</span>
                        </td>
                        <td className="text-xs font-semibold text-slate-700">
                          {CATEGORY_LABELS[e.category] || e.category}
                        </td>
                        <td className="text-xs text-ink-900">{e.description}</td>
                        <td className="text-xs">
                          <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold border ${payer.bg}`}>
                            {payer.label}
                          </span>
                          {e.mainSyncStatus !== "NOT_APPLICABLE" && (
                            <div className="mt-0.5">
                              <MainSyncBadge status={e.mainSyncStatus} />
                            </div>
                          )}
                        </td>
                        <td className="num text-xs font-bold text-red-700">
                          ৳ {formatNumber(e.amount)}
                        </td>
                        <td className="text-right">
                          {role === "SUPER_ADMIN" && (
                            <ActionButton
                              action={deleteExpenseAction.bind(null, e.id)}
                              label="মুছুন"
                              confirmText="আপনি কি নিশ্চিত এই খরচটি মুছে ফেলতে চান?"
                              className="btn-danger btn-sm text-xs"
                            />
                          )}
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
