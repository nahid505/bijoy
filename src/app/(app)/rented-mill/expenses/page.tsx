import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireContext } from "@/server/auth";
import {
  EXPENSE_CATEGORIES,
  getRentedMillSettings,
  resolveRentedMillRole,
  parseExpenseCategories,
} from "@/lib/rented-mill";
import { formatBnCurrency, getBengaliDateLabel, toBn } from "@/lib/format";
import {
  PrintButton,
  RentedMillTabs,
} from "../rented-mill-ui";
import { ExpensesClient } from "./expenses-client";
import { ExpenseRowActions } from "../rented-mill-edit-modals";

export const metadata: Metadata = {
  title: "মিল ভাড়া ও যাবতীয় খরচ - ভাড়া অটো রাইস মিল",
};

export default async function RentedMillExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const ctx = await requireContext();
  const settings = await getRentedMillSettings();
  const role = resolveRentedMillRole(ctx, settings);

  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const filterCat = sp.category || "";

  const [expenses, pendingExpenses] = await Promise.all([
    prisma.rentedMillExpense.findMany({
      where: {
        AND: [
          { status: "APPROVED" },
          filterCat ? { category: filterCat } : {},
          q
            ? {
                OR: [
                  { expenseNo: { contains: q, mode: "insensitive" } },
                  { description: { contains: q, mode: "insensitive" } },
                  { paidTo: { contains: q, mode: "insensitive" } },
                ],
              }
            : {},
        ],
      },
      orderBy: { date: "desc" },
    }),
    prisma.rentedMillExpense.findMany({
      where: {
        AND: [
          { status: "PENDING" },
          filterCat ? { category: filterCat } : {},
          q
            ? {
                OR: [
                  { expenseNo: { contains: q, mode: "insensitive" } },
                  { description: { contains: q, mode: "insensitive" } },
                  { paidTo: { contains: q, mode: "insensitive" } },
                ],
              }
            : {},
        ],
      },
      orderBy: { date: "desc" },
    }),
  ]);

  const totalExpenseAmount = expenses.reduce((s, x) => s + x.amount, 0);

  const configuredCategories = parseExpenseCategories(settings.expenseCategories);
  const displayCategories = Array.from(
    new Set([...configuredCategories, ...expenses.map((x) => x.category || "অন্যান্য খরচ")])
  );

  // Group by category for quick summary
  const catTotals: Record<string, number> = {};
  for (const cat of displayCategories) {
    catTotals[cat] = 0;
  }
  for (const x of expenses) {
    const c = x.category || "অন্যান্য খরচ";
    catTotals[c] = (catTotals[c] || 0) + x.amount;
  }

  return (
    <div className="space-y-6">
      <RentedMillTabs role={role} />

      {/* Header and Action Button */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-rule pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink-900">
            মিল ভাড়া ও যাবতীয় খরচ
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500">
            মাসিক মিল ভাড়া (২,৮০,০০০ টাকা), বিদ্যুৎ বিল, লেবার খরচ, বেতন ও যাবতীয় খরচ খতিয়ান
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ExpensesClient
            role={role}
            monthlyRent={settings.monthlyRent}
            expenseCategories={configuredCategories}
          />
          <PrintButton label="খরচ খতিয়ান প্রিন্ট" />
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {displayCategories.map((cat) => (
          <div
            key={cat}
            className={`rounded-xl border p-3 shadow-2xs transition ${
              filterCat === cat
                ? "border-brand-500 bg-brand-50/60 ring-2 ring-brand-300"
                : "border-rule bg-white hover:border-slate-300"
            }`}
          >
            <p className="text-[11px] font-semibold text-slate-500 truncate" title={cat}>
              {cat}
            </p>
            <p className="mt-1 text-base sm:text-lg font-bold text-ink-900">
              {formatBnCurrency(catTotals[cat] || 0)}
            </p>
            <Link
              href={filterCat === cat ? "/rented-mill/expenses" : `/rented-mill/expenses?category=${encodeURIComponent(cat)}`}
              className="mt-1 block text-[10px] text-brand-600 hover:underline font-medium"
            >
              {filterCat === cat ? "ফিল্টার সরান ✕" : "ফিল্টার করুন →"}
            </Link>
          </div>
        ))}
      </div>

      {/* Filter / Search Bar */}
      <div className="flex flex-wrap items-center gap-3 no-print">
        <form method="GET" className="flex flex-1 items-center gap-2 max-w-md">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="খরচ নং, বিবরণ বা প্রাপক খুঁজুন..."
            className="w-full rounded-lg border border-rule bg-white px-3 py-1.5 text-xs text-ink-900 focus:border-brand-500"
          />
          <button type="submit" className="btn-outline text-xs">
            সার্চ
          </button>
        </form>

        {filterCat && (
          <Link
            href="/rented-mill/expenses"
            className="text-xs text-brand-600 font-semibold hover:underline"
          >
            সকল ক্যাটাগরি দেখুন ✕
          </Link>
        )}
      </div>

      {/* Pending Expenses (if any) */}
      {pendingExpenses.length > 0 && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50/60 p-4 shadow-2xs no-print">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500 text-white font-bold text-xs">
                ⏳
              </span>
              <h2 className="text-sm font-bold text-amber-950">
                অনুমোদনের অপেক্ষায় থাকা খরচ ({toBn(pendingExpenses.length)} টি) · অপেক্ষমান ব্যয়:{" "}
                <span className="text-amber-800 font-extrabold">
                  {formatBnCurrency(pendingExpenses.reduce((s, x) => s + x.amount, 0))}
                </span>
              </h2>
            </div>
            <Link
              href="/rented-mill"
              className="text-xs font-bold text-amber-850 hover:text-amber-950 underline flex items-center gap-1"
            >
              <span>ড্যাশবোর্ডে গিয়ে অনুমোদন দিন</span>
              <span>→</span>
            </Link>
          </div>
          <p className="mt-1 text-[11px] text-amber-800">
            💡 হিসাবরক্ষকের দেওয়া খরচগুলো সুপার অ্যাডমিন / নাহিদ হাসান অনুমোদন দেওয়ার পর নিচের চূড়ান্ত তালিকায় যুক্ত হবে।
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-amber-200 bg-amber-100/60 text-amber-950 font-bold">
                  <th className="py-2 px-3">খরচ নং</th>
                  <th className="py-2 px-3">তারিখ</th>
                  <th className="py-2 px-3">খরচের খাত</th>
                  <th className="py-2 px-3">বিবরণ / নোট</th>
                  <th className="py-2 px-3">প্রাপক</th>
                  <th className="py-2 px-3 text-right">টাকার পরিমাণ</th>
                  <th className="py-2 px-3">এন্ট্রি প্রদানকারী</th>
                  <th className="py-2 px-3 text-center">স্ট্যাটাস</th>
                  {role !== "PARTNER" && (
                    <th className="py-2 px-3 text-center no-print">অ্যাকশন</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100 font-medium">
                {pendingExpenses.map((x) => (
                  <tr key={x.id} className="hover:bg-amber-100/40">
                    <td className="py-2 px-3 font-bold text-amber-900 font-mono">
                      {x.expenseNo}
                    </td>
                    <td className="py-2 px-3 text-slate-600">
                      {getBengaliDateLabel(x.date)}
                    </td>
                    <td className="py-2 px-3">
                      <span className="inline-flex rounded-full bg-amber-200/80 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                        {x.category}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-ink-900">{x.description || "—"}</td>
                    <td className="py-2 px-3 text-slate-600">{x.paidTo || "—"}</td>
                    <td className="py-2 px-3 text-right font-bold text-amber-900">
                      {formatBnCurrency(x.amount)}
                    </td>
                    <td className="py-2 px-3 text-slate-600 font-medium">
                      {x.createdByName}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                        ⏳ PENDING
                      </span>
                    </td>
                    {role !== "PARTNER" && (
                      <td className="py-2 px-3 text-center no-print">
                        <ExpenseRowActions expense={x} role={role} compact={false} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Main Expenses Table */}
      <div className="rounded-xl border border-rule bg-white shadow-2xs overflow-hidden">
        <div className="border-b border-rule bg-slate-50/70 px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink-900">
            অনুমোদিত খরচের তালিকা ({toBn(expenses.length)} টি) · সর্বমোট ব্যয়:{" "}
            <span className="text-red-700 font-extrabold">{formatBnCurrency(totalExpenseAmount)}</span>
          </h2>
        </div>

        {expenses.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            কোনো খরচের এন্ট্রি পাওয়া যায়নি। উপরে <b>&ldquo;নতুন খরচ / মিল ভাড়া এন্ট্রি&rdquo;</b> বাটনে ক্লিক করে খরচ যোগ করুন।
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-rule bg-slate-50 text-slate-600">
                  <th className="py-2.5 px-3 font-semibold">খরচ নং</th>
                  <th className="py-2.5 px-3 font-semibold">তারিখ</th>
                  <th className="py-2.5 px-3 font-semibold">খরচের খাত</th>
                  <th className="py-2.5 px-3 font-semibold">বিবরণ / নোট</th>
                  <th className="py-2.5 px-3 font-semibold">প্রাপক</th>
                  <th className="py-2.5 px-3 font-semibold text-right">টাকার পরিমাণ</th>
                  {role !== "PARTNER" && (
                    <th className="py-2.5 px-3 font-semibold text-center no-print">অ্যাকশন</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expenses.map((x) => (
                  <tr key={x.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3 font-bold text-brand-700">
                      {x.expenseNo}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500">
                      {getBengaliDateLabel(x.date)}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          x.category === "মাসিক মিল ভাড়া"
                            ? "bg-purple-100 text-purple-900"
                            : x.category === "বিদ্যুৎ বিল"
                            ? "bg-yellow-100 text-yellow-900"
                            : x.category === "লেবার খরচ"
                            ? "bg-blue-100 text-blue-900"
                            : "bg-slate-100 text-slate-800"
                        }`}
                      >
                        {x.category}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-ink-900">
                      {x.description || "—"}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      {x.paidTo || "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-red-700">
                      {formatBnCurrency(x.amount)}
                    </td>
                    {role !== "PARTNER" && (
                      <td className="py-2.5 px-3 text-center no-print">
                        <ExpenseRowActions expense={x} role={role} compact={false} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-rule bg-slate-50 font-bold text-xs">
                  <td colSpan={5} className="py-2.5 px-3 text-right">
                    সর্বমোট খরচ:
                  </td>
                  <td className="py-2.5 px-3 text-right text-red-700">
                    {formatBnCurrency(totalExpenseAmount)}
                  </td>
                  {role !== "PARTNER" && <td></td>}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
