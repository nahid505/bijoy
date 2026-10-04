import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma, num } from "@/lib/db";
import { PAY_RULES } from "@/lib/payroll";
import { ActionButton } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { requirePayroll } from "@/server/payroll-context";
import { deletePayComponentAction, savePayComponentAction } from "@/server/actions/payroll";
import { AUTO_COMPONENTS } from "@/server/services/payroll";
import { accountOptions } from "@/server/voucher-editor";
import { ComponentForm } from "../../../payroll-forms";

export const metadata: Metadata = { title: "বেতনের উপাদান" };

/** /payroll/settings/components/new or /payroll/settings/components/<id> */
export default async function ComponentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePayroll("payroll:manage");
  const isNew = id === "new";
  const c = isNew ? null : await prisma.payComponent.findFirst({ where: { id, businessId: ctx.business.id }, include: { _count: { select: { employeeLines: true, payslipLines: true } } } });
  if (!isNew && !c) notFound();
  const known = c ? await accountOptions(ctx.business.id, { id: { in: [c.accountId, c.liabilityAccountId].filter(Boolean) as string[] } }, false, true) : [];
  const auto = (AUTO_COMPONENTS as readonly string[]).includes(c?.systemKey ?? "");
  const deletable = c && !c.systemKey && c._count.employeeLines + c._count.payslipLines === 0;
  return (
    <>
      <PageHeader
        title={c ? c.name : "নতুন বেতনের উপাদান"}
        description="ভাতা, কর্তন বা প্রতিষ্ঠানের অবদান — কোন লেজারে পোস্ট হবে তা এখানে নির্ধারিত হয়"
        crumbs={[{ label: "বেতন", href: "/payroll" }, { label: "সেটিং", href: "/payroll/settings" }, { label: c ? c.name : "নতুন উপাদান" }]}
        actions={deletable ? <ActionButton action={deletePayComponentAction.bind(null, c.id)} label="মুছুন" className="btn-danger" confirmText="উপাদানটি মুছবেন?" /> : undefined}
      />
      <section className="panel max-w-3xl p-5">
        <ComponentForm
          action={savePayComponentAction.bind(null, c?.id ?? null)}
          auto={auto}
          rules={Object.entries(PAY_RULES).map(([key, r]) => ({ key, label: r.label }))}
          known={known}
          currency={ctx.business.currencySymbol}
          cancelHref="/payroll/settings#components"
          defaults={
            c
              ? { name: c.name, kind: c.kind, calcType: c.calcType, defaultValue: num(c.defaultValue), ruleKey: c.ruleKey ?? "", appliesTo: c.appliesTo, accountId: c.accountId ?? "", liabilityAccountId: c.liabilityAccountId ?? "", taxable: c.taxable, isActive: c.isActive, sortOrder: c.sortOrder }
              : { name: "", kind: "EARNING", calcType: "FIXED", defaultValue: 0, ruleKey: "", appliesTo: "REGULAR", accountId: "", liabilityAccountId: "", taxable: true, isActive: true, sortOrder: 100 }
          }
        />
      </section>
    </>
  );
}
