import type { Metadata } from "next";
import Link from "next/link";
import type { PaymentStatus, Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { formatDateTime, formatMoney, toBnDigits } from "@/lib/format";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Badge, EmptyState, FilterBar, FilterField, PageHeader, Pagination, TableWrap } from "@/components/ui";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";
import { adminApprovePaymentAction, adminRefundPaymentAction, adminRejectPaymentAction } from "@/server/actions/admin";
import { dayRange } from "@/server/services/platform-admin";
import { ci } from "@/lib/dialect";

export const metadata: Metadata = { title: "পেমেন্ট — সুপার অ্যাডমিন" };
const STATUSES: { key: PaymentStatus; label: string; tone: "green" | "amber" | "red" | "slate" | "blue" }[] = [
  { key: "SUCCESS", label: "সফল", tone: "green" }, { key: "PENDING", label: "যাচাই বাকি", tone: "amber" }, { key: "FAILED", label: "ব্যর্থ", tone: "red" },
  { key: "INITIATED", label: "শুরু হয়েছে", tone: "slate" }, { key: "CANCELLED", label: "বাতিল", tone: "slate" }, { key: "REFUNDED", label: "রিফান্ড", tone: "blue" },
];

export default async function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  const p = await readParams(searchParams);
  const status = STATUSES.find((s) => s.key === p.status)?.key;
  const range = dayRange(p.from, p.to);
  const plans = await prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, code: true, nameBn: true } });
  const plan = plans.find((x) => x.code === p.plan);
  const base: Prisma.PaymentTransactionWhereInput = {
    ...(plan ? { planId: plan.id } : {}),
    ...(range ? { createdAt: range } : {}),
    ...(p.q ? { OR: [{ providerTrxId: { contains: p.q } }, { manualReference: { contains: p.q.toUpperCase() } }, { business: { name: ci(p.q) } }] } : {}),
  };
  const where = { ...base, ...(status ? { status } : {}) };
  const page = pageOf(p);
  const [rows, total, sums] = await Promise.all([
    prisma.paymentTransaction.findMany({ where, orderBy: { createdAt: "desc" }, skip: page.skip, take: page.take, include: { business: { select: { id: true, name: true } }, plan: { select: { nameBn: true } } } }),
    prisma.paymentTransaction.count({ where }),
    prisma.paymentTransaction.groupBy({ by: ["status"], where: base, _count: true, _sum: { amount: true } }),
  ]);
  const sum = (s: PaymentStatus) => sums.find((x) => x.status === s);
  const link = (s?: PaymentStatus) => `/admin/payments?${new URLSearchParams({ ...(p.q ? { q: p.q } : {}), ...(p.plan ? { plan: p.plan } : {}), ...(p.from ? { from: p.from } : {}), ...(p.to ? { to: p.to } : {}), ...(s ? { status: s } : {}) })}`;
  return (
    <>
      <PageHeader title="পেমেন্ট" description="সব গেটওয়ে ও ম্যানুয়াল পেমেন্ট — সফল, ব্যর্থ, যাচাই বাকি ও রিফান্ড" />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {STATUSES.map((s) => (
          <Link key={s.key} prefetch={false} href={link(s.key)} className={`panel p-3 hover:ring-2 hover:ring-brand-200 ${status === s.key ? "ring-2 ring-brand-500" : ""}`}>
            <span className="text-xs text-slate-500">{s.label}</span>
            <span className="block text-lg font-bold tabular-nums">{toBnDigits(sum(s.key)?._count ?? 0)}</span>
            <span className="text-xs tabular-nums text-slate-500">{formatMoney(num(sum(s.key)?._sum.amount ?? 0), "৳")}</span>
          </Link>
        ))}
      </div>
      <section className="panel">
        <FilterBar action="/admin/payments">
          <FilterField label="খুঁজুন"><input name="q" defaultValue={p.q ?? ""} placeholder="কোম্পানি বা TrxID" className="input w-48" /></FilterField>
          <FilterField label="অবস্থা">
            <select name="status" defaultValue={status ?? ""} className="input w-32"><option value="">সব</option>{STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
          </FilterField>
          <FilterField label="প্ল্যান">
            <select name="plan" defaultValue={plan?.code ?? ""} className="input w-32"><option value="">সব</option>{plans.map((x) => <option key={x.code} value={x.code}>{x.nameBn}</option>)}</select>
          </FilterField>
          <FilterField label="তারিখ থেকে"><input type="date" name="from" defaultValue={p.from ?? ""} className="input w-40" /></FilterField>
          <FilterField label="পর্যন্ত"><input type="date" name="to" defaultValue={p.to ?? ""} className="input w-40" /></FilterField>
        </FilterBar>
        {rows.length === 0 ? <EmptyState message="কোনো পেমেন্ট নেই" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>তারিখ</th><th>কোম্পানি</th><th>প্ল্যান</th><th>মাধ্যম / TrxID</th><th className="text-right">টাকা</th><th>অবস্থা</th><th /></tr></thead>
              <tbody>
                {rows.map((t) => {
                  const st = STATUSES.find((s) => s.key === t.status)!;
                  return (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap text-sm">{formatDateTime(t.createdAt)}</td>
                      <td><Link prefetch={false} href={`/admin/companies/${t.business.id}`} className="hover:underline">{t.business.name}</Link></td>
                      <td className="text-sm">{t.plan.nameBn} · {t.billingCycle === "YEARLY" ? "বার্ষিক" : "মাসিক"}</td>
                      <td className="text-sm">{t.provider}<span className="block font-mono text-xs text-slate-500">{t.providerTrxId ?? t.manualReference ?? "—"}</span></td>
                      <td className="num">{formatMoney(num(t.amount), "৳")}</td>
                      <td><Badge tone={st.tone}>{st.label}</Badge>{t.failureReason && <span className="block max-w-xs truncate text-xs text-slate-400" title={t.failureReason}>{t.failureReason}</span>}</td>
                      <td>
                        {t.status === "PENDING" && t.provider === "manual" && (
                          <span className="inline-flex gap-1">
                            <ActionButton action={adminApprovePaymentAction.bind(null, t.id)} label="অনুমোদন" className="btn-primary btn-sm" confirmText={`TrxID ${t.manualReference} এর ${formatMoney(num(t.amount), "৳")} পাওয়া গেছে নিশ্চিত?`} />
                            <ActionButton action={adminRejectPaymentAction.bind(null, t.id)} label="প্রত্যাখ্যান" className="btn-ghost btn-sm text-credit" confirmText="পেমেন্ট প্রত্যাখ্যান করবেন?" />
                          </span>
                        )}
                        {t.status === "SUCCESS" && (
                          <details className="text-sm">
                            <summary className="cursor-pointer text-xs text-slate-500 hover:text-ink-800">রিফান্ড</summary>
                            <ActionForm action={adminRefundPaymentAction.bind(null, t.id)} className="mt-1 flex gap-1">
                              <input name="reason" required minLength={3} maxLength={200} placeholder="কারণ" aria-label="রিফান্ডের কারণ" className="input w-36" />
                              <SubmitButton className="btn-danger btn-sm">রেকর্ড</SubmitButton>
                            </ActionForm>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath="/admin/payments" params={p} page={page.page} totalPages={totalPages(total)} total={total} />
      </section>
    </>
  );
}
