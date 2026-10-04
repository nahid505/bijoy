import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ActionButton } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { removeMemberAction, saveMemberAction } from "@/server/actions/business";
import { UserForm } from "../../user-form";

export const metadata: Metadata = { title: "ব্যবহারকারী সম্পাদনা" };

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("users:manage");
  const { id } = await params;
  const [membership, roles] = await Promise.all([
    prisma.membership.findUnique({ where: { userId_businessId: { userId: id, businessId: ctx.business.id } }, include: { user: true } }),
    prisma.role.findMany({ where: { businessId: ctx.business.id }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!membership) notFound();
  return (
    <>
      <PageHeader
        title={`সম্পাদনা: ${membership.user.name}`}
        crumbs={[{ label: "ব্যবহারকারী", href: "/users" }, { label: membership.user.name }]}
        actions={id !== ctx.user.id && <ActionButton action={removeMemberAction.bind(null, id)} label="এই ব্যবসা থেকে সরান" className="btn-danger" confirmText="ব্যবহারকারীকে এই ব্যবসা থেকে সরাতে চান?" />}
      />
      <section className="panel max-w-3xl p-5">
        <UserForm
          action={saveMemberAction.bind(null, id)}
          roles={roles}
          isEdit
          defaults={{ name: membership.user.name, email: membership.user.email ?? "", roleId: membership.roleId, isActive: membership.isActive }}
        />
      </section>
    </>
  );
}
