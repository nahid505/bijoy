import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { EmptyState, FilterBar, FilterField, PageHeader, Pagination, TableWrap } from "@/components/ui";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";
import { dayRange } from "@/server/services/platform-admin";
import { ci, ciEquals } from "@/lib/dialect";

export const metadata: Metadata = { title: "অডিট লগ — সুপার অ্যাডমিন" };
const ACTIONS = ["CREATE", "UPDATE", "DELETE", "LOGIN", "LOGOUT", "LOGIN_FAILED"];

/** Platform-wide audit trail: every company's log plus platform actions (plans, settings, super admin). */
export default async function AdminAuditPage({ searchParams }: { searchParams: SearchParams }) {
  const p = await readParams(searchParams);
  const page = pageOf(p);
  const range = dayRange(p.from, p.to);
  const where: Prisma.AuditLogWhereInput = {
    ...(p.company === "platform" ? { businessId: null } : p.q ? { business: { name: ci(p.q) } } : {}),
    ...(p.user ? { user: { OR: [{ name: ci(p.user) }, { mobile: { contains: p.user } }, { email: ci(p.user) }] } } : {}),
    ...(p.action && ACTIONS.includes(p.action) ? { action: p.action } : {}),
    ...(p.entity ? { entity: ciEquals(p.entity) } : {}),
    ...(range ? { createdAt: range } : {}),
  };
  const [rows, total, entities] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: page.skip, take: page.take, include: { business: { select: { id: true, name: true } }, user: { select: { name: true, isSuperAdmin: true } } } }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ distinct: ["entity"], select: { entity: true }, orderBy: { entity: "asc" }, take: 100 }),
  ]);
  return (
    <>
      <PageHeader title="অডিট লগ" description="লগইন/লগআউট, রেজিস্ট্রেশন, ব্যবহারকারী ও রোল, ফিচার, প্ল্যান, সাবস্ক্রিপশন, পেমেন্ট, রিফান্ড ও হিসাবের পরিবর্তন" />
      <section className="panel">
        <FilterBar action="/admin/audit">
          <FilterField label="কোম্পানি"><input name="q" defaultValue={p.q ?? ""} className="input w-44" /></FilterField>
          <FilterField label="পরিধি">
            <select name="company" defaultValue={p.company ?? ""} className="input w-36"><option value="">সব</option><option value="platform">শুধু প্ল্যাটফর্ম</option></select>
          </FilterField>
          <FilterField label="ব্যবহারকারী"><input name="user" defaultValue={p.user ?? ""} className="input w-40" /></FilterField>
          <FilterField label="কাজ">
            <select name="action" defaultValue={p.action ?? ""} className="input w-32"><option value="">সব</option>{ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}</select>
          </FilterField>
          <FilterField label="মডিউল">
            <select name="entity" defaultValue={p.entity ?? ""} className="input w-36"><option value="">সব</option>{entities.map((e) => <option key={e.entity} value={e.entity}>{e.entity}</option>)}</select>
          </FilterField>
          <FilterField label="তারিখ থেকে"><input type="date" name="from" defaultValue={p.from ?? ""} className="input w-40" /></FilterField>
          <FilterField label="পর্যন্ত"><input type="date" name="to" defaultValue={p.to ?? ""} className="input w-40" /></FilterField>
        </FilterBar>
        {rows.length === 0 ? <EmptyState message="কোনো রেকর্ড নেই" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>সময়</th><th>কোম্পানি</th><th>ব্যবহারকারী</th><th>কাজ</th><th>মডিউল / রেকর্ড</th><th>বিবরণ</th><th>IP</th></tr></thead>
              <tbody>
                {rows.map((a) => {
                  const details = a.details ? JSON.stringify(a.details) : "";
                  return (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap text-sm">{formatDateTime(a.createdAt)}</td>
                      <td className="text-sm">{a.business ? <Link prefetch={false} href={`/admin/companies/${a.business.id}`} className="hover:underline">{a.business.name}</Link> : <span className="text-slate-400">প্ল্যাটফর্ম</span>}</td>
                      <td className="text-sm">{a.user?.name ?? "—"}{a.user?.isSuperAdmin && <span className="ml-1 text-[10px] font-bold text-amber-700">SUPER</span>}</td>
                      <td className="text-xs font-semibold">{a.action}</td>
                      <td className="text-sm">{a.entity}<span className="block font-mono text-[11px] text-slate-400">{a.entityId ?? ""}</span></td>
                      <td className="max-w-sm truncate font-mono text-[11px] text-slate-500" title={details}>{details}</td>
                      <td className="font-mono text-[11px] text-slate-500">{a.ipAddress ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath="/admin/audit" params={p} page={page.page} totalPages={totalPages(total)} total={total} />
      </section>
    </>
  );
}
