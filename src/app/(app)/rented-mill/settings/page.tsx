import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireContext } from "@/server/auth";
import {
  getRentedMillSettings,
  resolveRentedMillRole,
} from "@/lib/rented-mill";
import { RentedMillTabs } from "../rented-mill-ui";
import { RentedMillSettingsClient } from "./settings-client";

export const metadata: Metadata = {
  title: "সেটিংস ও হিসাবরক্ষক নির্ধারণ - ভাড়া অটো রাইস মিল",
};

export default async function RentedMillSettingsPage() {
  const ctx = await requireContext();
  const settings = await getRentedMillSettings();
  const role = resolveRentedMillRole(ctx, settings);

  // Strictly enforce Super Admin / Owner access to settings
  if (role !== "SUPER_ADMIN") {
    redirect("/rented-mill");
  }

  const [users, currentAccountant, currentPartner] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        mobile: true,
      },
      orderBy: { name: "asc" },
    }),
    settings.accountantUserId
      ? prisma.user.findUnique({
          where: { id: settings.accountantUserId },
          select: {
            id: true,
            name: true,
            email: true,
            mobile: true,
          },
        })
      : Promise.resolve(null),
    settings.partnerUserId
      ? prisma.user.findUnique({
          where: { id: settings.partnerUserId },
          select: {
            id: true,
            name: true,
            email: true,
            mobile: true,
          },
        })
      : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <RentedMillTabs role={role} />

      <div className="border-b border-rule pb-4">
        <h1 className="text-xl sm:text-2xl font-bold text-ink-900">
          সেটিংস, হিসাবরক্ষক ও পার্টনার নির্ধারণ
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-500">
          ভাড়া অটো রাইস মিলের সাধারণ সেটিংস, অংশীদারিত্ব অনুপাত, হিসাবরক্ষক এবং পার্টনার (Read-Only) নির্ধারণ
        </p>
      </div>

      <RentedMillSettingsClient
        settings={settings}
        users={users}
        currentAccountant={currentAccountant}
        currentPartner={currentPartner}
      />
    </div>
  );
}
