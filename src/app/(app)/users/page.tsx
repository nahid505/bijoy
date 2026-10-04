import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { Badge, PageHeader, TableWrap } from "@/components/ui";
import { requirePermission } from "@/server/auth";

export const metadata: Metadata = { title: "ব্যবহারকারী" };

export default async function UsersPage() {
  const ctx = await requirePermission("users:manage");
  const members = await prisma.membership.findMany({
    where: { businessId: ctx.business.id },
    orderBy: { createdAt: "asc" },
    include: { user: true, role: { select: { name: true, isSystem: true } } },
  });

  return (
    <>
      <PageHeader
        title="ব্যবহারকারী"
        description={`${ctx.business.name} — এ প্রবেশাধিকারপ্রাপ্ত ব্যক্তিরা`}
        actions={<Link prefetch={false} href="/users/new" className="btn-primary">+ নতুন ব্যবহারকারী</Link>}
      />
      <section className="panel">
        <TableWrap>
          <table className="table">
            <thead><tr><th>নাম</th><th>ইমেইল</th><th>রোল</th><th>শেষ লগইন</th><th>অবস্থা</th><th /></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td className="font-medium">{m.user.name} {m.userId === ctx.user.id && <Badge tone="blue">আপনি</Badge>}</td>
                  <td>{m.user.email ?? m.user.mobile}</td>
                  <td>{m.role.name} {m.role.isSystem && <Badge tone="amber">মালিক</Badge>}</td>
                  <td className="whitespace-nowrap">{formatDateTime(m.user.lastLoginAt)}</td>
                  <td>{m.isActive && m.user.isActive ? <Badge tone="green">সক্রিয়</Badge> : <Badge tone="red">নিষ্ক্রিয়</Badge>}</td>
                  <td className="text-right"><Link prefetch={false} href={`/users/${m.userId}/edit`} className="btn-secondary btn-sm">সম্পাদনা</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </section>
    </>
  );
}
