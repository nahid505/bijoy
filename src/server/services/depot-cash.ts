// "ডিপো ক্যাশ" — the depot's cash box — and depot expenses.
//
//   ডিপো ক্যাশ     a general-book cash ledger (group নগদ, systemKey GENERAL_DEPOT_CASH), created per depot business.
//   fund transfer  general JOURNAL: IN  Dr ডিপো ক্যাশ / Cr main cash or bank;  OUT the reverse.
//   depot expense  general PAYMENT: Dr the expense head / Cr ডিপো ক্যাশ (or the chosen cash / bank).
//
// Both are general-book vouchers, so a depot expense is part of the business's P&L, cash flow and day book; they are
// told apart from other vouchers by their sourceKey (depot-expense:<uuid>, depot-fund:<uuid>). Depot-book
// collections and company payments may use ডিপো ক্যাশ as well, so its real balance (the cash in the box) is the sum
// over both books — that is what the depot cash book and the "not enough cash" check use.
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { round2 } from "@/lib/calc";
import { formatMoney } from "@/lib/format";
import { DEPOT_CASH_KEY, DEPOT_EXPENSE_SOURCE, DEPOT_FUND_SOURCE, isDepot } from "@/lib/depot";
import type { DepotExpenseInput, DepotFundInput } from "@/lib/validation";
import { assertAccounts, assertBookAccounts, assertNotLocked, nextVoucherNo, writeEntries, type Ctx, type Tx } from "./accounting";
import { TX_OPTIONS } from "./voucher";

export { ensureDepotCash } from "./bootstrap";
import { ensureDepotCash } from "./bootstrap";

/** ডিপো ক্যাশ id without creating it (read-only pages). */
export async function depotCashId(businessId: string) {
  return (await prisma.account.findFirst({ where: { businessId, systemKey: DEPOT_CASH_KEY }, select: { id: true } }))?.id ?? null;
}

/** Real balance of a cash ledger — every book (the cash in the box), optionally leaving one voucher out (an edit). */
export async function cashInHand(db: Pick<Tx, "journalEntry">, businessId: string, accountId: string, exceptVoucherId?: string) {
  const s = await db.journalEntry.aggregate({
    where: { businessId, accountId, ...(exceptVoucherId ? { NOT: { voucherId: exceptVoucherId } } : {}) },
    _sum: { debit: true, credit: true },
  });
  return round2(num(s._sum.debit) - num(s._sum.credit));
}

async function assertCashAvailable(tx: Tx, businessId: string, accountId: string, amount: number, exceptVoucherId?: string) {
  const a = await tx.account.findUniqueOrThrow({ where: { id: accountId }, select: { kind: true, name: true } });
  if (a.kind !== "CASH") return; // a bank account may run an overdraft — only a cash box cannot go below zero
  const balance = await cashInHand(tx, businessId, accountId, exceptVoucherId);
  if (amount > balance + 0.001) throw new UserError(`"${a.name}"-এ পর্যাপ্ত টাকা নেই — বর্তমান ব্যালেন্স ${formatMoney(balance)}`, { amount: ["ব্যালেন্সের চেয়ে বেশি"] });
}

async function assertDepot(tx: Tx, businessId: string) {
  const b = await tx.business.findUnique({ where: { id: businessId }, select: { businessType: true } });
  if (!isDepot(b?.businessType)) throw new UserError("এটি ডিপো ব্যবসা নয়");
}

/** A depot expense voucher of this business (for edit / delete); refuses any other voucher. */
export async function loadDepotExpense(db: Pick<Tx, "voucher">, businessId: string, id: string) {
  const v = await db.voucher.findFirst({ where: { id, businessId, type: "PAYMENT", sourceKey: { startsWith: DEPOT_EXPENSE_SOURCE } }, include: { entries: true } });
  if (!v) throw new UserError("ডিপো খরচ পাওয়া যায়নি");
  return v;
}

/** Saves a depot expense: general PAYMENT, Dr expense head / Cr ডিপো ক্যাশ (or the chosen cash / bank). */
export async function saveDepotExpense(ctx: Ctx, input: DepotExpenseInput, editId?: string) {
  return prisma.$transaction(async (tx) => {
    await assertDepot(tx, ctx.businessId);
    const existing = editId ? await loadDepotExpense(tx, ctx.businessId, editId) : null;
    await assertNotLocked(tx, ctx.businessId, input.date, existing?.date);
    if (input.expenseAccountId === input.cashAccountId) throw new UserError("খরচের খাত ও পেমেন্ট মেথড একই হতে পারে না");
    await assertBookAccounts(tx, ctx.businessId, "GENERAL", [input.cashAccountId, input.expenseAccountId]);
    await assertAccounts(tx, ctx.businessId, [input.cashAccountId], { kinds: ["CASH", "BANK"], label: "নগদ/ব্যাংক হিসাব" });
    const head = await tx.account.findFirst({ where: { id: input.expenseAccountId, businessId: ctx.businessId }, select: { nature: true, isActive: true, name: true } });
    if (!head || head.nature !== "EXPENSE") throw new UserError("খরচের খাত হিসেবে একটি ব্যয়ের হিসাব নির্বাচন করুন", { expenseAccountId: ["ব্যয়ের হিসাব নয়"] });
    if (!existing && !head.isActive) throw new UserError(`"${head.name}" নিষ্ক্রিয় হিসাব`);
    await assertCashAvailable(tx, ctx.businessId, input.cashAccountId, input.amount, existing?.id);
    const narration = input.narration ?? "ডিপো খরচ";
    const header = { date: input.date, reference: input.reference, narration, cashAccountId: input.cashAccountId, partyAccountId: input.expenseAccountId, amount: input.amount, paidAmount: input.amount };
    const voucher = existing
      ? await tx.voucher.update({ where: { id: existing.id }, data: { ...header, updatedById: ctx.userId } })
      : await tx.voucher.create({
          data: { ...header, businessId: ctx.businessId, type: "PAYMENT", book: "GENERAL", sourceKey: `${DEPOT_EXPENSE_SOURCE}${randomUUID()}`, voucherNo: await nextVoucherNo(tx, ctx.businessId, "PAYMENT"), createdById: ctx.userId },
        });
    await writeEntries(tx, voucher, [
      { accountId: input.expenseAccountId, debit: input.amount, credit: 0, narration },
      { accountId: input.cashAccountId, debit: 0, credit: input.amount, narration },
    ]);
    return voucher;
  }, TX_OPTIONS);
}

