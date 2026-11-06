"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertPermission, getContext, requireUser } from "../auth";
import { audit } from "../audit";
import { guard, parseForm, toResult, UserError, type ActionState } from "../action-utils";
import {
  createCompanyGroup,
  assignBusinessToGroup,
  removeBusinessFromGroup,
  linkSisterConcernPartner,
  listSisterConcerns,
  getConsolidatedGroupOverview,
  createGroupRole,
  assignUserToGroup,
  removeUserFromGroup,
} from "../services/company-group";
import { z } from "zod";

const createGroupSchema = z.object({
  name: z.string().trim().min(2, "গ্রুপের নাম কমপক্ষে ২ অক্ষর"),
  code: z.string().trim().max(30).optional(),
  description: z.string().trim().max(200).optional(),
  parentBusinessId: z.string().trim().optional(),
});

const assignGroupSchema = z.object({
  businessId: z.string().trim().min(1, "প্রতিষ্ঠান নির্বাচন করুন"),
  groupId: z.string().trim().min(1, "গ্রুপ নির্বাচন করুন"),
  isParent: z.boolean().default(false),
  intercompanyCode: z.string().trim().max(20).optional(),
  ownershipPercentage: z.coerce.number().min(0).max(100).default(100),
  intercompanyCreditLimit: z.preprocess((v) => (v === "" || v === undefined || v === null ? null : Number(v)), z.number().min(0).nullable().optional()),
});

const linkPartnerSchema = z.object({
  partnerType: z.enum(["CUSTOMER", "SUPPLIER"]),
  partnerId: z.string().trim().min(1, "পার্টনার নির্বাচন করুন"),
  linkedBusinessId: z.string().trim().min(1, "সিস্টার কনসার্ন প্রতিষ্ঠান নির্বাচন করুন"),
});

/**
 * Creates a new Enterprise / Company Group.
 * Accessible to platform Super Admin or business Owner.
 */
export async function createCompanyGroupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const user = await requireUser();
    const ctx = await getContext();
    if (!user.isSuperAdmin && (!ctx || !ctx.isOwner)) {
      throw new UserError("শুধুমাত্র সুপার এডমিন বা প্রতিষ্ঠানের মালিক কোম্পানি গ্রুপ তৈরি করতে পারেন");
    }

    const input = createGroupSchema.parse({
      name: String(fd.get("name") ?? ""),
      code: String(fd.get("code") ?? "") || undefined,
      description: String(fd.get("description") ?? "") || undefined,
      parentBusinessId: String(fd.get("parentBusinessId") ?? "") || ctx?.business.id,
    });

    const group = await createCompanyGroup(input);

    if (ctx) {
      await audit({
        businessId: ctx.business.id,
        userId: user.id,
        action: "CREATE",
        entity: "CompanyGroup",
        entityId: group.id,
        details: { name: group.name, code: group.code },
      });
    }

    return group;
  });

  revalidatePath("/", "layout");
  return result.ok
    ? { ok: true, message: `"${result.data.name}" কোম্পানি গ্রুপ সফলভাবে তৈরি হয়েছে`, data: { id: result.data.id } }
    : toResult(result);
}

/**
 * Assigns a business to a company group with parent / inter-company code designation.
 */
