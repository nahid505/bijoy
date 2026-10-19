import type { Metadata } from "next";
import Link from "next/link";
import { prisma, num } from "@/lib/db";
import { DEPOT_ACCESS, DEPOT_CASH_NAME, isDepot } from "@/lib/depot";
import { formatDate, formatMoney, toBnDigits, toDateInput } from "@/lib/format";
import { EmptyState, FilterBar, FilterField, PageHeader, StatCard, TableWrap } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { can, requirePermission } from "@/server/auth";
import { canChangeEntryDate } from "@/server/entry-date";
import { readParams, type SearchParams } from "@/server/params";
import { reportPeriod } from "@/server/period";
import { accountScopeWhere, allowedAccounts, isRestricted, voucherScopeWhere } from "@/server/party-scope";
import { deleteDepotExpenseAction, transferDepotFundAction } from "@/server/actions/depot-cash";
import { cashInHand, ensureDepotCash, listDepotExpenses } from "@/server/services/depot-cash";
import { DepotOnlyNotice } from "../depot-ui";
import { DepotFundForm } from "./fund-form";

export const metadata: Metadata = { title: "ডিপো খরচ" };

export default async function DepotExpensesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission(DEPOT_ACCESS.expense);
  if (!isDepot(ctx.business.businessType)) return <DepotOnlyNotice canManage={can(ctx, "business:manage")} />;
  const p = await readParams(searchParams);
  const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
  const cur = ctx.business.currencySymbol;
  const depotCash = await ensureDepotCash(prisma, ctx.business.id);
  const heads = allowedAccounts(ctx);
  const showCash = depotCash && (!heads || heads.includes(depotCash));
  const head = p.head || undefined;
  const [list, balance, expenseHeads, mainCash] = await Promise.all([
    listDepotExpenses(ctx.business.id, { from: range.gte, to: range.lt, expenseAccountId: head, q: p.q, scope: voucherScopeWhere(ctx) }),
    showCash ? cashInHand(prisma, ctx.business.id, depotCash) : Promise.resolve(null),
    prisma.account.findMany({ where: { businessId: ctx.business.id, nature: "EXPENSE", ...accountScopeWhere(ctx) }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.account.findMany({ where: { businessId: ctx.business.id, kind: { in: ["CASH", "BANK"] }, isActive: true, NOT: { id: depotCash ?? "" }, ...accountScopeWhere(ctx) }, orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  const canFund = !isRestricted(ctx) && can(ctx, DEPOT_ACCESS.fund);
  return (
    <>
      <PageHeader
        title="ডিপো খরচ"
        description={`"${DEPOT_CASH_NAME}" থেকে ডিপোর খরচ — খরচের খাতে ডেবিট, ডিপো ক্যাশে ক্রেডিট; ব্যবসার মূল লাভ-ক্ষতি ও ক্যাশ ফ্লোতে যুক্ত হয়`}
        crumbs={[{ label: "ডিপো ব্যবস্থাপনা" }, { label: "ডিপো খরচ" }]}
        actions={
          <>
            {can(ctx, DEPOT_ACCESS.cashbook) && <Link prefetch={false} href="/reports/depot-cash-book" className="btn-secondary">ডিপো ক্যাশ বুক</Link>}
            <Link prefetch={false} href="/depot/expenses/new" className="btn-primary">+ নতুন খরচ</Link>
          </>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {balance !== null && <StatCard label={`${DEPOT_CASH_NAME} — বর্তমান ব্যালেন্স`} value={formatMoney(balance, cur)} tone={balance < 0 ? "red" : "green"} />}
        <StatCard label="এই সময়ে মোট খরচ" value={formatMoney(list.total, cur)} tone="red" />
        <StatCard label="খরচের এন্ট্রি" value={toBnDigits(list.count)} />
      </div>
      <section className="panel">
        <FilterBar action="/depot/expenses">
          <FilterField label="শুরু"><input type="date" name="from" defaultValue={from} className="input w-40" /></FilterField>
          <FilterField label="শেষ"><input type="date" name="to" defaultValue={to} className="input w-40" /></FilterField>
          <FilterField label="খরচের খাত">
            <select name="head" defaultValue={head ?? ""} className="input w-48">
              <option value="">সব খাত</option>
              {expenseHeads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </FilterField>
          <FilterField label="খুঁজুন"><input name="q" defaultValue={p.q ?? ""} className="input w-44" placeholder="ভাউচার / মেমো / বিবরণ" /></FilterField>
        </FilterBar>
        {list.rows.length === 0 ? <EmptyState message="এই সময়ে কোনো ডিপো খরচ নেই" /> : (
          <TableWrap>
            <table className="table" id="depot-expenses">
              <thead><tr><th>তারিখ</th><th>ভাউচার</th><th>মেমো নং</th><th>খরচের খাত</th><th>পেমেন্ট মেথড</th><th>বিবরণ</th><th className="num">টাকা</th><th /></tr></thead>
              <tbody>
                {list.rows.map((v) => (
                  <tr key={v.id}>
                    <td className="whitespace-nowrap">{formatDate(v.date)}</td>
                    <td className="font-semibold">{can(ctx, "vouchers:view") ? <Link prefetch={false} href={`/vouchers/v/${v.id}`} className="text-brand-700 hover:underline">{v.voucherNo}</Link> : v.voucherNo}</td>
                    <td className="text-sm">{v.reference ?? "—"}</td>
                    <td>{v.partyAccount?.name ?? "—"}</td>
                    <td className="text-sm">{v.cashAccount?.name ?? "—"}</td>
                    <td className="text-sm text-slate-600">{v.narration ?? ""}</td>
                    <td className="num font-semibold">{formatMoney(num(v.amount), cur)}</td>
                    <td className="whitespace-nowrap text-right">
                      <Link prefetch={false} href={`/depot/expenses/${v.id}/edit`} className="btn-secondary btn-sm">সম্পাদনা</Link>{" "}
                      <ActionButton action={deleteDepotExpenseAction.bind(null, v.id)} label="মুছুন" confirmText={`খরচ ${v.voucherNo} মুছে ফেললে টাকা আবার ডিপো ক্যাশে ফিরে যাবে। নিশ্চিত?`} />
                    </td>
                  </tr>
                ))}
                <tr className="font-bold"><td colSpan={6}>মোট</td><td className="num">{formatMoney(list.total, cur)}</td><td /></tr>
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
      {canFund && depotCash && (
        <section className="panel mt-4 p-5" id="depot-fund">
          <h2 className="text-base font-semibold text-ink-900">ফান্ড স্থানান্তর — মূল ক্যাশ ⇄ {DEPOT_CASH_NAME}</h2>
          <p className="mb-3 mt-1 text-sm text-slate-600">মূল নগদ বা ব্যাংক থেকে ডিপো ক্যাশে টাকা দিন (বা অতিরিক্ত টাকা ফেরত নিন)। এটি সাধারণ হিসাবে একটি জার্নাল — দুই নগদ হিসাবের মধ্যে স্থানান্তর, আয় বা খরচ নয়।</p>
          <DepotFundForm action={transferDepotFundAction} mainAccounts={mainCash.map((a) => ({ ...a, group: "" }))} today={toDateInput()} dateLocked={!canChangeEntryDate(ctx)} currency={cur} />
        </section>
      )}
      {!showCash && depotCash && <p className="mt-3 text-sm text-slate-500">&quot;{DEPOT_CASH_NAME}&quot; হিসাবটি আপনাকে নির্ধারণ করা হয়নি — খরচ এন্ট্রিতে আপনার নির্ধারিত নগদ/ব্যাংক হিসাব ব্যবহার করুন।</p>}
    </>
  );
}