export async function deleteDepotExpense(ctx: Ctx, id: string) {
  return prisma.$transaction(async (tx) => {
    const v = await loadDepotExpense(tx, ctx.businessId, id);
    await assertNotLocked(tx, ctx.businessId, v.date);
    await tx.journalEntry.deleteMany({ where: { voucherId: v.id } });
    await tx.voucher.delete({ where: { id: v.id } });
    return v;
  }, TX_OPTIONS);
}

/** Fund transfer main cash / bank ⇄ ডিপো ক্যাশ (general JOURNAL). OUT may not take more than the depot cash holds. */
export async function transferDepotFund(ctx: Ctx, input: DepotFundInput) {
  return prisma.$transaction(async (tx) => {
    await assertDepot(tx, ctx.businessId);
    await assertNotLocked(tx, ctx.businessId, input.date);
    const depotCash = (await ensureDepotCash(tx, ctx.businessId))!;
    if (input.mainAccountId === depotCash) throw new UserError("মূল নগদ/ব্যাংক হিসাব ও ডিপো ক্যাশ একই হতে পারে না", { mainAccountId: ["অন্য হিসাব নির্বাচন করুন"] });
    await assertBookAccounts(tx, ctx.businessId, "GENERAL", [input.mainAccountId]);
    await assertAccounts(tx, ctx.businessId, [input.mainAccountId], { kinds: ["CASH", "BANK"], label: "নগদ/ব্যাংক হিসাব" });
    const [to, from] = input.direction === "IN" ? [depotCash, input.mainAccountId] : [input.mainAccountId, depotCash];
    await assertCashAvailable(tx, ctx.businessId, from, input.amount);
    const narration = input.narration ?? (input.direction === "IN" ? "ডিপো ক্যাশে ফান্ড স্থানান্তর" : "ডিপো ক্যাশ থেকে মূল ক্যাশে ফেরত");
    const voucher = await tx.voucher.create({
      data: {
        businessId: ctx.businessId, type: "JOURNAL", book: "GENERAL", date: input.date, reference: input.reference, narration, amount: input.amount,
        sourceKey: `${DEPOT_FUND_SOURCE}${randomUUID()}`, voucherNo: await nextVoucherNo(tx, ctx.businessId, "JOURNAL"), createdById: ctx.userId,
      },
    });
    await writeEntries(tx, voucher, [
      { accountId: to, debit: input.amount, credit: 0, narration },
      { accountId: from, debit: 0, credit: input.amount, narration },
    ]);
    return voucher;
  }, TX_OPTIONS);
}

export interface DepotExpenseFilter {
  from?: Date;
  /** exclusive */
  to?: Date;
  expenseAccountId?: string;
  q?: string;
  /** restricted user: their voucher scope (voucherScopeWhere) */
  scope?: Prisma.VoucherWhereInput;
}

/** Depot expense list with the period total. */
export async function listDepotExpenses(businessId: string, f: DepotExpenseFilter = {}) {
  const q = f.q?.trim();
  const where = {
    businessId,
    type: "PAYMENT" as const,
    sourceKey: { startsWith: DEPOT_EXPENSE_SOURCE },
    ...(f.from || f.to ? { date: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(f.expenseAccountId ? { partyAccountId: f.expenseAccountId } : {}),
    ...(f.scope ?? {}),
    ...(q ? { OR: [{ voucherNo: { contains: q } }, { reference: { contains: q } }, { narration: { contains: q } }] } : {}),
  };
  const [rows, sum] = await Promise.all([
    prisma.voucher.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 500,
      select: { id: true, voucherNo: true, date: true, reference: true, narration: true, amount: true, partyAccount: { select: { id: true, name: true } }, cashAccount: { select: { id: true, name: true } }, createdBy: { select: { name: true } } },
    }),
    prisma.voucher.aggregate({ where, _sum: { amount: true }, _count: true }),
  ]);
  return { rows, total: round2(num(sum._sum.amount)), count: sum._count };
}

/** Depot cash summary for the cards: balance (both books), this period's receipts and payments. */
export async function depotCashSummary(businessId: string) {
  const id = await depotCashId(businessId);
  if (!id) return null;
  const balance = await cashInHand(prisma, businessId, id);
  return { accountId: id, balance };
}
