// User-specific account heads ("শুধু নির্ধারিত হিসাব খাত দেখতে পারবে" — accounts:assigned_only, UserAccount).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBusiness } from "@/server/services/bootstrap";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import { saveAccount, saveParty } from "@/server/services/master";
import { saveCashVoucher } from "@/server/services/voucher";
import {
  accountScopeWhere, assertPartiesAllowed, assignedPartiesOf, canOpenLedger, canSeeVoucher, isRestricted, loadPartyScope, restrictionsOf, saveAssignments, voucherScopeWhere, type PartyScope,
} from "@/server/party-scope";
import { findReport, reportOpenFor } from "@/server/reports/registry";
import { searchAccounts } from "@/server/lookup";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

run("account-head restriction (শুধু নির্ধারিত হিসাব খাত)", () => {
  let owner: Ctx;
  let clerk: { id: string };
  let acc: Awaited<ReturnType<typeof systemAccounts>>;
  const head: Record<string, string> = {};
  const v: Record<string, string> = {};
  let customer: { id: string; accountId: string };
  let scope: PartyScope;
  const ctxOf = () => ({ partyScope: scope, user: { id: clerk.id }, business: { id: owner.businessId, currencySymbol: "৳", fiscalYearStartMonth: 7, businessType: null }, permissions: ["reports:view"] });
  const pay = (cash: string, line: string, amount: number) =>
    saveCashVoucher(owner, "PAYMENT", { date: D("2026-10-10"), reference: null, narration: null, cashAccountId: cash, lines: [{ accountId: line, amount, narration: null }] });

  beforeAll(async () => {
    const u = await prisma.user.create({ data: { name: "Owner", email: `as-o${Date.now()}@test.local`, passwordHash: "x" } });
    const business = await prisma.$transaction((tx) => createBusiness(tx, { name: "হিসাব খাত", ownerUserId: u.id }));
    owner = { businessId: business.id, userId: u.id };
    acc = await prisma.$transaction((tx) => systemAccounts(tx, owner.businessId));
    const group = async (key: string) => (await prisma.accountGroup.findFirstOrThrow({ where: { businessId: owner.businessId, systemKey: key } })).id;
    const make = async (name: string, g: string) => (head[name] = await saveAccount(owner, { name, code: null, groupId: await group(g), description: null, bankName: null, accountNumber: null, openingBalance: 0, openingSide: "DR" } as never));
    await make("ব্যাংক এশিয়া", "BANK_ACCOUNTS");
    await make("দোকান ভাড়া", "INDIRECT_EXPENSES");
    await make("বিদ্যুৎ বিল", "INDIRECT_EXPENSES");
    customer = await saveParty(owner, "CUSTOMER", { name: "রহিম", mobile: null, email: null, address: null, notes: null, openingBalance: 0, creditLimit: 0, creditDays: 0 });
    clerk = await prisma.user.create({ data: { name: "Clerk", email: `as-c${Date.now()}@test.local`, passwordHash: "x" } });
    const role = await prisma.role.create({ data: { businessId: business.id, name: "খরচ কেরানি", permissions: ["accounts:view", "vouchers:view", "vouchers:create", "reports:view", "accounts:assigned_only"] } });
    await prisma.membership.create({ data: { businessId: business.id, userId: clerk.id, roleId: role.id } });
    // owner's vouchers
    await saveCashVoucher(owner, "RECEIPT", { date: D("2026-10-09"), reference: null, narration: null, cashAccountId: acc.CASH, lines: [{ accountId: acc.OPENING_EQUITY ?? head["দোকান ভাড়া"], amount: 50_000, narration: null }] }).catch(() => null);
    v.rentCash = (await pay(acc.CASH, head["দোকান ভাড়া"], 5_000)).id;
    v.powerBank = (await pay(head["ব্যাংক এশিয়া"], head["বিদ্যুৎ বিল"], 1_200)).id;
    v.powerCash = (await pay(acc.CASH, head["বিদ্যুৎ বিল"], 800)).id;
    // assignment: cash in hand + rent (a customer ledger in the list is ignored — parties are assigned as customers)
    expect(await saveAssignments(owner.businessId, clerk.id, [], [], [acc.CASH, head["দোকান ভাড়া"], customer.accountId])).toEqual({ customers: 0, suppliers: 0, accounts: 2 });
    scope = await loadPartyScope(owner.businessId, clerk.id, restrictionsOf(role.permissions, false));
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("the key restricts only when named; the scope carries the assigned heads", async () => {
    expect(restrictionsOf(["accounts:assigned_only"], false)).toMatchObject({ accounts: true, customers: false });
    expect(restrictionsOf(["*"], false).accounts).toBe(false);
    expect(restrictionsOf(["accounts:assigned_only"], true).accounts).toBe(false);
    expect(scope.customers).toBeNull();
    expect([...(scope.accounts ?? [])].sort()).toEqual([acc.CASH, head["দোকান ভাড়া"]].sort());
    expect(isRestricted(ctxOf())).toBe(true);
    const a = await assignedPartiesOf(owner.businessId, clerk.id);
    expect(a.accounts.map((x) => x.name).sort()).toEqual(["দোকান ভাড়া", "নগদ ক্যাশ"].sort());
  });

  it("ledger list and pickers: only my heads (and party ledgers, which follow the party restriction)", async () => {
    const heads = await prisma.account.findMany({ where: { businessId: owner.businessId, customer: { is: null }, supplier: { is: null }, ...accountScopeWhere(ctxOf()) }, select: { id: true } });
    expect(heads.map((x) => x.id).sort()).toEqual([acc.CASH, head["দোকান ভাড়া"]].sort());
    const names = (await searchAccounts(owner.businessId, "", { where: accountScopeWhere(ctxOf()), take: 50 })).items.map((x) => x.name);
    expect(names).toContain("দোকান ভাড়া");
    expect(names).toContain("রহিম");
    expect(names).not.toContain("বিদ্যুৎ বিল");
    expect(names).not.toContain("ব্যাংক এশিয়া");
    expect((await searchAccounts(owner.businessId, "", { scope: "cash", where: accountScopeWhere(ctxOf()) })).items.map((x) => x.id)).toEqual([acc.CASH]);
  });

  it("ledgers by id: my heads open, others are refused", async () => {
    expect(await canOpenLedger(ctxOf(), acc.CASH)).toBe(true);
    expect(await canOpenLedger(ctxOf(), head["দোকান ভাড়া"])).toBe(true);
    expect(await canOpenLedger(ctxOf(), head["বিদ্যুৎ বিল"])).toBe(false);
    expect(await canOpenLedger(ctxOf(), head["ব্যাংক এশিয়া"])).toBe(false);
    expect(await canOpenLedger(ctxOf(), customer.accountId)).toBe(true); // parties are not restricted for this role
    const r = await findReport("ledger")!.run(ctxOf() as never, { accountId: head["বিদ্যুৎ বিল"] });
    expect(r.rows).toHaveLength(0);
  });

  it("vouchers: visible when they touch one of my heads; by id otherwise refused", async () => {
    const seen = new Set((await prisma.voucher.findMany({ where: { businessId: owner.businessId, type: "PAYMENT", ...voucherScopeWhere(ctxOf()) }, select: { id: true } })).map((x) => x.id));
    expect(seen.has(v.rentCash)).toBe(true);
    expect(seen.has(v.powerCash)).toBe(true); // paid from my cash
    expect(seen.has(v.powerBank)).toBe(false);
    expect(await canSeeVoucher(ctxOf(), v.powerBank)).toBe(false);
  });

  it("saving: a voucher with a head outside my list is refused", async () => {
    await expect(assertPartiesAllowed(ctxOf(), [head["ব্যাংক এশিয়া"]])).rejects.toThrow(/হিসাব খাত "ব্যাংক এশিয়া" আপনার জন্য নির্ধারিত নয়/);
    await expect(assertPartiesAllowed(ctxOf(), [acc.CASH, head["বিদ্যুৎ বিল"]])).rejects.toThrow(/বিদ্যুৎ বিল/);
    await expect(assertPartiesAllowed(ctxOf(), [acc.CASH, head["দোকান ভাড়া"], customer.accountId])).resolves.toBeUndefined();
  });

  it("reports: cash / bank / day book filtered to my heads; the business-wide statements stay closed", async () => {
    for (const slug of ["cash-book", "bank-book", "day-book", "ledger", "sales"]) expect(reportOpenFor(ctxOf(), slug), slug).toBe(true);
    for (const slug of ["trial-balance", "profit-loss", "balance-sheet", "daily-cash", "expenses"]) expect(reportOpenFor(ctxOf(), slug), slug).toBe(false);
    const cash = JSON.stringify((await findReport("cash-book")!.run(ctxOf() as never, { from: "2026-07-01", to: "2026-10-31" })).rows);
    expect(cash).toContain("দোকান ভাড়া");
    const bank = await findReport("bank-book")!.run(ctxOf() as never, { from: "2026-07-01", to: "2026-10-31" });
    expect(bank.rows).toHaveLength(0); // no bank head assigned
    const day = JSON.stringify((await findReport("day-book")!.run(ctxOf() as never, { from: "2026-07-01", to: "2026-10-31" })).rows);
    const no = async (id: string) => (await prisma.voucher.findUniqueOrThrow({ where: { id } })).voucherNo;
    expect(day).toContain(await no(v.rentCash));
    expect(day).not.toContain(await no(v.powerBank));
  });
});
