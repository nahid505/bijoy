import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { saveRoleAction } from "@/server/actions/business";
import { RoleForm } from "../role-form";

export const metadata: Metadata = { title: "নতুন রোল" };

export default async function NewRolePage() {
  await requirePermission("roles:manage");
  return (
    <>
      <PageHeader title="নতুন রোল" crumbs={[{ label: "রোল ও অনুমতি", href: "/roles" }, { label: "নতুন" }]} />
      <section className="panel p-5"><RoleForm action={saveRoleAction.bind(null, null)} /></section>
    </>
  );
}
