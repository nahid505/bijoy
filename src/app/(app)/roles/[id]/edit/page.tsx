import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ActionButton } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { deleteRoleAction, saveRoleAction } from "@/server/actions/business";
import { RoleForm } from "../../role-form";

export const metadata: Metadata = { title: "রোল সম্পাদনা" };

export default async function EditRolePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("roles:manage");
  const { id } = await params;
  const role = await prisma.role.findFirst({ where: { id, businessId: ctx.business.id } });
  if (!role) notFound();
  return (
    <>
      <PageHeader
        title={role.isSystem ? `রোল: ${role.name}` : `সম্পাদনা: ${role.name}`}
        description={role.isSystem ? "মালিক রোল পরিবর্তন বা মুছা যায় না" : undefined}
        crumbs={[{ label: "রোল ও অনুমতি", href: "/roles" }, { label: role.name }]}
        actions={!role.isSystem && <ActionButton action={deleteRoleAction.bind(null, role.id)} label="মুছুন" className="btn-danger" confirmText="রোলটি মুছে ফেলতে চান?" />}
      />
      <section className="panel p-5"><RoleForm action={saveRoleAction.bind(null, role.id)} defaults={role} readOnly={role.isSystem} /></section>
    </>
  );
}
