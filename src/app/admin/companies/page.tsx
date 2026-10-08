import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate, toBnDigits } from "@/lib/format";
import { SUB_STATUS_LABELS, type SubStatus } from "@/lib/subscription";
import { Badge, EmptyState, FilterBar, FilterField, PageHeader, Pagination, TableWrap } from "@/components/ui";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";
import { companyList } from "@/server/services/platform-admin";

export const metadata: Metadata = { title: "কোম্পানি — সুপার অ্যাডমিন" };

export default async function CompaniesPage({ searchParams }: { searchParams: SearchParams }) {
  const p = await readParams(searchParams);
  const page = pageOf(p);
  const [{ total, rows }, plans] = await Promise.all([
    companyList({ search: p.q?.trim(), status: p.status, plan: p.plan, paymentStatus: p.payment, from: p.from, to: p.to, skip: page.skip, take: page.take }),
    prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, nameBn: true } }),
  ]);
  return (
    <>
      <PageHeader title="কোম্পানি" description="সব ব্যবসা (টেন্যান্ট), প্ল্যান ও সাবস্ক্রিপশনের অবস্থা" />
      <section className="panel">
        <FilterBar action="/admin/companies">
          <FilterField label="খুঁজুন"><input name="q" defaultValue={p.q ?? ""} placeholder="কোম্পানি/মালিকের নাম, মোবাইল, ইমেইল" className="input w-64" /></FilterField>
          <FilterField label="অবস্থা">
            <select name="status" defaultValue={p.status ?? ""} className="input w-40">
              <option value="">সব</option>
              {(Object.keys(SUB_STATUS_LABELS) as SubStatus[]).map((s) => <option key={s} value={s}>{SUB_STATUS_LABELS[s].bn}</option>)}
            </select>
          </FilterField>
          <FilterField label="প্ল্যান">
            <select name="plan" defaultValue={p.plan ?? ""} className="input w-36">
              <option value="">সব</option>
              {plans.map((x) => <option key={x.code} value={x.code}>{x.nameBn}</option>)}
            </select>
          </FilterField>
          <FilterField label="পেমেন্ট">
            <select name="payment" defaultValue={p.payment ?? ""} className="input w-32">
              <option value="">সব</option>
              {[["SUCCESS", "সফল"], ["PENDING", "যাচাই বাকি"], ["FAILED", "ব্যর্থ"], ["CANCELLED", "বাতিল"], ["REFUNDED", "রিফান্ড"]].map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </FilterField>
          <FilterField label="নিবন্ধন থেকে"><input type="date" name="from" defaultValue={p.from ?? ""} className="input w-40" /></FilterField>
          <FilterField label="পর্যন্ত"><input type="date" name="to" defaultValue={p.to ?? ""} className="input w-40" /></FilterField>
        </FilterBar>
        {rows.length === 0 ? <EmptyState message="কোনো কোম্পানি পাওয়া যায়নি" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>কোম্পানি</th><th>মালিক</th><th>প্ল্যান</th><th>অবস্থা</th><th>মেয়াদ</th><th>পেমেন্ট</th><th className="text-right">ব্যবহারকারী</th><th>নিবন্ধন</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const st = r.effective ? SUB_STATUS_LABELS[r.effective.status] : null;
                  const end = r.subscription?.status === "TRIAL" ? r.subscription.trialEndsAt : r.subscription?.endDate;
                  return (
                    <tr key={r.id}>
                      <td><Link prefetch={false} href={`/admin/companies/${r.id}`} className="font-medium hover:text-brand-700 hover:underline">{r.name}</Link><span className="block text-xs text-slate-400">{r.mobile ?? ""}</span></td>
                      <td className="text-sm">{r.memberships[0]?.user.name ?? "—"}<span className="block text-xs text-slate-400">{r.memberships[0]?.user.mobile ?? r.memberships[0]?.user.email ?? ""}</span></td>
                      <td>{r.subscription?.plan.nameBn ?? "—"}</td>
                      <td>{st ? <Badge tone={st.tone}>{st.bn}</Badge> : "—"}</td>
                      <td className="text-sm">{end ? formatDate(end) : "চলমান"}</td>
                      <td className="text-xs">{r.subscription?.paymentStatus ?? "—"}</td>
                      <td className="num">{toBnDigits(r._count.memberships)}</td>
                      <td className="text-sm">{formatDate(r.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath="/admin/companies" params={p} page={page.page} totalPages={totalPages(total)} total={total} />
      </section>
    </>
  );
}