export async function assignBusinessToGroupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const user = await requireUser();
    const ctx = await getContext();
    if (!user.isSuperAdmin && (!ctx || !ctx.isOwner)) {
      throw new UserError("কোম্পানি গ্রুপে প্রতিষ্ঠান সংযুক্ত করার অনুমতি নেই");
    }

    const input = assignGroupSchema.parse({
      businessId: String(fd.get("businessId") ?? ctx?.business.id ?? ""),
      groupId: String(fd.get("groupId") ?? ""),
      isParent: fd.get("isParent") === "on" || fd.get("isParent") === "true",
      intercompanyCode: String(fd.get("intercompanyCode") ?? "") || undefined,
      ownershipPercentage: fd.get("ownershipPercentage") ? Number(fd.get("ownershipPercentage")) : 100,
      intercompanyCreditLimit: fd.get("intercompanyCreditLimit") ? Number(fd.get("intercompanyCreditLimit")) : null,
    });

    const updated = await assignBusinessToGroup(input);

    if (ctx) {
      await audit({
        businessId: input.businessId,
        userId: user.id,
        action: "UPDATE",
        entity: "Business",
        entityId: input.businessId,
        details: { groupId: input.groupId, isParent: input.isParent, intercompanyCode: input.intercompanyCode },
      });
    }

    return updated;
  });

  revalidatePath("/", "layout");
  return result.ok
    ? { ok: true, message: "প্রতিষ্ঠানটি সফলভাবে গ্রুপে সংযুক্ত হয়েছে" }
    : toResult(result);
}

/**
 * Removes a business from its group.
 */
export async function removeBusinessFromGroupAction(businessId: string, _prev?: ActionState): Promise<ActionState> {
  const result = await guard(async () => {
    const user = await requireUser();
    const ctx = await getContext();
    if (!user.isSuperAdmin && (!ctx || !ctx.isOwner)) {
      throw new UserError("গ্রুপ থেকে প্রতিষ্ঠান বাদ দেওয়ার অনুমতি নেই");
    }

    await removeBusinessFromGroup(businessId);

    if (ctx) {
      await audit({
        businessId,
        userId: user.id,
        action: "UPDATE",
        entity: "Business",
        entityId: businessId,
        details: { action: "REMOVED_FROM_GROUP" },
      });
    }
  });

  revalidatePath("/", "layout");
  return result.ok ? { ok: true, message: "প্রতিষ্ঠানটি গ্রুপ থেকে বাদ দেওয়া হয়েছে" } : toResult(result);
}

/**
 * Links a customer or supplier as an inter-company sister concern partner.
 */
export async function linkSisterConcernPartnerAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission(["customers:manage", "suppliers:manage"]);
    const input = linkPartnerSchema.parse({
      partnerType: fd.get("partnerType") === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER",
      partnerId: String(fd.get("partnerId") ?? ""),
      linkedBusinessId: String(fd.get("linkedBusinessId") ?? ""),
    });

    if (input.linkedBusinessId === ctx.business.id) {
      throw new UserError("একই প্রতিষ্ঠানকে নিজের সিস্টার কনসার্ন হিসেবে লিঙ্ক করা যাবে না");
    }

    const updated = await linkSisterConcernPartner({
      businessId: ctx.business.id,
      partnerType: input.partnerType,
      partnerId: input.partnerId,
      linkedBusinessId: input.linkedBusinessId,
    });

    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "UPDATE",
      entity: input.partnerType === "CUSTOMER" ? "Customer" : "Supplier",
      entityId: input.partnerId,
      details: { isSisterConcern: true, linkedBusinessId: input.linkedBusinessId },
    });

    return updated;
  });

  revalidatePath("/customers");
  revalidatePath("/suppliers");
  return result.ok ? { ok: true, message: "সিস্টার কনসার্ন পার্টনার সফলভাবে সংযুক্ত হয়েছে" } : toResult(result);
}

/**
 * Unlinks a sister concern partner link.
 */
export async function unlinkSisterConcernPartnerAction(
  partnerType: "CUSTOMER" | "SUPPLIER",
  partnerId: string,
  _prev?: ActionState
): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission(["customers:manage", "suppliers:manage"]);
    if (partnerType === "CUSTOMER") {
      await prisma.customer.updateMany({
        where: { id: partnerId, businessId: ctx.business.id },
        data: { isSisterConcern: false, linkedBusinessId: null },
      });
    } else {
      await prisma.supplier.updateMany({
        where: { id: partnerId, businessId: ctx.business.id },
        data: { isSisterConcern: false, linkedBusinessId: null },
      });
    }

    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "UPDATE",
      entity: partnerType === "CUSTOMER" ? "Customer" : "Supplier",
      entityId: partnerId,
      details: { isSisterConcern: false, linkedBusinessId: null },
    });
  });

  revalidatePath("/customers");
  revalidatePath("/suppliers");
  return result.ok ? { ok: true, message: "সিস্টার কনসার্ন লিঙ্ক বাতিল করা হয়েছে" } : toResult(result);
}

