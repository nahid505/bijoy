import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { saveMemberAction } from "@/server/actions/business";
import { isRestricted, roleChoices } from "@/server/party-scope";
import { isDepot } from "@/lib/depot";
import { UserForm } from "../user-form";

export const metadata: Metadata = { title: "নতুন ব্যবহারকারী" };

export default async function NewUserPage() {
  const ctx = await requirePermission("users:manage");
  const [roles, allGroups, allCashAccounts] = await Promise.all([
    roleChoices(ctx.business.id),
    prisma.accountGroup.findMany({
      where: { businessId: ctx.business.id },
      select: { id: true, name: true, nature: true, parentId: true, parent: { select: { name: true } } },
      orderBy: [{ nature: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.account.findMany({
      where: { businessId: ctx.business.id, isActive: true, kind: { in: ["CASH", "BANK"] } },
      select: { id: true, name: true, kind: true, code: true, bankName: true, accountNumber: true },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    }),
  ]);
  return (
    <>
      <PageHeader title="নতুন ব্যবহারকারী" crumbs={[{ label: "ব্যবহারকারী", href: "/users" }, { label: "নতুন" }]} />
      <section className="panel max-w-3xl p-5">
        <UserForm
          action={saveMemberAction.bind(null, null)}
          roles={roles}
          isEdit={false}
          assigned={isRestricted(ctx) ? null : { customers: [], suppliers: [], dealers: [], accounts: [], accountGroupIds: [], paymentAccountIds: [] }}
          allGroups={allGroups.map((g) => ({ id: g.id, name: g.name, nature: g.nature, parentId: g.parentId, parentName: g.parent?.name }))}
          allCashAccounts={allCashAccounts}
          depot={isDepot(ctx.business.businessType)}
        />
      </section>
    </>
  );
}
