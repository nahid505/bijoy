import React from "react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { getT } from "@/server/i18n";
import { prisma } from "@/lib/db";
import { getIntercompanyReconciliationData } from "@/server/services/intercompany";
import { listSisterConcerns } from "@/server/services/company-group";
import { ReconciliationClient } from "./reconciliation-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("আন্তঃপ্রতিষ্ঠান রিকনসিলিয়েশন ড্যাশবোর্ড (Inter-Company Reconciliation)") };
}

export default async function IntercompanyReconciliationPage() {
  const ctx = await requirePermission(["vouchers:view", "purchases:view", "sales:view"]);
  const t = await getT();

  // 1. Load sister concerns in the group
  const groupData = await listSisterConcerns(ctx.business.id);

  // 2. Load warehouses for current business
  const warehouses = await prisma.warehouse.findMany({
    where: { businessId: ctx.business.id },
    select: { id: true, name: true, isDefault: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  // 3. Load reconciliation data for current business
  const { summary, records } = await getIntercompanyReconciliationData(ctx.business.id);

  const sisterConcernsList = groupData.sisterConcerns.map((s) => ({
    id: s.id,
    name: s.name,
    intercompanyCode: s.intercompanyCode,
    isParent: s.isParent,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="আন্তঃপ্রতিষ্ঠান রিকনসিলিয়েশন ড্যাশবোর্ড"
        description={
          groupData.inGroup
            ? `${groupData.group?.name || "এন্টারপ্রাইজ গ্রুপ"} — সিস্টার কনসার্নগুলোর দ্বিপাক্ষিক ক্রয়-বিক্রয় সমন্বয় ও কন্ট্রা খতিয়ান`
            : "সিস্টার কনসার্নগুলোর পারস্পরিক লেনদেন ও দ্বিপাক্ষিক রিকনসিলিয়েশন ট্র্যাকার"
        }
        crumbs={[
          { label: "ড্যাশবোর্ড", href: "/dashboard" },
          { label: "আন্তঃপ্রতিষ্ঠান সমন্বয়", href: "/intercompany/reconciliation" },
        ]}
      />

      <ReconciliationClient
        initialSummary={summary}
        initialRecords={records}
        sisterConcerns={sisterConcernsList}
        warehouses={warehouses}
        activeBusinessId={ctx.business.id}
        currency={ctx.business.currencySymbol}
      />
    </div>
  );
}
