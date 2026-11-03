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
import { switchBusinessAction } from "@/server/actions/business";
import {
  createCompanyGroupAction,
  assignBusinessToGroupAction,
  linkSisterConcernPartnerAction,
} from "@/server/actions/company-group";
import { getContext, BUSINESS_COOKIE } from "@/server/auth";
import {
  listSisterConcerns,
  getInterCompanyPartners,
  getConsolidatedGroupOverview,
} from "@/server/services/company-group";
import { saveParty } from "@/server/services/master";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const PASSWORD = "Dokan-2026x";

let n = 0;
const freshMobile = () => `017${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}${String(++n % 100).padStart(2, "0")}`;

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
  const prev = process.env.REGISTRATION_OTP;
  process.env.REGISTRATION_OTP = "false";
  req.cookies.clear();
  const mobile = freshMobile();
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

run("Multi-Company & Enterprise Group Architecture", () => {
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

  it("creates a CompanyGroup and assigns parent and subsidiary entities", async () => {
    const { ctx: parentCtx, cookies: parentCookies } = await newBusiness("রহিম হোল্ডিংস লিমিটেড");
    const { ctx: sub1Ctx } = await newBusiness("রহিম এগ্রো মিলস");
    const { ctx: sub2Ctx } = await newBusiness("রহিম ট্রেডিং কর্পোরেশন");

    // 1. Create company group as parentCtx owner
    useSession(parentCookies);
    req.cookies.set(BUSINESS_COOKIE, parentCtx.business.id);
    const createRes = await createCompanyGroupAction(
      null,
      form({
        name: "রহিম গ্রুপ অব ইন্ডাস্ট্রিজ",
        code: `RG_${Date.now()}`,
        description: "কৃষি, উৎপাদন ও ট্রেডিং কনগ্লোমারেট",
        parentBusinessId: parentCtx.business.id,
      })
    );

    expect(createRes?.ok).toBe(true);
    const groupId = (createRes as any).data?.id;
    expect(groupId).toBeTruthy();

    // 2. Assign sub1 to group as subsidiary with intercompanyCode
    const assignSub1Res = await assignBusinessToGroupAction(
      null,
      form({
        businessId: sub1Ctx.business.id,
        groupId,
        isParent: "false",
        intercompanyCode: "MILL",
      })
    );
    expect(assignSub1Res?.ok).toBe(true);

    // 3. Assign sub2 to group as subsidiary with intercompanyCode
    const assignSub2Res = await assignBusinessToGroupAction(
      null,
      form({
        businessId: sub2Ctx.business.id,
        groupId,
        isParent: "false",
        intercompanyCode: "TRADING",
      })
    );
    expect(assignSub2Res?.ok).toBe(true);

    // 4. Verify sister concerns list
    const sisterData = await listSisterConcerns(parentCtx.business.id);
    expect(sisterData.inGroup).toBe(true);
    expect(sisterData.group?.name).toBe("রহিম গ্রুপ অব ইন্ডাস্ট্রিজ");
    expect(sisterData.sisterConcerns.length).toBe(3);

    const codes = sisterData.sisterConcerns.map((s) => s.intercompanyCode).filter(Boolean);
    expect(codes).toContain("MILL");
    expect(codes).toContain("TRADING");

    // 5. Verify consolidated group overview
    const overview = await getConsolidatedGroupOverview(groupId);
    expect(overview.totalEntities).toBe(3);
    expect(overview.group.name).toBe("রহিম গ্রুপ অব ইন্ডাস্ট্রিজ");
  });

  it("links a customer in one company to a sister concern entity", async () => {
    const { ctx: parentCtx, cookies: parentCookies } = await newBusiness("গ্রুপ প্যারেন্ট এনটিটি");
    const { ctx: subCtx } = await newBusiness("সিস্টার এনটিটি বি");

    // Create a group and link both as parent owner
    useSession(parentCookies);
    req.cookies.set(BUSINESS_COOKIE, parentCtx.business.id);
    const createRes = await createCompanyGroupAction(
      null,
      form({
        name: "টেস্ট এন্টারপ্রাইজ গ্রুপ",
        parentBusinessId: parentCtx.business.id,
      })
    );
    const groupId = (createRes as any).data?.id;

    await assignBusinessToGroupAction(
      null,
      form({
        businessId: subCtx.business.id,
        groupId,
        isParent: "false",
        intercompanyCode: "SISTER_B",
      })
    );

    // Create a customer in parentCtx representing subCtx
    const customer = await saveParty(
      { businessId: parentCtx.business.id, userId: parentCtx.user.id },
      "CUSTOMER",
      {
        name: "রহিম এগ্রো (অভ্যন্তরীণ ডিপো)",
        mobile: freshMobile(),
        email: null,
        address: null,
        notes: null,
        openingBalance: 0,
        creditLimit: 0,
        creditDays: 0,
      }
    );

    // Link customer to subCtx business
    const linkRes = await linkSisterConcernPartnerAction(
      null,
      form({
        partnerType: "CUSTOMER",
        partnerId: customer.id,
        linkedBusinessId: subCtx.business.id,
      })
    );
    expect(linkRes?.ok).toBe(true);

    // Verify inter-company mapping
    const partners = await getInterCompanyPartners(parentCtx.business.id);
    expect(partners.customers.length).toBe(1);
    expect(partners.customers[0].isSisterConcern).toBe(true);
    expect(partners.customers[0].linkedBusiness?.id).toBe(subCtx.business.id);
    expect(partners.customers[0].linkedBusiness?.intercompanyCode).toBe("SISTER_B");
  });

  it("populates GroupContext in getContext with canConsolidate flag", async () => {
    const { ctx: parentCtx, cookies: parentCookies } = await newBusiness("হোল্ডিং কোম্পানি");
    const { ctx: subCtx } = await newBusiness("অঙ্গপ্রতিষ্ঠান");

    useSession(parentCookies);
    req.cookies.set(BUSINESS_COOKIE, parentCtx.business.id);
    const createRes = await createCompanyGroupAction(
      null,
      form({
        name: "সম্মিলিত গ্রুপ",
        parentBusinessId: parentCtx.business.id,
      })
    );
    const groupId = (createRes as any).data?.id;

    await assignBusinessToGroupAction(
      null,
      form({
        businessId: subCtx.business.id,
        groupId,
        intercompanyCode: "SUB",
      })
    );

    // Verify parent context has canConsolidate = true
    const activeCtx = await getContext();

    expect(activeCtx?.group).not.toBeNull();
    expect(activeCtx?.group?.name).toBe("সম্মিলিত গ্রুপ");
    expect(activeCtx?.group?.isParent).toBe(true);
    expect(activeCtx?.group?.canConsolidate).toBe(true);
    expect(activeCtx?.group?.sisterConcerns.length).toBe(2);
  });

  it("super admin can switch globally to any sister concern while tenant isolation holds for others", async () => {
    const { ctx: b1Ctx, cookies: b1Cookies } = await newBusiness("এনটিটি ১");
    const { ctx: b2Ctx } = await newBusiness("এনটিটি ২");

    // Regular user of b1 cannot switch to b2 where they have no membership
    useSession(b1Cookies);
    req.cookies.set(BUSINESS_COOKIE, b1Ctx.business.id);
    const regularSwitch = await switchBusinessAction(form({ businessId: b2Ctx.business.id }));
    expect(regularSwitch).toBe(false);

    // Promote user to Super Admin
    await prisma.user.update({
      where: { id: b1Ctx.user.id },
      data: { isSuperAdmin: true },
    });

    // Super Admin can switch directly to any business
    const superAdminSwitch = await switchBusinessAction(form({ businessId: b2Ctx.business.id }));
    expect(superAdminSwitch).toBe(true);
  });
});
