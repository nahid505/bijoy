"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { DEPOT_PERMISSIONS, isPermission } from "@/lib/permissions";
import { isDepot } from "@/lib/depot";
import { businessSchema, businessTypesSchema, memberSchema, newBusinessSchema, roleSchema } from "@/lib/validation";
import { assertPermission, getContext, requireUser, setBusinessCookie, setSessionCookie } from "../auth";
import { revokeAllSessions } from "../services/sessions";
import { audit } from "../audit";
import { formToObject, guard, parseForm, toResult, UserError, type ActionState } from "../action-utils";
import { createBusiness, setBusinessTypes } from "../services/bootstrap";
import { assertOwner } from "../business-owner";
import { isRestricted, saveAssignments } from "../party-scope";
import { assertUserSlot } from "../services/subscriptions";
import { notifyBusiness } from "../services/billing-notify";
import { listHas, strList } from "@/lib/dialect";

const MAX_LOGO_BYTES = 200 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

// ───────────────────────── business ─────────────────────────

/** Selects the working business (membership-checked). The client then does a full reload so no state of the previous tenant survives. */
export async function switchBusinessAction(fd: FormData): Promise<boolean> {
  const user = await requireUser();
  const id = String(fd.get("businessId") ?? "");
  const m = await prisma.membership.findFirst({ where: { userId: user.id, businessId: id, isActive: true } });
  if (!m) return false;
  await setBusinessCookie(id);
  return true;
}

/** Creates a new business; the creator becomes its Owner. Used by onboarding and "new business". */
export async function createBusinessAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const user = await requireUser();
    const ctx = await getContext();
    // Users who already belong to a business need business:manage there to open another one.
    if (ctx && !ctx.permissions.includes("*") && !ctx.permissions.includes("business:manage")) throw new UserError("নতুন ব্যবসা খোলার অনুমতি নেই");
    const input = parseForm(newBusinessSchema, fd);
    const business = await prisma.$transaction((tx) => createBusiness(tx, { ...input, ownerUserId: user.id }), { timeout: 30_000 });
    await audit({ businessId: business.id, userId: user.id, action: "CREATE", entity: "Business", entityId: business.id, details: { name: input.name } });
    return business.id;
  });
  if (!result.ok) return toResult(result);
  await setBusinessCookie(result.data);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function saveBusinessAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("business:manage");
    const input = businessSchema.parse({
      ...formToObject(fd),
      expiryWarningDays: fd.getAll("expiryWarningDays").map(String).filter((v) => v.trim() !== ""),
      allowExpiredSale: fd.get("allowExpiredSale") === "on",
    });
    let logo: string | null | undefined;
    const file = fd.get("logo");
    if (file instanceof File && file.size > 0) {
      if (!LOGO_TYPES.includes(file.type)) throw new UserError("লোগো PNG, JPG, WEBP বা SVG হতে হবে");
      if (file.size > MAX_LOGO_BYTES) throw new UserError("লোগো সর্বোচ্চ ২০০ KB হতে পারবে");
      logo = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
    }
    if (fd.get("removeLogo") === "on") logo = null;
    await prisma.business.update({ where: { id: ctx.business.id }, data: { ...input, ...(logo !== undefined ? { logo } : {}) } });
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: "Business", entityId: ctx.business.id, details: { ...input, booksStartDate: input.booksStartDate.toISOString(), lockDate: input.lockDate?.toISOString() ?? null } });
  });
  revalidatePath("/", "layout");
  return result.ok ? { ok: true, message: "ব্যবসার তথ্য সংরক্ষণ হয়েছে" } : toResult(result);
}

// ───────────────────────── business types & modules ─────────────────────────

/** Saves the business types and modules ("ব্যবসার ধরন ও মডিউল ব্যবস্থাপনা"); also PUT /api/settings/company/business-types. */
export async function saveBusinessTypesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertOwner(await assertPermission("business:manage"));
    const input = businessTypesSchema.parse({ businessTypes: fd.getAll("businessTypes").map(String) });
    const before = ctx.business.businessTypes;
    const saved = await prisma.$transaction((tx) => setBusinessTypes(tx, ctx.business.id, input.businessTypes));
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: "Business", entityId: ctx.business.id, details: { businessTypes: { before, after: saved.businessTypes } } });
  });
  revalidatePath("/", "layout");
  return result.ok ? { ok: true, message: "ব্যবসার ধরন ও মডিউল সংরক্ষণ হয়েছে" } : toResult(result);
}