// ───────────────────────────── Group IAM Actions ─────────────────────────────

const createGroupRoleSchema = z.object({
  groupId: z.string().trim().min(1, "গ্রুপ নির্বাচন করুন"),
  name: z.string().trim().min(2, "রোলের নাম লিখুন"),
  description: z.string().trim().optional(),
  permissions: z.array(z.string()).default(["*"]),
});

const assignGroupUserSchema = z.object({
  groupId: z.string().trim().min(1, "গ্রুপ নির্বাচন করুন"),
  userId: z.string().trim().min(1, "ব্যবহারকারী নির্বাচন করুন"),
  roleId: z.string().trim().min(1, "রোল নির্বাচন করুন"),
});

export async function createGroupRoleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const user = await requireUser();
    const ctx = await getContext();
    if (!user.isSuperAdmin && (!ctx || !ctx.isOwner || !ctx.group?.isParent)) {
      throw new UserError("শুধুমাত্র সুপার এডমিন বা প্যারেন্ট প্রতিষ্ঠানের মালিক গ্রুপ রোল তৈরি করতে পারেন");
    }

    const permsRaw = String(fd.get("permissions") ?? "");
    const permissions = permsRaw ? permsRaw.split(",").map((p) => p.trim()).filter(Boolean) : ["*"];

    const input = createGroupRoleSchema.parse({
      groupId: String(fd.get("groupId") ?? ""),
      name: String(fd.get("name") ?? ""),
      description: String(fd.get("description") ?? "") || undefined,
      permissions,
    });

    const role = await createGroupRole(input);
    return role;
  });

  return result.ok ? { ok: true, message: "গ্রুপ রোল সফলভাবে তৈরি হয়েছে" } : toResult(result);
}

export async function assignUserToGroupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const user = await requireUser();
    const ctx = await getContext();
    if (!user.isSuperAdmin && (!ctx || !ctx.isOwner || !ctx.group?.isParent)) {
      throw new UserError("শুধুমাত্র সুপার এডমিন বা প্যারেন্ট প্রতিষ্ঠানের মালিক গ্রুপ মেম্বার যুক্ত করতে পারেন");
    }

    const roleId = String(fd.get("roleId") ?? fd.get("groupRoleId") ?? "");
    const input = assignGroupUserSchema.parse({
      groupId: String(fd.get("groupId") ?? ""),
      userId: String(fd.get("userId") ?? ""),
      roleId,
    });

    const membership = await assignUserToGroup(input);
    return membership;
  });

  return result.ok ? { ok: true, message: "গ্রুপ সেন্ট্রাল ইউজার সফলভাবে নিযুক্ত করা হয়েছে" } : toResult(result);
}

export async function removeUserFromGroupAction(userId: string, groupId: string, _prev?: ActionState): Promise<ActionState> {
  const result = await guard(async () => {
    const user = await requireUser();
    const ctx = await getContext();
    if (!user.isSuperAdmin && (!ctx || !ctx.isOwner || !ctx.group?.isParent)) {
      throw new UserError("শুধুমাত্র সুপার এডমিন বা প্যারেন্ট প্রতিষ্ঠানের মালিক গ্রুপ মেম্বারশিপ বাতিল করতে পারেন");
    }

    await removeUserFromGroup({ userId, groupId });
  });

  return result.ok ? { ok: true, message: "গ্রুপ মেম্বারশিপ সফলভাবে বাতিল করা হয়েছে" } : toResult(result);
}

