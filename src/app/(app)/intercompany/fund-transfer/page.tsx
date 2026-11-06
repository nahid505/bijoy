import React from "react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { getT } from "@/server/i18n";
import { listSisterConcerns } from "@/server/services/company-group";
import { listBusinessBankAccounts } from "@/server/services/intercompany";
import { FundTransferClient } from "./fund-transfer-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("আন্তঃপ্রতিষ্ঠান তহবিল স্থানান্তর ও ঋণ (Inter-Company Fund Transfer)") };
}

export default async function IntercompanyFundTransferPage() {
  const ctx = await requirePermission(["vouchers:create", "vouchers:view", "accounts:manage"]);
  const t = await getT();

  // 1. Load sister concerns in the group
  const groupData = await listSisterConcerns(ctx.business.id);

  // 2. Load current business cash & bank accounts
  const senderAccounts = await listBusinessBankAccounts(ctx.business.id);

  const sisterConcernsList = groupData.sisterConcerns.map((s) => ({
    id: s.id,
    name: s.name,
    intercompanyCode: s.intercompanyCode,
    isParent: s.isParent,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="১-ক্লিক আন্তঃপ্রতিষ্ঠান তহবিল স্থানান্তর ও ঋণ"
        description={
          groupData.inGroup
            ? `${groupData.group?.name || "এন্টারপ্রাইজ গ্রুপ"} — সিস্টার কনসার্নগুলোর মধ্যে ফান্ড ট্রান্সফার ও ঋণ লেনদেনের স্বয়ংক্রিয় দ্বিপাক্ষিক ভাউচার এন্ট্রি`
            : "সিস্টার কনসার্নগুলোর মধ্যে নগদ ও ব্যাংক তহবিল স্থানান্তরের সমন্বিত ব্যবস্থা"
        }
        crumbs={[
          { label: "ড্যাশবোর্ড", href: "/dashboard" },
          { label: "আন্তঃপ্রতিষ্ঠান সমন্বয়", href: "/intercompany/reconciliation" },
          { label: "তহবিল স্থানান্তর ও ঋণ", href: "/intercompany/fund-transfer" },
        ]}
      />

      <FundTransferClient
        currentBusiness={{
          id: ctx.business.id,
          name: ctx.business.name,
          currencySymbol: ctx.business.currencySymbol,
        }}
        inGroup={groupData.inGroup}
        groupName={groupData.group?.name}
        sisterConcerns={sisterConcernsList}
        initialSenderAccounts={senderAccounts}
      />
    </div>
  );
}
