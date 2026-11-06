import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma, num } from "@/lib/db";
import { DEPOT_ACCESS, DEPOT_CASH_NAME, isDepot } from "@/lib/depot";
import { toDateInput } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { can, requireContext, requirePermission } from "@/server/auth";
import { canChangeEntryDate } from "@/server/entry-date";
import { allowedAccounts, canSeeVoucher } from "@/server/party-scope";
import { saveDepotExpenseAction } from "@/server/actions/depot-cash";
import { cashInHand, ensureDepotCash, loadDepotExpense } from "@/server/services/depot-cash";
import { UserError } from "@/lib/errors";
import { DepotOnlyNotice } from "../depot-ui";
import { DepotExpenseForm, type DepotExpenseValues } from "./expense-form";

export async function DepotExpenseEntryPage({ id }: { id?: string }) {
  const ctx = await requireContext();
  const required = id ? DEPOT_ACCESS.expenseEdit : DEPOT_ACCESS.expenseCreate;
  if (!can(ctx, required)) {
    return (
      <div className="card mx-auto mt-16 max-w-lg p-10 text-center">
        <p className="text-5xl">💸</p>
        <p className="mt-3 font-mono text-sm font-bold tracking-wide text-credit">403 — Forbidden</p>
        <h1 className="mt-4 text-xl font-bold text-slate-800">প্রবেশাধিকার নেই</h1>
        <p className="mt-2 text-sm text-slate-500">এই খরচ এন্ট্রি বা দেখার আপনার অনুমতি নেই</p>
        <div className="mt-6 flex justify-center gap-2">
          <Link prefetch={false} href="/depot/expenses" className="btn-primary">ডিপো খরচে ফিরুন</Link>
        </div>
      </div>
    );
  }
  if (!isDepot(ctx.business.businessType)) return <DepotOnlyNotice canManage={can(ctx, "business:manage")} />;
  const depotCash = await ensureDepotCash(prisma, ctx.business.id);
  const heads = allowedAccounts(ctx);
  const cashUsable = depotCash && (!heads || heads.includes(depotCash)) ? depotCash : null;
  let initial: DepotExpenseValues = { date: toDateInput(), expenseAccountId: "", cashAccountId: cashUsable ?? "", amount: "", reference: "", narration: "" };
  if (id) {
    const v = await loadDepotExpense(prisma, ctx.business.id, id).catch((e) => (e instanceof UserError ? null : Promise.reject(e)));
    if (!v || !(await canSeeVoucher(ctx, v.id))) notFound();
    initial = { date: toDateInput(v.date), expenseAccountId: v.partyAccountId ?? "", cashAccountId: v.cashAccountId ?? "", amount: num(v.amount), reference: v.reference ?? "", narration: v.narration ?? "" };
  }
  const knownIds = [initial.expenseAccountId, initial.cashAccountId, cashUsable].filter((x): x is string => Boolean(x));
  const known = await prisma.account.findMany({ where: { businessId: ctx.business.id, id: { in: knownIds } }, select: { id: true, name: true } });
  // balance before this expense (an edit adds its own amount back)
  const balance = cashUsable ? await cashInHand(prisma, ctx.business.id, cashUsable, id) : null;
  return (
    <>
      <PageHeader
        title={id ? "ডিপো খরচ সম্পাদনা" : "নতুন ডিপো খরচ"}
        description={`খরচ সংরক্ষণ হলে "${DEPOT_CASH_NAME}" থেকে টাকা বিয়োগ (ক্রেডিট) হবে আর খরচের খাতে ডেবিট হবে — মূল লাভ-ক্ষতি ও ক্যাশ ফ্লোতে দেখা যাবে`}
        crumbs={[{ label: "ডিপো ব্যবস্থাপনা" }, { label: "ডিপো খরচ", href: "/depot/expenses" }, { label: id ? "সম্পাদনা" : "নতুন" }]}
      />
      <section className="panel p-5">
        <DepotExpenseForm
          action={saveDepotExpenseAction.bind(null, id ?? null)}
          initial={initial}
          known={known.map((a) => ({ ...a, group: "" }))}
          depotCashId={cashUsable}
          balance={balance}
          dateLocked={!canChangeEntryDate(ctx)}
          currency={ctx.business.currencySymbol}
          editing={Boolean(id)}
        />
      </section>
    </>
  );
}
