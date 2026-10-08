import type { Metadata } from "next";
import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/format";
import { Badge, EmptyState, FilterBar, FilterField, PageHeader, Pagination, TableWrap } from "@/components/ui";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";
import { userList } from "@/server/services/platform-admin";

export const metadata: Metadata = { title: "ব্যবহারকারী — সুপার অ্যাডমিন" };

export default async function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  const p = await readParams(searchParams);
  const page = pageOf(p);
  const { rows, total } = await userList({ search: p.q?.trim(), kind: p.kind, skip: page.skip, take: page.take });
  return (
    <>
      <PageHeader title="ব্যবহারকারী" description="সব কোম্পানির ব্যবহারকারী, তাদের কোম্পানি ও রোল (ব্যবহারকারী তৈরি/পরিবর্তন করে কোম্পানির মালিক বা অ্যাডমিন)" />
      <section className="panel">
        <FilterBar action="/admin/users">
          <FilterField label="খুঁজুন"><input name="q" defaultValue={p.q ?? ""} placeholder="নাম, মোবাইল, ইমেইল, কোম্পানি" className="input w-64" /></FilterField>
          <FilterField label="ধরন">
            <select name="kind" defaultValue={p.kind ?? ""} className="input w-36">
              <option value="">সব</option><option value="active">সক্রিয়</option><option value="inactive">নিষ্ক্রিয়</option><option value="super">সুপার অ্যাডমিন</option>
            </select>
          </FilterField>
        </FilterBar>
        {rows.length === 0 ? <EmptyState message="কোনো ব্যবহারকারী পাওয়া যায়নি" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>নাম</th><th>মোবাইল / ইমেইল</th><th>কোম্পানি ও রোল</th><th>শেষ লগইন</th><th>যোগদান</th><th>অবস্থা</th></tr></thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td className="font-medium">{u.name}{u.isSuperAdmin && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800">SUPER</span>}</td>
                    <td className="text-sm">{u.mobile ?? "—"}<span className="block text-xs text-slate-400">{u.email ?? ""}</span></td>
                    <td className="text-sm">
                      {u.memberships.length === 0 ? "—" : u.memberships.map((m) => (
                        <span key={m.business.id} className={`block ${m.isActive ? "" : "text-slate-400 line-through"}`}>
                          <Link prefetch={false} href={`/admin/companies/${m.business.id}`} className="hover:underline">{m.business.name}</Link> <span className="text-xs text-slate-500">· {m.role.name}</span>
                        </span>
                      ))}
                    </td>
                    <td className="whitespace-nowrap text-sm">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "—"}</td>
                    <td className="text-sm">{formatDate(u.createdAt)}</td>
                    <td>{u.isActive ? <Badge tone="green">সক্রিয়</Badge> : <Badge tone="slate">নিষ্ক্রিয়</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath="/admin/users" params={p} page={page.page} totalPages={totalPages(total)} total={total} />
      </section>
    </>
  );
}
