import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { can, requirePermission } from "@/server/auth";
import { getT } from "@/server/i18n";
import { listAccountGroups } from "@/server/services/master";
import { AccountGroupsClient } from "./account-groups-client";

export const metadata: Metadata = { title: "অ্যাকাউন্ট গ্রুপ ও ক্যাটাগরি সেটিংস" };

export default async function AccountGroupsSettingsPage() {
  const ctx = await requirePermission(["accounts:view", "accounts:manage"]);
  const t = await getT();
  const [groups, countsRaw] = await Promise.all([
    listAccountGroups(ctx.business.id),
    prisma.account.groupBy({
      by: ["groupId"],
      where: { businessId: ctx.business.id },
      _count: { _all: true },
    }),
  ]);

  const accountCounts: Record<string, number> = {};
  for (const row of countsRaw) {
    accountCounts[row.groupId] = row._count._all;
  }
  const canManage = can(ctx, "accounts:manage");

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("অ্যাকাউন্ট গ্রুপ ও ক্যাটাগরি সেটিংস")}
        description={t("মূল প্যারেন্ট গ্রুপ ও সাব-গ্রুপের পূর্ণাঙ্গ তালিকা — প্যারেন্ট বা সাব-গ্রুপ তৈরি ও নাম পরিবর্তন করুন")}
        crumbs={[
          { label: t("হিসাব"), href: "/accounts" },
          { label: t("হিসাব গ্রুপ সেটিং") },
        ]}
      />

      <AccountGroupsClient
        initialGroups={groups}
        accountCounts={accountCounts}
        canManage={canManage}
      />
    </div>
  );
}
