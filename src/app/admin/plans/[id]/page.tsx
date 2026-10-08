import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma, num } from "@/lib/db";
import { FEATURES, type FeatureDef } from "@/lib/features";
import { ActionButton } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { adminDeletePlanAction, adminSavePlanAction } from "@/server/actions/admin";
import { PlanForm } from "../../plan-form";

export const metadata: Metadata = { title: "প্ল্যান — সুপার অ্যাডমিন" };

/** /admin/plans/new or /admin/plans/<id> */
export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = id === "new" ? null : await prisma.plan.findUnique({ where: { id }, include: { features: true, _count: { select: { subscriptions: true, transactions: true } } } });
  if (id !== "new" && !plan) notFound();
  const features = (FEATURES as readonly FeatureDef[]).map((f) => ({ key: f.key, nameBn: f.nameBn, nameEn: f.nameEn, icon: f.icon, soon: f.status === "COMING_SOON" }));
  return (
    <>
      <PageHeader
        title={plan ? `প্ল্যান: ${plan.nameBn}` : "নতুন প্ল্যান"}
        crumbs={[{ label: "প্ল্যান", href: "/admin/plans" }, { label: plan ? plan.nameBn : "নতুন" }]}
        actions={plan && plan._count.subscriptions + plan._count.transactions === 0 ? <ActionButton action={adminDeletePlanAction.bind(null, plan.id)} label="মুছুন" className="btn-danger" confirmText="প্ল্যানটি মুছবেন?" /> : undefined}
      />
      {plan && plan._count.subscriptions > 0 && <p className="mb-3 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800 ring-1 ring-sky-200">{plan._count.subscriptions}টি কোম্পানি এই প্ল্যানে আছে — মূল্য পরিবর্তন পরবর্তী পেমেন্ট থেকে প্রযোজ্য, ফিচার পরিবর্তন সাথে সাথে।</p>}
      <section className="panel p-5">
        <PlanForm
          action={adminSavePlanAction.bind(null, plan?.id ?? null)}
          features={features}
          defaults={plan
            ? { code: plan.code, nameBn: plan.nameBn, nameEn: plan.nameEn, descriptionBn: plan.descriptionBn ?? "", descriptionEn: plan.descriptionEn ?? "", priceMonthly: num(plan.priceMonthly), priceYearly: num(plan.priceYearly), userLimit: plan.userLimit === null ? "" : String(plan.userLimit), isActive: plan.isActive, isPublic: plan.isPublic, sortOrder: plan.sortOrder, features: plan.features.map((f) => f.featureKey) }
            : { code: "", nameBn: "", nameEn: "", descriptionBn: "", descriptionEn: "", priceMonthly: 0, priceYearly: 0, userLimit: "5", isActive: true, isPublic: true, sortOrder: 100, features: ["ACCOUNTING", "SALES", "CUSTOMER"] }}
        />
      </section>
    </>
  );
}
