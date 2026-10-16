import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate, formatMoney, toDateInput } from "@/lib/format";
import { ActionButton } from "@/components/forms";
import { Badge, EmptyState, PageHeader, StatCard, TableWrap } from "@/components/ui";
import { can } from "@/server/auth";
import { canChangeEntryDate } from "@/server/entry-date";
import { requirePayroll } from "@/server/payroll-context";
import { readParams, type SearchParams } from "@/server/params";
import { deleteAdvanceAction, giveAdvanceAction } from "@/server/actions/payroll";
import { searchEmployees } from "@/server/lookup";
import { advanceOutstanding } from "@/server/services/payroll";
import { accountOptions } from "@/server/voucher-editor";
import { AdvanceForm } from "../payroll-forms";

export const metadata: Metadata = { title: "অগ্রিম ও ঋণ" };

export default async function AdvancesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePayroll("payroll:view");
  const p = await readParams(searchParams);
  const biz = ctx.business.id;
  const cur = ctx.business.currencySymbol;
  const show = p.show ?? "open";
  const [all, cashAccounts, preselected] = await Promise.all([
    advanceOutstanding(prisma, biz, p.employee ? [p.employee] : undefined),
    can(ctx, "payroll:pay") ? accountOptions(biz, { kind: { in: ["CASH", "BANK"] } }) : Promise.resolve([]),
    p.employee ? searchEmployees(biz, "", { ids: [p.employee] }) : Promise.resolve([]),
  ]);
  const emps = new Map((await prisma.employee.findMany({ where: { id: { in: [...new Set(all.map((a) => a.employeeId))] } }, select: { id: true, code: true, name: true } })).map((e) => [e.id, e]));
  const rows = all.filter((a) => show === "all" || a.outstanding > 0.004).sort((a, b) => b.date.getTime() - a.date.getTime());
  const outstanding = all.reduce((s, a) => s + Math.max(0, a.outstanding), 0);
  const draftLines = new Set((await prisma.payslipLine.findMany({ where: { advanceId: { in: all.map((a) => a.id) } }, select: { advanceId: true } })).map((l) => l.advanceId));

  return (
    <>
      <PageHeader title="অগ্রিম ও ঋণ" description="কর্মচারীকে অগ্রিম বেতন বা ঋণ — মাসিক কিস্তি স্বয়ংক্রিয়ভাবে বেতন থেকে কাটা হয়" crumbs={[{ label: "বেতন", href: "/payroll" }, { label: "অগ্রিম ও ঋণ" }]} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="অনাদায়ী অগ্রিম/ঋণ" value={formatMoney(outstanding, cur)} tone="amber" />
        <StatCard label="চলমান অগ্রিম/ঋণ" value={String(all.filter((a) => a.outstanding > 0.004).length)} />
      </div>
      {can(ctx, "payroll:pay") && (
        <section className="panel mb-4 p-4">
          <h2 className="panel-title mb-3">অগ্রিম / ঋণ প্রদান</h2>
          <AdvanceForm action={giveAdvanceAction} cashAccounts={cashAccounts} today={toDateInput()} currency={cur} employee={preselected[0] ?? null} dateLocked={!canChangeEntryDate(ctx)} />
        </section>
      )}
      <section className="panel">
        <div className="panel-head flex items-center justify-between gap-2">
          <h2 className="panel-title">তালিকা</h2>
          <div className="flex gap-1 text-sm">
            <Link prefetch={false} href={`/payroll/advances?show=open${p.employee ? `&employee=${p.employee}` : ""}`} className={show === "open" ? "font-semibold text-brand-700" : "text-slate-500"}>চলমান</Link>
            <span className="text-slate-300">|</span>
            <Link prefetch={false} href={`/payroll/advances?show=all${p.employee ? `&employee=${p.employee}` : ""}`} className={show === "all" ? "font-semibold text-brand-700" : "text-slate-500"}>সব</Link>
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState message="কোনো অগ্রিম/ঋণ নেই" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>তারিখ</th><th>কর্মচারী</th><th>ধরন</th><th className="text-right">টাকা</th><th className="text-right">মাসিক কিস্তি</th><th className="text-right">আদায় (চূড়ান্ত বেতনে)</th><th className="text-right">বাকি</th><th /></tr></thead>
              <tbody>
                {rows.map((a) => {
                  const e = emps.get(a.employeeId);
                  return (
                    <tr key={a.id}>
                      <td>{formatDate(a.date)}</td>
                      <td>{e ? <Link prefetch={false} href={`/payroll/employees/${e.id}`} className="hover:underline">{e.code} · {e.name}</Link> : "—"}{a.note && <span className="block text-xs text-slate-400">{a.note}</span>}</td>
                      <td><Badge tone={a.kind === "LOAN" ? "blue" : "slate"}>{a.kind === "LOAN" ? "ঋণ" : "অগ্রিম"}</Badge></td>
                      <td className="num">{formatMoney(a.amountN, cur)}</td>
                      <td className="num">{formatMoney(a.installmentN, cur)}</td>
                      <td className="num">{formatMoney(a.recovered, cur)}</td>
                      <td className="num font-semibold">{a.outstanding > 0.004 ? formatMoney(a.outstanding, cur) : <Badge tone="green">আদায় সম্পন্ন</Badge>}</td>
                      <td>{can(ctx, "payroll:pay") && !draftLines.has(a.id) && <ActionButton action={deleteAdvanceAction.bind(null, a.id)} label="বাতিল" className="btn-ghost btn-sm text-credit" confirmText="অগ্রিম/ঋণ ও এর পেমেন্ট ভাউচার বাতিল হবে। নিশ্চিত?" />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
    </>
  );
}
