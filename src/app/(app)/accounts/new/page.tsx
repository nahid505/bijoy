import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { saveAccountAction } from "@/server/actions/masters";
import { AccountForm } from "../account-form";

export const metadata: Metadata = { title: "নতুন হিসাব" };

export default async function NewAccountPage() {
  const ctx = await requirePermission("accounts:manage");
  const groups = await prisma.accountGroup.findMany({
    where: { businessId: ctx.business.id, NOT: { systemKey: { in: ["SUNDRY_DEBTORS", "SUNDRY_CREDITORS"] } } },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, nature: true, systemKey: true },
  });
  return (
    <>
      <PageHeader title="নতুন হিসাব (লেজার)" description="কাস্টমার ও সরবরাহকারীর হিসাব তাদের নিজস্ব পাতা থেকে স্বয়ংক্রিয়ভাবে খোলা হয়" crumbs={[{ label: "লেজার", href: "/accounts" }, { label: "নতুন" }]} />
      <section className="panel max-w-3xl p-5"><AccountForm action={saveAccountAction.bind(null, null)} groups={groups} cancelHref="/accounts" /></section>
    </>
  );
}
