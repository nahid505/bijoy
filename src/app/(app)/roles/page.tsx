import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { toBnDigits } from "@/lib/format";
import { Badge, PageHeader, TableWrap } from "@/components/ui";
import { requirePermission } from "@/server/auth";

export const metadata: Metadata = { title: "রোল ও অনুমতি" };

export default async function RolesPage() {
  const ctx = await requirePermission("roles:manage");
  const roles = await prisma.role.findMany({ where: { businessId: ctx.business.id }, orderBy: { createdAt: "asc" }, include: { _count: { select: { memberships: true } } } });

  return (
    <>
      <PageHeader title="রোল ও অনুমতি" description="প্রতিটি অনুমতি সার্ভারে যাচাই করা হয়" crumbs={[{ label: "ব্যবহারকারী" }, { label: "রোল ও অনুমতি" }]} actions={<Link prefetch={false} href="/roles/new" className="btn-primary">+ নতুন রোল</Link>} />
      <section className="panel">
        <TableWrap>
          <table className="table">
            <thead><tr><th>রোল</th><th>বিবরণ</th><th className="num">অনুমতি</th><th className="num">ব্যবহারকারী</th><th /></tr></thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.name} {r.isSystem && <Badge tone="amber">সিস্টেম</Badge>}</td>
                  <td>{r.description ?? "—"}</td>
                  <td className="num">{r.permissions.includes("*") ? "সব" : `${toBnDigits(r.permissions.length)} / ${toBnDigits(ALL_PERMISSIONS.length)}`}</td>
                  <td className="num">{toBnDigits(r._count.memberships)}</td>
                  <td className="text-right"><Link prefetch={false} href={`/roles/${r.id}/edit`} className="btn-secondary btn-sm">{r.isSystem ? "দেখুন" : "সম্পাদনা"}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </section>
    </>
  );
}
