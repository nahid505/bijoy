// Date lock ("transaction:change_date") through the real server actions, with real sessions:
// a staff role without the permission may only enter today's date (edits keep their date); with it,
// or as owner ("*"), any date. The voucher editor reports the lock to the forms.
import { beforeAll, describe, expect, it, vi } from "vitest";
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
import { addDays, toDateInput } from "@/lib/format";
import { SESSION_COOKIE, createSessionToken } from "@/lib/session";
import { registerAction } from "@/server/actions/auth";
import { saveVoucherAction } from "@/server/actions/vouchers";
import { savePaddyPurchaseAction } from "@/server/actions/paddy";
import { BUSINESS_COOKIE, getContext } from "@/server/auth";
import { entryDateLock } from "@/server/entry-date";
import { systemAccounts } from "@/server/services/accounting";
import { createRiceMillTemplate } from "@/server/services/production";
import { createSession } from "@/server/services/sessions";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const PASSWORD = "Dokan-2026x";
let n = 0;
const freshMobile = () => `016${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}${String(++n % 100).padStart(2, "0")}`;
const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.append(k, v);
  return fd;
};

/** Run an action; a redirect means it saved — returns the voucher id from the URL. */
async function call(fn: () => Promise<unknown>): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    const r = (await fn()) as { ok: boolean; message?: string };
    return { ok: false, message: r.message ?? "no redirect" };
  } catch (e) {
    const url = (e as { url?: string }).url;
    if ((e as Error).message === "NEXT_REDIRECT" && url) return { ok: true, id: url.split("/").filter(Boolean).pop()! };
    throw e;
  }
}

run("date lock (transaction:change_date)", () => {
  let businessId: string;
  let owner: Map<string, string>;
  let locked: Map<string, string>;
  let allowed: Map<string, string>;
  let cash: string;
  let rent: string;
  let capital: string;
  const today = toDateInput();
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const as = (cookies: Map<string, string>) => {
    req.cookies.clear();
    for (const [k, v] of cookies) req.cookies.set(k, v);
  };
  const payment = (date: string, amount = 100, id: string | null = null) =>
    call(() => saveVoucherAction("PAYMENT", id, { ok: true }, form({ payload: JSON.stringify({ date, reference: null, narration: null, cashAccountId: cash, lines: [{ accountId: rent, amount, narration: null }] }) })));
  const journal = (date: string) =>
    call(() => saveVoucherAction("JOURNAL", null, { ok: true }, form({ payload: JSON.stringify({ date, reference: null, narration: null, lines: [{ accountId: cash, debit: 50, credit: 0, narration: null }, { accountId: capital, debit: 0, credit: 50, narration: null }] }) })));

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret-for-vitest-only-0123456789abcdef";
    process.env.REGISTRATION_HOURLY_LIMIT = "100000";
    const prev = process.env.REGISTRATION_OTP;
    process.env.REGISTRATION_OTP = "false";
    req.cookies.clear();
    try {
      await registerAction(null, form({ businessName: "তারিখ লক টেস্ট", ownerName: "মালিক", mobile: freshMobile(), email: "", password: PASSWORD, confirmPassword: PASSWORD }));
    } catch (e) {
      if ((e as Error).message !== "NEXT_REDIRECT") throw e;
    }
    if (prev === undefined) delete process.env.REGISTRATION_OTP;
    else process.env.REGISTRATION_OTP = prev;
    owner = new Map(req.cookies);
    businessId = (await getContext())!.business.id;
    const acc = await prisma.$transaction((tx) => systemAccounts(tx, businessId));
    cash = acc.CASH;
    const accounts = await prisma.account.findMany({ where: { businessId } });
    rent = accounts.find((a) => a.systemKey === "RENT")!.id;
    capital = accounts.find((a) => a.systemKey === "CAPITAL")!.id;

    const staff = async (permissions: string[]) => {
      const role = await prisma.role.create({ data: { businessId, name: `role-${Date.now()}-${++n}`, permissions } });
      const user = await prisma.user.create({ data: { name: "স্টাফ", mobile: freshMobile(), passwordHash: "x" } });
      await prisma.membership.create({ data: { userId: user.id, businessId, roleId: role.id } });
      const s = await createSession(prisma, user.id);
      return new Map([[SESSION_COOKIE, await createSessionToken(user.id, s.id)], [BUSINESS_COOKIE, businessId]]);
    };
    const base = ["vouchers:view", "vouchers:create", "vouchers:edit", "purchases:view", "purchases:create", "purchases:edit", "inventory:view"];
    locked = await staff(base);
    allowed = await staff([...base, "transaction:change_date"]);
  });

  it("without the permission: today only — back-dated and future entries are refused (nothing saved)", async () => {
    as(locked);
    const before = await prisma.voucher.count({ where: { businessId } });
    for (const date of [yesterday, tomorrow]) {
      const r = await payment(date);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain("তারিখ পরিবর্তনের অনুমতি আপনার নেই");
    }
    expect((await journal(yesterday)).ok).toBe(false);
    expect(await prisma.voucher.count({ where: { businessId } })).toBe(before);
    const ok = await payment(today);
    expect(ok.ok).toBe(true);
    expect((await journal(today)).ok).toBe(true);
  });

  it("without the permission, editing keeps the voucher's own date (an old voucher is not moved to today)", async () => {
    as(owner);
    const old = await payment(yesterday, 300);
    expect(old.ok).toBe(true);
    const id = (old as { id: string }).id;
    as(locked);
    expect((await payment(yesterday, 350, id)).ok).toBe(true); // amount changed, date kept
    const moved = await payment(today, 350, id);
    expect(moved.ok).toBe(false);
    const v = await prisma.voucher.findUniqueOrThrow({ where: { id } });
    expect([v.date.toISOString().slice(0, 10), Number(v.amount)]).toEqual([yesterday, 350]);
  });

  it("with the permission, and as owner ('*'): any date", async () => {
    as(allowed);
    expect((await payment(yesterday)).ok).toBe(true);
    expect((await payment(tomorrow)).ok).toBe(true);
    as(owner);
    expect((await journal(addDays(today, -30))).ok).toBe(true);
  });

  it("paddy purchase is locked too", async () => {
    await createRiceMillTemplate({ businessId, userId: (await prisma.membership.findFirstOrThrow({ where: { businessId } })).userId });
    const paddy = await prisma.product.findFirstOrThrow({ where: { businessId, name: { startsWith: "ধান" } } });
    const slip = (date: string) => call(() => savePaddyPurchaseAction(null, { ok: true }, form({ payload: JSON.stringify({ date, productId: paddy.id, partyAccountId: "", cashAccountId: cash, bagCount: 2, grossKg: 80, dhaltaKg: 0, ratePerMon: 1000, paidAmount: 0 }) })));
    as(locked);
    expect((await slip(yesterday)).ok).toBe(false);
    expect((await slip(today)).ok).toBe(true);
  });

  it("the voucher forms are told: locked to today (new) or to the voucher's date (edit)", async () => {
    as(locked);
    const ctx = (await getContext())!;
    expect(entryDateLock(ctx)).toEqual({ locked: true, date: today });
    expect(entryDateLock(ctx, new Date(`${yesterday}T00:00:00.000Z`))).toEqual({ locked: true, date: yesterday });
    as(allowed);
    expect(entryDateLock((await getContext())!).locked).toBe(false);
  });
});
