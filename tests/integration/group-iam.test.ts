import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const req = vi.hoisted(() => ({ headers: new Headers(), cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  headers: async () => req.headers,
  cookies: async () => ({
    get: (name: string) => (req.cookies.has(name) ? { name, value: req.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void req.cookies.set(name, value),
    delete: (name: string) => void req.cookies.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { prisma } from "@/lib/db";
import { registerAction } from "@/server/actions/auth";
import { getContext } from "@/server/auth";
import {
  createGroupRoleAction,
  assignUserToGroupAction,
  removeUserFromGroupAction,
} from "@/server/actions/company-group";
import {
  listGroupRoles,
  listGroupMembers,
} from "@/server/services/company-group";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const PASSWORD = "Dokan-2026x";

let n = 0;
const freshMobile = () =>
  `017${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}${String(++n % 100).padStart(2, "0")}`;

async function call<T>(fn: () => Promise<T>) {
  try {
    return { value: await fn(), redirect: null as string | null };
  } catch (e) {
    if ((e as Error).message === "NEXT_REDIRECT") return { value: null, redirect: (e as { url: string }).url };
    throw e;
  }
}

const form = (o: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) {
    for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  }
  return fd;
};

const useSession = (cookies: Map<string, string>) => {
  req.cookies = new Map(cookies);
};

async function newBusiness(name: string) {
  const mobile = freshMobile();
  const prev = process.env.REGISTRATION_OTP;
  process.env.REGISTRATION_OTP = "off";
  const r = await call(() =>
    registerAction(
      null,
      form({
        businessName: name,
        ownerName: "মালিক",
        mobile,
        email: "",
        password: PASSWORD,
        confirmPassword: PASSWORD,
      })
    )
  );
  if (prev === undefined) delete process.env.REGISTRATION_OTP;
  else process.env.REGISTRATION_OTP = prev;
  expect(r.redirect).toBe("/dashboard");
  const ctx = (await getContext())!;
  return { ctx, ownerMobile: mobile, cookies: new Map(req.cookies) };
}

run("Central Enterprise Group IAM & Multi-Entity User Access", () => {
  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret-for-vitest-only-0123456789abcdef";
    process.env.REGISTRATION_HOURLY_LIMIT = "100000";
    if (process.env.TEST_DATABASE_URL) {
      await prisma.authThrottle.deleteMany({ where: { key: { startsWith: "register" } } });
    }
  });

  beforeEach(() => {
    process.env.REGISTRATION_HOURLY_LIMIT = "100000";
  });

  it("parent entity owner creates GroupRole, assigns central user, and resolves cross-entity access in getContext", async () => {
    // 1. Create Parent and Subsidiary entities
    const parentEntity = await newBusiness("প্যারেন্ট হোল্ডিং কর্পোরেশন");
    const subsidiaryEntity = await newBusiness("সাবসিডিয়ারি ফার্ম লিমিটেড");

    // Create a standalone user who will be appointed as GROUP_CFO
    const centralUserEntity = await newBusiness("সেন্ট্রাল ইউজার ব্যক্তিগত প্রোফাইল");
    const centralUserId = centralUserEntity.ctx.user.id;

    // 2. Establish CompanyGroup
    const group = await prisma.companyGroup.create({
      data: {
        name: "মাল্টি-এনটিটি কনসোর্টিয়াম",
        code: `MEC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      },
    });

    await prisma.business.update({
      where: { id: parentEntity.ctx.business.id },
      data: { groupId: group.id, isParent: true },
    });

    await prisma.business.update({
      where: { id: subsidiaryEntity.ctx.business.id },
      data: { groupId: group.id, isParent: false },
    });

    // 3. Parent Owner creates a central GroupRole
    useSession(parentEntity.cookies);

    const createRoleRes = await createGroupRoleAction(
      null,
      form({
        groupId: group.id,
        name: "GROUP_CFO",
        description: "গ্রুপের সকল কনসার্নে সার্বিক আর্থিক নিরীক্ষা ও কনসোলিডেশন এক্সেস",
        permissions: JSON.stringify(["vouchers:view", "reports:view", "accounts:view"]),
      })
    );

    expect(createRoleRes?.ok).toBe(true);

    const groupRoles = await listGroupRoles(group.id);
    const cfoRole = groupRoles.find((r) => r.name === "GROUP_CFO");
    expect(cfoRole).toBeDefined();

    // 4. Parent Owner assigns central user to GroupRole
    const assignRes = await assignUserToGroupAction(
      null,
      form({
        groupId: group.id,
        userId: centralUserId,
        groupRoleId: cfoRole!.id,
      })
    );

    expect(assignRes?.ok).toBe(true);

    const members = await listGroupMembers(group.id);
    const assigned = members.find((m) => m.userId === centralUserId);
    expect(assigned).toBeDefined();
    expect(assigned?.role.name).toBe("GROUP_CFO");
    expect(assigned?.isActive).toBe(true);

    // 5. Switch session to the central user and verify getContext() synthesis across group entities
    useSession(centralUserEntity.cookies);
    req.cookies.set("bl_business", parentEntity.ctx.business.id);
    const parentCtxForCentralUser = await getContext();

    expect(parentCtxForCentralUser).not.toBeNull();
    expect(parentCtxForCentralUser!.business.id).toBe(parentEntity.ctx.business.id);
    expect(parentCtxForCentralUser!.group?.canConsolidate).toBe(true);
    expect(parentCtxForCentralUser!.roleName).toBe("GROUP_CFO");

    // Central user switches to subsidiary entity
    req.cookies.set("bl_business", subsidiaryEntity.ctx.business.id);
    const subCtxForCentralUser = await getContext();
    expect(subCtxForCentralUser).not.toBeNull();
    expect(subCtxForCentralUser!.business.id).toBe(subsidiaryEntity.ctx.business.id);
    expect(subCtxForCentralUser!.group?.canConsolidate).toBe(true);
    expect(subCtxForCentralUser!.roleName).toBe("GROUP_CFO");

    // 6. Test revoking membership
    useSession(parentEntity.cookies);
    const removeRes = await removeUserFromGroupAction(centralUserId, group.id);
    expect(removeRes?.ok).toBe(true);

    const updatedMembers = await listGroupMembers(group.id);
    expect(updatedMembers.find((m) => m.id === assigned!.id && m.isActive)).toBeUndefined();
  });

  it("prevents subsidiary non-parent owners from creating group roles or memberships", async () => {
    const parentEntity = await newBusiness("হেডকোয়ার্টার কোম্পানি");
    const subsidiaryEntity = await newBusiness("ব্রাঞ্চ কনসার্ন");

    const group = await prisma.companyGroup.create({
      data: {
        name: "প্যারেন্ট-সাবসিডিয়ারি গ্রুপ",
        code: `PSG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      },
    });

    await prisma.business.update({
      where: { id: parentEntity.ctx.business.id },
      data: { groupId: group.id, isParent: true },
    });

    await prisma.business.update({
      where: { id: subsidiaryEntity.ctx.business.id },
      data: { groupId: group.id, isParent: false },
    });

    // Subsidiary entity session
    useSession(subsidiaryEntity.cookies);

    const res = await createGroupRoleAction(
      null,
      form({
        groupId: group.id,
        name: "UNAUTHORIZED_ROLE",
        permissions: JSON.stringify(["reports:view"]),
      })
    );

    expect(res?.ok).toBe(false);
    expect(res?.message).toContain("শুধুমাত্র সুপার এডমিন বা প্যারেন্ট প্রতিষ্ঠানের মালিক");
  });
});
