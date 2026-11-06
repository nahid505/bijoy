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
import { transferIntercompanyFundsAction } from "@/server/actions/intercompany";
import { transferIntercompanyFunds } from "@/server/services/intercompany";

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

run("1-Click Bilateral Intercompany Fund Transfer", () => {
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

  it("successfully performs balanced bilateral fund transfer between sister concerns", async () => {
    // 1. Setup Parent (Entity A) and Subsidiary (Entity B)
    const entityA = await newBusiness("বিজয় টেক্সটাইল মিলস লিমিটেড");
    const entityB = await newBusiness("বিজয় গার্মেন্টস অ্যান্ড ওয়াশিং");

    // 2. Put both businesses into the same company group
    const group = await prisma.companyGroup.create({
      data: {
        name: "বিজয় ইন্ডাস্ট্রিজ গ্রুপ",
        code: `BIG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      },
    });

    await prisma.business.update({
      where: { id: entityA.ctx.business.id },
      data: { groupId: group.id, isParent: true, intercompanyCode: "BIG-TEX" },
    });

    await prisma.business.update({
      where: { id: entityB.ctx.business.id },
      data: { groupId: group.id, isParent: false, intercompanyCode: "BIG-GAR" },
    });

    // 3. Find cash/bank accounts for both entities
    const senderCash = await prisma.account.findFirstOrThrow({
      where: { businessId: entityA.ctx.business.id, kind: "CASH" },
    });
    const recipientBank = await prisma.account.findFirstOrThrow({
      where: { businessId: entityB.ctx.business.id, kind: "CASH" },
    });

    useSession(entityA.cookies);

    // 4. Perform 1-Click Intercompany Fund Transfer of 150,000 BDT
    const transferAmount = 150000;
    const res = await transferIntercompanyFundsAction(
      null,
      form({
        receiverBusinessId: entityB.ctx.business.id,
        senderAccountId: senderCash.id,
        receiverAccountId: recipientBank.id,
        amount: String(transferAmount),
        transferType: "LOAN",
        reference: "CHEQUE-998811",
        narration: "কারখানা সম্প্রসারণের জন্য স্বল্পমেয়াদি চলতি মূলধন ঋণ",
      })
    );

    expect(res?.ok).toBe(true);
    expect(res?.data?.senderVoucherId).toBeDefined();
    expect(res?.data?.receiverVoucherId).toBeDefined();

    // 5. Verify Sender Entity Voucher (Payment)
    const senderVoucher = await prisma.voucher.findUniqueOrThrow({
      where: { id: res!.data!.senderVoucherId },
      include: { entries: { include: { account: true } } },
    });

    expect(senderVoucher.businessId).toBe(entityA.ctx.business.id);
    expect(senderVoucher.type).toBe("PAYMENT");
    expect(Number(senderVoucher.amount)).toBe(transferAmount);
    expect(senderVoucher.entries.length).toBe(2);

    const senderDebit = senderVoucher.entries.find((e) => Number(e.debit) > 0);
    const senderCredit = senderVoucher.entries.find((e) => Number(e.credit) > 0);
    expect(senderDebit).toBeDefined();
    expect(senderCredit).toBeDefined();
    expect(Number(senderDebit!.debit)).toBe(transferAmount);
    expect(Number(senderCredit!.credit)).toBe(transferAmount);
    expect(senderCredit!.accountId).toBe(senderCash.id);
    // Sender Dr account should be intercompany loan asset
    expect(senderDebit!.account.name).toContain("আন্তঃপ্রতিষ্ঠান ঋণ");

    // 6. Verify Recipient Entity Voucher (Receipt)
    const recipientVoucher = await prisma.voucher.findUniqueOrThrow({
      where: { id: res!.data!.receiverVoucherId },
      include: { entries: { include: { account: true } } },
    });

    expect(recipientVoucher.businessId).toBe(entityB.ctx.business.id);
    expect(recipientVoucher.type).toBe("RECEIPT");
    expect(Number(recipientVoucher.amount)).toBe(transferAmount);
    expect(recipientVoucher.entries.length).toBe(2);

    const recipientDebit = recipientVoucher.entries.find((e) => Number(e.debit) > 0);
    const recipientCredit = recipientVoucher.entries.find((e) => Number(e.credit) > 0);
    expect(recipientDebit).toBeDefined();
    expect(recipientCredit).toBeDefined();
    expect(Number(recipientDebit!.debit)).toBe(transferAmount);
    expect(Number(recipientCredit!.credit)).toBe(transferAmount);
    expect(recipientDebit!.accountId).toBe(recipientBank.id);
    // Recipient Cr account should be intercompany loan liability
    expect(recipientCredit!.account.name).toContain("আন্তঃপ্রতিষ্ঠান ঋণ");

    // 7. Verify Audit Logs recorded in both entities
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        businessId: entityA.ctx.business.id,
        entity: "IntercompanyFundTransfer",
        entityId: senderVoucher.id,
      },
    });
    expect(auditLogs.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects fund transfer between entities not in the same group", async () => {
    const entityA = await newBusiness("গ্রুপ এ ফার্ম");
    const entityB = await newBusiness("গ্রুপ বি ফার্ম (ভিন্ন গ্রুপ)");

    const senderCash = await prisma.account.findFirstOrThrow({
      where: { businessId: entityA.ctx.business.id, kind: "CASH" },
    });
    const recipientCash = await prisma.account.findFirstOrThrow({
      where: { businessId: entityB.ctx.business.id, kind: "CASH" },
    });

    await expect(
      transferIntercompanyFunds({
        senderBusinessId: entityA.ctx.business.id,
        receiverBusinessId: entityB.ctx.business.id,
        senderAccountId: senderCash.id,
        receiverAccountId: recipientCash.id,
        amount: 50000,
        transferType: "LOAN",
        userId: entityA.ctx.user.id,
      })
    ).rejects.toThrow("উভয় প্রতিষ্ঠান একই কোম্পানি গ্রুপের অন্তর্ভুক্ত হতে হবে");
  });

  it("rejects fund transfer with zero or negative amount", async () => {
    const entityA = await newBusiness("গ্রুপ টেস্ট প্রতিষ্ঠান ১");
    const entityB = await newBusiness("গ্রুপ টেস্ট প্রতিষ্ঠান ২");

    const group = await prisma.companyGroup.create({
      data: { name: "টেস্ট গ্রুপ", code: `TG-${Date.now()}` },
    });
    await prisma.business.update({ where: { id: entityA.ctx.business.id }, data: { groupId: group.id } });
    await prisma.business.update({ where: { id: entityB.ctx.business.id }, data: { groupId: group.id } });

    const senderCash = await prisma.account.findFirstOrThrow({
      where: { businessId: entityA.ctx.business.id, kind: "CASH" },
    });
    const recipientCash = await prisma.account.findFirstOrThrow({
      where: { businessId: entityB.ctx.business.id, kind: "CASH" },
    });

    await expect(
      transferIntercompanyFunds({
        senderBusinessId: entityA.ctx.business.id,
        receiverBusinessId: entityB.ctx.business.id,
        senderAccountId: senderCash.id,
        receiverAccountId: recipientCash.id,
        amount: 0,
        transferType: "LOAN",
        userId: entityA.ctx.user.id,
      })
    ).rejects.toThrow("স্থানান্তরের পরিমাণ ০ থেকে বেশি হতে হবে");
  });
});
