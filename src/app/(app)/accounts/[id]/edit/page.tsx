import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { accountGroupOptions } from "@/server/services/master";
import { getAccountOpening } from "@/server/services/accounting";
import { saveAccountAction } from "@/server/actions/masters";
import { AccountForm } from "../../account-form";

export const metadata: Metadata = { title: "হিসাব সম্পাদনা" };

export default async function EditAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("accounts:manage");
  const { id } = await params;
  const a = await prisma.account.findFirst({ where: { id, businessId: ctx.business.id }, include: { customer: true, supplier: true } });
  if (!a) notFound();
  if (a.customer) redirect(`/customers/${a.customer.id}/edit`);
  if (a.supplier) redirect(`/suppliers/${a.supplier.id}/edit`);
  const groups = await accountGroupOptions(ctx.business.id);
  const opening = await getAccountOpening(prisma, ctx.business.id, a.id);
  return (
    <>
      <PageHeader title={`সম্পাদনা: ${a.name}`} crumbs={[{ label: "লেজার", href: "/accounts" }, { label: a.name, href: `/accounts/${a.id}` }, { label: "সম্পাদনা" }]} />
      <section className="panel max-w-3xl p-5">
        <AccountForm
          action={saveAccountAction.bind(null, a.id)}
          groups={groups}
          lockGroup={a.isSystem}
          cancelHref={`/accounts/${a.id}`}
          defaults={{ name: a.name, code: a.code, groupId: a.groupId, description: a.description, bankName: a.bankName, accountNumber: a.accountNumber, openingBalance: Math.abs(opening), openingSide: opening < 0 ? "CR" : "DR" }}
        />
      </section>
    </>
  );
}