// ───────────────────────── members (users of this business) ─────────────────────────

async function ownerCount(businessId: string, excludeUserId?: string) {
  return prisma.membership.count({
    where: { businessId, isActive: true, user: { isActive: true }, role: { permissions: listHas("*") }, ...(excludeUserId ? { userId: { not: excludeUserId } } : {}) },
  });
}

export async function saveMemberAction(userId: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("users:manage");
    const businessId = ctx.business.id;
    const input = memberSchema.parse({ ...formToObject(fd), isActive: fd.get("isActive") === "on" });
    const role = await prisma.role.findFirst({ where: { id: input.roleId, businessId } });
    if (!role) throw new UserError("রোল পাওয়া যায়নি");
    if (strList(role.permissions).includes("*") && !ctx.permissions.includes("*")) throw new UserError("শুধু মালিক অন্য কাউকে মালিক রোল দিতে পারেন");
    // customer / supplier assignment (sent by the form's assignment section; an assigned-only admin cannot change it)
    const assign = async (memberId: string) =>
      fd.get("assignment") === "1" && !isRestricted(ctx)
        ? saveAssignments(businessId, memberId, fd.getAll("customerIds").map(String), fd.getAll("supplierIds").map(String), fd.getAll("accountIds").map(String))
        : null;

    if (userId) {
      const membership = await prisma.membership.findUnique({ where: { userId_businessId: { userId, businessId } }, include: { role: true } });
      if (!membership) throw new UserError("ব্যবহারকারী এই ব্যবসার সদস্য নন");
      if (strList(membership.role.permissions).includes("*") && !ctx.permissions.includes("*")) throw new UserError("মালিকের তথ্য শুধু মালিক পরিবর্তন করতে পারেন");
      if (userId === ctx.user.id && !input.isActive) throw new UserError("নিজেকে নিষ্ক্রিয় করা যাবে না");
      const losesOwner = !input.isActive || !strList(role.permissions).includes("*");
      if (strList(membership.role.permissions).includes("*") && losesOwner && (await ownerCount(businessId, userId)) === 0) {
        throw new UserError("কমপক্ষে একজন সক্রিয় মালিক থাকতে হবে");
      }
      // Login credentials are global. If the person also belongs to another business, only they may
      // change their own name/email/password — otherwise one tenant's admin could take over the account.
      const target = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const elsewhere = await prisma.membership.count({ where: { userId, businessId: { not: businessId } } });
      const credentialsChanged = input.email !== target.email || input.name !== target.name || !!input.password;
      if (elsewhere > 0 && credentialsChanged && userId !== ctx.user.id) {
        throw new UserError("এই ব্যবহারকারী অন্য ব্যবসারও সদস্য — নাম, ইমেইল বা পাসওয়ার্ড শুধু তিনি নিজে পরিবর্তন করতে পারবেন");
      }
      if (input.isActive && !membership.isActive) await assertUserSlot(businessId); // re-activation counts against the plan limit
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: { name: input.name, email: input.email, ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 12) } : {}) },
        }),
        prisma.membership.update({ where: { id: membership.id }, data: { roleId: role.id, isActive: input.isActive } }),
      ]);
      if (input.password) {
        // password reset by an administrator: every session of that user ends immediately
        await revokeAllSessions(prisma, userId);
        if (userId === ctx.user.id) await setSessionCookie(userId);
      }
      const assignment = await assign(userId);
      await audit({ businessId, userId: ctx.user.id, action: "UPDATE", entity: "Member", entityId: userId, details: { email: input.email, role: role.name, isActive: input.isActive, ...(assignment ? { assignment } : {}) } });
    } else {
      // Existing account (e.g. member of another business) is linked; otherwise a new login is created.
      let user = await prisma.user.findUnique({ where: { email: input.email } });
      if (!user) {
        if (!input.password) throw new UserError("নতুন ব্যবহারকারীর জন্য পাসওয়ার্ড আবশ্যক");
        user = await prisma.user.create({ data: { name: input.name, email: input.email, passwordHash: await bcrypt.hash(input.password, 12) } });
      }
      const exists = await prisma.membership.findUnique({ where: { userId_businessId: { userId: user.id, businessId } } });
      if (exists) throw new UserError("এই ব্যবহারকারী ইতিমধ্যে এই ব্যবসার সদস্য");
      if (input.isActive) await assertUserSlot(businessId); // plan user limit
      await prisma.membership.create({ data: { userId: user.id, businessId, roleId: role.id, isActive: input.isActive } });
      await notifyBusiness(prisma, businessId, { kind: "USER_ADDED", key: `user:${user.id}`, title: `নতুন ব্যবহারকারী: ${input.name}`, message: `${input.email} — রোল ${role.name}`, link: "/users" });
      const assignment = await assign(user.id);
      await audit({ businessId, userId: ctx.user.id, action: "CREATE", entity: "Member", entityId: user.id, details: { email: input.email, role: role.name, ...(assignment ? { assignment } : {}) } });
    }
  });
  if (!result.ok) return toResult(result);
  revalidatePath("/users");
  redirect("/users");
}

