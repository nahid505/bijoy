import { prisma } from "@/lib/db";
import type { AppContext } from "@/server/auth";
import {
  DEFAULT_RENTED_MILL_SETTINGS,
  type RentedMillRole,
  type RentedMillSettingsData,
} from "./rented-mill-types";

export * from "./rented-mill-types";

export async function getRentedMillSettings(): Promise<RentedMillSettingsData> {
  try {
    const existing = await prisma.rentedMillSettings.findUnique({
      where: { id: 1 },
    });
    if (existing) {
      if (existing.millName === "ভাড়া অটো রাইস মিল") {
        const updated = await prisma.rentedMillSettings.update({
          where: { id: 1 },
          data: { millName: "শুভংকর অটো রাইস মিল", millAddress: "দিনাজপুর" },
        });
        return updated as unknown as RentedMillSettingsData;
      }
      return existing as unknown as RentedMillSettingsData;
    }

    return (await prisma.rentedMillSettings.upsert({
      where: { id: 1 },
      update: {},
      create: DEFAULT_RENTED_MILL_SETTINGS,
    })) as unknown as RentedMillSettingsData;
  } catch (err) {
    console.error("[getRentedMillSettings] error, returning fallback default:", err);
    return DEFAULT_RENTED_MILL_SETTINGS;
  }
}

export function resolveRentedMillRole(
  ctx: AppContext,
  settings: RentedMillSettingsData
): RentedMillRole {
  // If user is Nahid Hasan / Super Admin, they have full control
  if (
    ctx.user.isSuperAdmin ||
    ctx.user.email === "nahid21506@gmail.com" ||
    ctx.user.name?.includes("নাহিদ")
  ) {
    return "SUPER_ADMIN";
  }

  // Assigned Partner (Strict Read-Only)
  if (
    (settings.partnerUserId && ctx.user.id === settings.partnerUserId) ||
    ctx.user.name?.toLowerCase().includes("partner") ||
    ctx.user.name?.includes("পার্টনার") ||
    ctx.roleName?.toLowerCase().includes("partner")
  ) {
    return "PARTNER";
  }

  // Assigned Accountant or Accountant role / Rabbi user
  if (
    (settings.accountantUserId && ctx.user.id === settings.accountantUserId) ||
    ctx.roleName?.toLowerCase().includes("accountant") ||
    ctx.roleName?.includes("হিসাবরক্ষক") ||
    ctx.user.name?.toLowerCase().includes("rabbi") ||
    ctx.user.name?.includes("রাব্বী") ||
    ctx.user.name?.includes("হিসাবরক্ষক") ||
    ctx.user.email?.toLowerCase().includes("rabby") ||
    ctx.user.email?.toLowerCase().includes("rabbi")
  ) {
    return "ACCOUNTANT";
  }

  if (ctx.isOwner) {
    return "SUPER_ADMIN";
  }

  return "GUEST";
}
