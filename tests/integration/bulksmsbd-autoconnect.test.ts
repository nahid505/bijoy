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
import { autoConnectBulkSmsBdAction } from "@/server/actions/sms";
import { getContext } from "@/server/auth";
import {
  getBulkSmsBdRegistrationData,
  verifyBulkSmsBdApiKey,
  loginToBulkSmsBd,
} from "@/server/sms/bulksmsbd-bridge";
import { GET as bulkSmsBdCallbackGet } from "@/app/api/sms/bulksmsbd-callback/route";
import { NextRequest } from "next/server";

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

run("BulkSMSBD Auto-Connect & 1-Click Registration", () => {
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

  it("getBulkSmsBdRegistrationData formats registration URLs and prefilled data correctly", () => {
    const data = getBulkSmsBdRegistrationData({
      name: "মেসার্স রহিম ট্রেডার্স",
      mobile: "01711223344",
      email: "rahim@example.com",
    });

    expect(data.registrationUrl).toBe("https://bulksmsbd.net/v2/register/rindex#/register");
    expect(data.rechargeUrl).toContain("bulksmsbd.net");
    expect(data.prefilled.name).toBe("মেসার্স রহিম ট্রেডার্স");
    expect(data.prefilled.mobile).toBe("01711223344");
    expect(data.prefilled.email).toBe("rahim@example.com");
  });

  it("verifyBulkSmsBdApiKey returns error when key is empty", async () => {
    const res = await verifyBulkSmsBdApiKey("");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("API কী খালি রাখা যাবে না");
  });

  it("loginToBulkSmsBd returns error when credentials are blank", async () => {
    const res = await loginToBulkSmsBd("", "");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("ইউজারনেম ও পাসওয়ার্ড উভয়ই প্রদান করুন");
  });

  it("autoConnectBulkSmsBdAction verifies API key, sets provider to bulksmsbd and enables SMS", async () => {
    const { ctx } = await newBusiness("BulkSMSBD টেস্ট ১");

    // Mock fetch for getBalanceApi
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("getBalanceApi")) {
        return new Response(JSON.stringify({ response_code: 202, balance: "340.50" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input);
    }) as any;

    try {
      const fd = form({
        mode: "apiKey",
        apiKey: "bulksmsbd-test-key-1234567890",
        senderId: "BIJOY-SMS",
      });

      const res = await autoConnectBulkSmsBdAction(null, fd);
      expect(res?.ok).toBe(true);
      expect(res?.message).toContain("BulkSMSBD সফলভাবে কানেক্ট হয়েছে");
      expect(res?.message).toContain("340.50");

      const s = await prisma.smsSettings.findUnique({
        where: { businessId: ctx.business.id },
      });
      expect(s).not.toBeNull();
      expect(s?.enabled).toBe(true);
      expect(s?.provider).toBe("bulksmsbd");
      expect(s?.senderId).toBe("BIJOY-SMS");
      expect(Number(s?.balance)).toBe(340.5);
      expect(s?.apiKeyHint).toBeTruthy();
      expect(s?.apiKeyEnc).toBeTruthy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("autoConnectBulkSmsBdAction fails gracefully with invalid API key", async () => {
    await newBusiness("BulkSMSBD টেস্ট ২");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("getBalanceApi")) {
        return new Response(
          JSON.stringify({ response_code: 1011, error_message: "User not found or invalid API key" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return originalFetch(input);
    }) as any;

    try {
      const fd = form({
        mode: "apiKey",
        apiKey: "invalid-key-xyz",
      });

      const res = await autoConnectBulkSmsBdAction(null, fd);
      expect(res?.ok).toBe(false);
      expect(res?.message).toContain("User not found or invalid API key");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("callback endpoint /api/sms/bulksmsbd-callback verifies and returns postMessage HTML", async () => {
    const { ctx } = await newBusiness("BulkSMSBD টেস্ট ৩");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("getBalanceApi")) {
        return new Response(JSON.stringify({ response_code: 202, balance: "185.00" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input);
    }) as any;

    try {
      const req = new NextRequest("http://localhost:3000/api/sms/bulksmsbd-callback?api_key=popup-key-999&sender_id=88096000000");
      const res = await bulkSmsBdCallbackGet(req);

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("BULKSMSBD_CONNECTED");
      expect(html).toContain("185.00");

      const s = await prisma.smsSettings.findUnique({
        where: { businessId: ctx.business.id },
      });
      expect(s?.enabled).toBe(true);
      expect(s?.provider).toBe("bulksmsbd");
      expect(s?.senderId).toBe("88096000000");
      expect(Number(s?.balance)).toBe(185);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
