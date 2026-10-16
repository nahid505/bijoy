// Account groups created from the "+ নতুন গ্রুপ" popup: top groups, sub-groups, rules, reports and backup.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { accountGroupSchema, accountSchema } from "@/lib/validation";
import { createBusiness } from "@/server/services/bootstrap";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import { accountGroupOptions, createAccountGroup, saveAccount } from "@/server/services/master";
import { saveCashVoucher } from "@/server/services/voucher";
import { balanceSheet, profitAndLoss, trialBalance } from "@/server/services/report";
import { EXTRA_REPORTS } from "@/server/reports/extra";
import { exportBusiness, restoreBackup, validateBackup } from "@/server/services/backup";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

run("account groups (+ নতুন গ্রুপ)", () => {
  let ctx: Ctx;
  let acc: Awaited<ReturnType<typeof systemAccounts>>;
  const key = async (systemKey: string) => (await prisma.accountGroup.findFirstOrThrow({ where: { businessId: ctx.businessId, systemKey } })).id;
  const create = (o: Record<string, unknown>) => createAccountGroup(ctx, accountGroupSchema.parse({ parentId: "", description: "", ...o }));
  const ledger = (name: string, groupId: string) => saveAccount(ctx, accountSchema.parse({ name, groupId, openingBalance: 0, openingSide: "DR" }));
  const fails = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      return e as UserError;
    }
  };

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { name: "Groups", email: `groups${Date.now()}@test.local`, passwordHash: "x" } });
    const business = await prisma.$transaction((tx) => createBusiness(tx, { name: "গ্রুপ টেস্ট", ownerUserId: user.id }));
    ctx = { businessId: business.id, userId: user.id };
    acc = await prisma.$transaction((tx) => systemAccounts(tx, ctx.businessId));
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("top group: chosen nature, indirect P&L section, listed last, with description", async () => {
    const g = await create({ name: "প্রশাসনিক খরচ", nature: "EXPENSE", description: "অফিস ও প্রশাসন" });
    expect(g).toMatchObject({ name: "প্রশাসনিক খরচ", nature: "EXPENSE", parentId: null, depth: 0, canParent: true, systemKey: null });
    const row = await prisma.accountGroup.findUniqueOrThrow({ where: { id: g.id } });
    expect(row.isDirect).toBe(false);
    expect(row.description).toBe("অফিস ও প্রশাসন");
    const opts = await accountGroupOptions(ctx.businessId);
    expect(opts.at(-1)?.id).toBe(g.id);
    expect(opts.some((o) => o.systemKey === "SUNDRY_DEBTORS" || o.systemKey === "SUNDRY_CREDITORS")).toBe(false);
  });

  it("sub-group: under its parent in the dropdown, parent's nature and P&L section", async () => {
    const direct = await key("DIRECT_EXPENSES");
    const sub = await create({ name: "মিল শ্রমিক মজুরি", nature: "EXPENSE", parentId: direct });
    expect(sub).toMatchObject({ parentId: direct, depth: 1 });
    expect((await prisma.accountGroup.findUniqueOrThrow({ where: { id: sub.id } })).isDirect).toBe(true);
    const subsub = await create({ name: "দৈনিক মজুরি", nature: "EXPENSE", parentId: sub.id });
    expect(subsub.depth).toBe(2);
    const opts = await accountGroupOptions(ctx.businessId);
    const i = opts.findIndex((o) => o.id === direct);
    expect(opts.slice(i, i + 3).map((o) => [o.id, o.depth])).toEqual([[direct, 0], [sub.id, 1], [subsub.id, 2]]);

    // a ledger in the sub-sub-group counts as a direct expense (cost of sales) in P&L
    const wages = await ledger("শ্রমিক মজুরি", subsub.id);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: wages } })).nature).toBe("EXPENSE");
    await saveCashVoucher(ctx, "PAYMENT", { date: D("2026-10-01"), reference: null, narration: null, cashAccountId: acc.CASH, lines: [{ accountId: wages, amount: 700, narration: null }] });
    const pl = await profitAndLoss(ctx.businessId, {});
    expect(pl.directExpenses).toBe(700);
  });

  it("rules: duplicate name (any case), nature must match the parent, no sub-groups under cash/bank/debtors/creditors", async () => {
    expect((await fails(create({ name: "প্রশাসনিক খরচ", nature: "EXPENSE" })))?.fields?.name).toBeTruthy();
    expect((await fails(create({ name: "নগদ তহবিল", nature: "ASSET" })))?.fields?.name).toBeTruthy();
    await create({ name: "Office Supplies", nature: "EXPENSE" });
    expect(await fails(create({ name: "office supplies", nature: "EXPENSE" }))).not.toBeNull();
    expect((await fails(create({ name: "যন্ত্রপাতি", nature: "EXPENSE", parentId: await key("FIXED_ASSETS") })))?.fields?.nature).toBeTruthy();
    for (const k of ["CASH_IN_HAND", "BANK_ACCOUNTS", "SUNDRY_DEBTORS", "SUNDRY_CREDITORS"]) {
      expect((await fails(create({ name: `সাব ${k}`, nature: k.startsWith("SUNDRY_CREDITORS") ? "LIABILITY" : "ASSET", parentId: await key(k) })))?.fields?.parentId).toBeTruthy();
    }
    // depth limit: 4 levels below a top group
    let parent = await key("CURRENT_LIABILITIES");
    for (let d = 1; d <= 4; d++) parent = (await create({ name: `স্তর ${d}`, nature: "LIABILITY", parentId: parent })).id;
    expect((await fails(create({ name: "স্তর ৫", nature: "LIABILITY", parentId: parent })))?.fields?.parentId).toBeTruthy();
  });

  it("tenant isolation: another business's group cannot be a parent", async () => {
    const user = await prisma.user.create({ data: { name: "Other", email: `groups-o${Date.now()}@test.local`, passwordHash: "x" } });
    const other = await prisma.$transaction((tx) => createBusiness(tx, { name: "অন্য ব্যবসা", ownerUserId: user.id }));
    const foreign = await prisma.accountGroup.findFirstOrThrow({ where: { businessId: other.id, systemKey: "INDIRECT_EXPENSES" } });
    expect((await fails(create({ name: "চুরি", nature: "EXPENSE", parentId: foreign.id })))?.fields?.parentId).toBeTruthy();
    expect(await prisma.accountGroup.count({ where: { businessId: other.id, name: "চুরি" } })).toBe(0);
  });

  it("balance sheet and cash flow: a sub-group of স্থায়ী সম্পদ is a fixed asset and an investing outflow", async () => {
    const machinery = await create({ name: "মেশিনারি", nature: "ASSET", parentId: await key("FIXED_ASSETS") });
    const huller = await ledger("হাস্কিং মেশিন", machinery.id);
    await saveCashVoucher(ctx, "PAYMENT", { date: D("2026-10-02"), reference: null, narration: null, cashAccountId: acc.CASH, lines: [{ accountId: huller, amount: 50_000, narration: null }] });
    const bs = await balanceSheet(ctx.businessId, D("2026-12-31"));
    expect(bs.assets.find((g) => g.name === "মেশিনারি")?.total).toBe(50_000);
    expect(bs.difference).toBe(0);
    const cf = EXTRA_REPORTS.find((r) => r.slug === "cash-flow")!;
    const res = await cf.run({ business: { id: ctx.businessId, fiscalYearStartMonth: 7, currencySymbol: "৳" } } as never, { from: "2026-10-01", to: "2026-10-31" });
    const row = res.rows.find((r) => r.cells.particulars === "স্থায়ী সম্পদ ক্রয়/বিক্রয়");
    expect(row?.cells.outflow).toBe(50_000);
    const investing = res.rows.find((r) => r.cells.particulars === "বিনিয়োগ কার্যক্রম থেকে নিট নগদ");
    expect(investing?.cells.net).toBe(-50_000);
    expect((await trialBalance(ctx.businessId, {})).balanced).toBe(true);
  });

  it("backup keeps the tree and descriptions", async () => {
    const file = await exportBusiness(ctx.businessId);
    expect(validateBackup(file).ok).toBe(true);
    const restored = await restoreBackup(file, ctx.userId);
    const groups = await prisma.accountGroup.findMany({ where: { businessId: restored.businessId }, include: { parent: true } });
    const by = (n: string) => groups.find((g) => g.name === n)!;
    expect(by("দৈনিক মজুরি").parent?.name).toBe("মিল শ্রমিক মজুরি");
    expect(by("মিল শ্রমিক মজুরি").parent?.systemKey).toBe("DIRECT_EXPENSES");
    expect(by("স্তর 4").parent?.name).toBe("স্তর 3");
    expect(by("প্রশাসনিক খরচ").description).toBe("অফিস ও প্রশাসন");
    expect((await trialBalance(restored.businessId, {})).balanced).toBe(true);

    // a backup whose group points at a missing parent is refused
    const bad = JSON.parse(JSON.stringify(file));
    bad.data.accountGroups.find((g: { name: string }) => g.name === "মেশিনারি").parentId = "does-not-exist";
    expect(validateBackup(bad).ok).toBe(false);
  });
});
