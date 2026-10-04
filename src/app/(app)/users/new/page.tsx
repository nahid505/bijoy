import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { saveMemberAction } from "@/server/actions/business";
import { UserForm } from "../user-form";

export const metadata: Metadata = { title: "নতুন ব্যবহারকারী" };

export default async function NewUserPage() {
  const ctx = await requirePermission("users:manage");
  const roles = await prisma.role.findMany({ where: { businessId: ctx.business.id }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  return (
    <>
      <PageHeader title="নতুন ব্যবহারকারী" crumbs={[{ label: "ব্যবহারকারী", href: "/users" }, { label: "নতুন" }]} />
      <section className="panel max-w-3xl p-5">
        <UserForm action={saveMemberAction.bind(null, null)} roles={roles} isEdit={false} />
      </section>
    </>
  );
}