export async function removeMemberAction(userId: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("users:manage");
    const businessId = ctx.business.id;
    if (userId === ctx.user.id) throw new UserError("নিজেকে সরানো যাবে না");
    const m = await prisma.membership.findUnique({ where: { userId_businessId: { userId, businessId } }, include: { role: true } });
    if (!m) throw new UserError("সদস্য পাওয়া যায়নি");
    if (strList(m.role.permissions).includes("*") && !ctx.permissions.includes("*")) throw new UserError("মালিককে শুধু মালিক সরাতে পারেন");
    if (strList(m.role.permissions).includes("*") && (await ownerCount(businessId, userId)) === 0) throw new UserError("কমপক্ষে একজন সক্রিয় মালিক থাকতে হবে");
    await prisma.membership.delete({ where: { id: m.id } });
    await saveAssignments(ctx.business.id, userId, [], []); // their customer / supplier assignment goes with the membership
    await audit({ businessId, userId: ctx.user.id, action: "DELETE", entity: "Member", entityId: userId });
  });
  if (!result.ok) return toResult(result);
  revalidatePath("/users");
  redirect("/users");
}

// ───────────────────────── roles ─────────────────────────

export async function saveRoleAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("roles:manage");
    const businessId = ctx.business.id;
    const input = roleSchema.parse({
      name: fd.get("name"),
      description: fd.get("description"),
      // depot permissions are granted only in a depot business
      permissions: fd.getAll("permissions").map(String).filter(isPermission).filter((p) => isDepot(ctx.business.businessType) || !DEPOT_PERMISSIONS.includes(p)),
    });
    if (id) {
      const role = await prisma.role.findFirst({ where: { id, businessId } });
      if (!role) throw new UserError("রোল পাওয়া যায়নি");
      if (role.isSystem) throw new UserError("মালিক রোল পরিবর্তন করা যাবে না");
      await prisma.role.update({ where: { id }, data: input });
    } else {
      id = (await prisma.role.create({ data: { ...input, businessId } })).id;
    }
    await audit({ businessId, userId: ctx.user.id, action: "UPDATE", entity: "Role", entityId: id, details: { name: input.name, permissions: input.permissions } });
  });
  if (!result.ok) return toResult(result);
  revalidatePath("/roles");
  redirect("/roles");
}

export async function deleteRoleAction(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("roles:manage");
    const role = await prisma.role.findFirst({ where: { id, businessId: ctx.business.id }, include: { _count: { select: { memberships: true } } } });
    if (!role) throw new UserError("রোল পাওয়া যায়নি");
    if (role.isSystem) throw new UserError("মালিক রোল মুছা যাবে না");
    if (role._count.memberships > 0) throw new UserError("এই রোলে ব্যবহারকারী আছে");
    await prisma.role.delete({ where: { id } });
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "DELETE", entity: "Role", entityId: id, details: { name: role.name } });
  });
  if (!result.ok) return toResult(result);
  revalidatePath("/roles");
  redirect("/roles");
}
