import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate, toBnDigits } from "@/lib/format";
import { Badge, EmptyState, FilterBar, FilterField, PageHeader, Pagination, TableWrap } from "@/components/ui";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";

export const metadata: Metadata = { title: "কোম্পানি গ্রুপ — সুপার অ্যাডমিন" };

export default async function AdminGroupsPage({ searchParams }: { searchParams: SearchParams }) {
  const p = await readParams(searchParams);
  const page = pageOf(p);
  const search = p.q?.trim();

  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { code: { contains: search, mode: "insensitive" as const } },
          { description: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [total, rows] = await Promise.all([
    prisma.companyGroup.count({ where }),
    prisma.companyGroup.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: page.skip,
      take: page.take,
      include: {
        businesses: {
          select: { id: true, name: true, isParent: true, intercompanyCode: true, isActive: true },
          orderBy: [{ isParent: "desc" }, { name: "asc" }],
        },
        roles: {
          select: { id: true, name: true },
        },
        memberships: {
          where: { isActive: true },
          include: {
            user: { select: { id: true, name: true, email: true, mobile: true } },
            role: { select: { id: true, name: true } },
          },
        },
        _count: {
          select: {
            businesses: true,
            roles: true,
            memberships: true,
          },
        },
      },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="কোম্পানি গ্রুপ ও কনগ্লোমারেট"
        description="প্ল্যাটফর্মের সকল মাল্টি-কোম্পানি গ্রুপ, সিস্টার কনসার্ন ও সেন্ট্রাল আইএএম প্রশাসন"
      />
      <section className="panel">
        <FilterBar action="/admin/groups">
          <FilterField label="খুঁজুন">
            <input
              name="q"
              defaultValue={p.q ?? ""}
              placeholder="গ্রুপের নাম, কোড বা বিবরণ..."
              className="input w-72"
            />
          </FilterField>
        </FilterBar>

        {rows.length === 0 ? (
          <EmptyState message="কোনো কোম্পানি গ্রুপ পাওয়া যায়নি" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>গ্রুপের নাম ও কোড</th>
                  <th>মূল প্রতিষ্ঠান (Parent)</th>
                  <th>সিস্টার কনসার্ন</th>
                  <th>সেন্ট্রাল রোল</th>
                  <th>সক্রিয় সেন্ট্রাল সদস্য</th>
                  <th>তৈরি</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((group) => {
                  const parentBusiness = group.businesses.find((b) => b.isParent);
                  const sisterConcerns = group.businesses.filter((b) => !b.isParent);
                  return (
                    <tr key={group.id}>
                      <td>
                        <div className="font-semibold text-ink-900">{group.name}</div>
                        {group.code && (
                          <span className="font-mono text-xs text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded">
                            {group.code}
                          </span>
                        )}
                        {group.description && (
                          <div className="text-xs text-ink-500 mt-0.5 line-clamp-1">{group.description}</div>
                        )}
                      </td>
                      <td>
                        {parentBusiness ? (
                          <Link
                            prefetch={false}
                            href={`/admin/companies/${parentBusiness.id}`}
                            className="font-medium text-emerald-700 hover:underline flex items-center gap-1"
                          >
                            <span>🏢 {parentBusiness.name}</span>
                            {parentBusiness.intercompanyCode && (
                              <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1 rounded font-mono">
                                {parentBusiness.intercompanyCode}
                              </span>
                            )}
                          </Link>
                        ) : (
                          <span className="text-xs text-ink-400 italic">মূল প্রতিষ্ঠান নির্ধারিত নেই</span>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {sisterConcerns.length === 0 ? (
                            <span className="text-xs text-ink-400">কোনো সিস্টার কনসার্ন নেই</span>
                          ) : (
                            sisterConcerns.map((sc) => (
                              <Link
                                key={sc.id}
                                prefetch={false}
                                href={`/admin/companies/${sc.id}`}
                                className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-200"
                              >
                                <span>{sc.name}</span>
                                {sc.intercompanyCode && (
                                  <span className="font-mono text-[10px] text-slate-500">({sc.intercompanyCode})</span>
                                )}
                              </Link>
                            ))
                          )}
                        </div>
                        <div className="text-[11px] text-ink-400 mt-1">
                          মোট প্রতিষ্ঠান: {toBnDigits(group._count.businesses)} টি
                        </div>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {group.roles.length === 0 ? (
                            <span className="text-xs text-ink-400">—</span>
                          ) : (
                            group.roles.map((r) => (
                              <Badge key={r.id} tone="slate">
                                {r.name}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="space-y-0.5">
                          {group.memberships.length === 0 ? (
                            <span className="text-xs text-ink-400">কোনো সেন্ট্রাল সদস্য নেই</span>
                          ) : (
                            group.memberships.slice(0, 3).map((m) => (
                              <div key={m.id} className="text-xs flex items-center gap-1 text-ink-700">
                                <span className="font-medium">{m.user.name}</span>
                                <span className="text-[10px] text-ink-500">({m.role.name})</span>
                              </div>
                            ))
                          )}
                          {group.memberships.length > 3 && (
                            <span className="text-[11px] text-ink-400">
                              + আরো {toBnDigits(group.memberships.length - 3)} জন
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-xs text-ink-500 whitespace-nowrap">
                        {formatDate(group.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}

        <Pagination
          basePath="/admin/groups"
          params={p}
          page={page.page}
          totalPages={totalPages(total)}
          total={total}
        />
      </section>
    </>
  );
}
