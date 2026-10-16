import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { accountGroupOptions } from "@/server/services/master";
import { saveAccountAction } from "@/server/actions/masters";
import { AccountForm } from "../account-form";

export const metadata: Metadata = { title: "নতুন হিসাব" };

export default async function NewAccountPage() {
  const ctx = await requirePermission("accounts:manage");
  const groups = await accountGroupOptions(ctx.business.id);
  return (
    <>
      <PageHeader title="নতুন হিসাব (লেজার)" description="কাস্টমার ও সরবরাহকারীর হিসাব তাদের নিজস্ব পাতা থেকে স্বয়ংক্রিয়ভাবে খোলা হয়" crumbs={[{ label: "লেজার", href: "/accounts" }, { label: "নতুন" }]} />
      <section className="panel max-w-3xl p-5"><AccountForm action={saveAccountAction.bind(null, null)} groups={groups} cancelHref="/accounts" /></section>
    </>
  );
}
