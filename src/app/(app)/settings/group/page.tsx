import React from "react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/lib/db";
import { strList } from "@/lib/dialect";
import {
  listSisterConcerns,
  getConsolidatedGroupOverview,
  listGroupRoles,
  listGroupMembers,
  getInterCompanyPartners,
} from "@/server/services/company-group";
import { GroupClient } from "./group-client";

export const metadata: Metadata = {
  title: "কোম্পানি গ্রুপ ও সিস্টার কনসার্ন ব্যবস্থাপনা",
};

export default async function SettingsGroupPage() {
  const ctx = await requirePermission(["business:manage", "users:manage"]);
  const groupData = await listSisterConcerns(ctx.business.id);

  let overview = null;
  let roles: Awaited<ReturnType<typeof listGroupRoles>> = [];
  let members: Awaited<ReturnType<typeof listGroupMembers>> = [];
  let partners = { customers: [], suppliers: [] };

  if (groupData.inGroup && groupData.group?.id) {
    try {
      overview = await getConsolidatedGroupOverview(groupData.group.id);
      roles = await listGroupRoles(groupData.group.id);
      members = await listGroupMembers(groupData.group.id);
      partners = (await getInterCompanyPartners(ctx.business.id)) as any;
    } catch (e) {
      console.error("Error loading group details:", e);
    }
  }

  // List existing groups on platform to allow joining
  const existingGroups = await prisma.companyGroup.findMany({
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
      _count: { select: { businesses: true } },
    },
    orderBy: { name: "asc" },
  });

  // List active businesses available to link into this group
  const availableBusinesses = await prisma.business.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      groupId: true,
      isParent: true,
      intercompanyCode: true,
      businessType: true,
    },
    orderBy: { name: "asc" },
  });

  // Users for group role assignment
  const availableUsers = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      email: true,
      mobile: true,
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="কোম্পানি গ্রুপ ও সিস্টার কনসার্ন ব্যবস্থাপনা"
        description="হোল্ডিং গ্রুপ কনফিগারেশন, সিস্টার কনসার্ন ম্যাপিং ও সেন্ট্রাল আইএএম (Group IAM) নিয়ন্ত্রণ"
        crumbs={[
          { label: "ড্যাশবোর্ড", href: "/dashboard" },
          { label: "ব্যবসা সেটিং", href: "/business" },
          { label: "কোম্পানি গ্রুপ", href: "/settings/group" },
        ]}
      />

      <GroupClient
        currentBusiness={{
          id: ctx.business.id,
          name: ctx.business.name,
          isOwner: ctx.isOwner,
          isSuperAdmin: ctx.user.isSuperAdmin,
        }}
        groupData={groupData}
        overview={overview}
        roles={roles.map((r) => ({ ...r, permissions: strList(r.permissions) }))}
        members={members}
        partners={partners}
        existingGroups={existingGroups}
        availableBusinesses={availableBusinesses}
        availableUsers={availableUsers}
      />
    </div>
  );
}
