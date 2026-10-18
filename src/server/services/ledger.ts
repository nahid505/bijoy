// LedgerService — every balance in the application is computed here from journal entries.
// Every function reads ONE book (default GENERAL): the depot keeps its own book (src/lib/book.ts) and
// depot code passes "DEPOT"; "ALL" is only for physical / integrity checks.
import type { AccountKind, AccountNature, Prisma, VoucherType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { bookWhere, type BookFilter } from "@/lib/book";
import { round2 } from "@/lib/calc";

export interface DateRange {
  gte?: Date;
  lt?: Date;
}

export interface Movement {
  debit: number;
  credit: number;
}

/** Σ debit / Σ credit per account within an optional date range. */
export async function accountMovements(businessId: string, range: DateRange = {}, accountIds?: string[], book: BookFilter = "GENERAL"): Promise<Map<string, Movement>> {
  const rows = await prisma.journalEntry.groupBy({
    by: ["accountId"],
    where: {
      businessId,
      ...bookWhere(book),
      ...(range.gte || range.lt ? { date: range } : {}),
      ...(accountIds ? { accountId: { in: accountIds } } : {}),
    },
    _sum: { debit: true, credit: true },
  });
  return new Map(rows.map((r) => [r.accountId, { debit: Number(r._sum.debit ?? 0), credit: Number(r._sum.credit ?? 0) }]));
}

/** Net balance (debit − credit) per account up to (excluding) `before`. */
export async function balancesBefore(businessId: string, before?: Date, accountIds?: string[], book: BookFilter = "GENERAL") {
  const m = await accountMovements(businessId, before ? { lt: before } : {}, accountIds, book);
  return new Map([...m].map(([id, v]) => [id, round2(v.debit - v.credit)]));
}

export interface AccountRow {
  id: string;
  name: string;
  code: string | null;
  kind: AccountKind;
  nature: AccountNature;
  groupId: string;
  groupName: string;
  groupKey: string | null;
  groupSort: number;
  isDirect: boolean;
  isSystem: boolean;
  isActive: boolean;
}

export async function listAccounts(businessId: string, where: Prisma.AccountWhereInput = {}): Promise<AccountRow[]> {
  const rows = await prisma.account.findMany({
    where: { businessId, ...where },
    include: { group: true },
    orderBy: [{ group: { sortOrder: "asc" } }, { code: "asc" }, { name: "asc" }],
  });
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    code: a.code,
    kind: a.kind,
    nature: a.nature,
    groupId: a.groupId,
    groupName: a.group.name,
    groupKey: a.group.systemKey,
    groupSort: a.group.sortOrder,
    isDirect: a.group.isDirect,
    isSystem: a.isSystem,
    isActive: a.isActive,
  }));
}

/** Current balance (debit − credit) of accounts filtered by kind, e.g. all CASH ledgers. */
export async function balancesByKind(businessId: string, kinds: AccountKind[], before?: Date, book: BookFilter = "GENERAL") {
  const accounts = await listAccounts(businessId, { kind: { in: kinds } });
  const bal = await balancesBefore(businessId, before, accounts.map((a) => a.id), book);
  return accounts.map((a) => ({ ...a, balance: bal.get(a.id) ?? 0 }));
}

export function sumBalances(rows: { balance: number }[]) {
  return round2(rows.reduce((s, r) => s + r.balance, 0));
}

export interface StatementLine {
  entryId: string;
  date: Date;
  voucherId: string;
  voucherNo: string;
  voucherType: VoucherType;
  narration: string | null;
  against: string; // counter ledgers
  accountName?: string;
  debit: number;
  credit: number;
  balance: number; // running, debit − credit
}

/**
 * Statement for one or more ledgers (multiple = combined cash book / bank book).
 * Opening = balance before `range.gte`; lines are in date order with a running balance.
 */
export async function statement(businessId: string, accountIds: string[], range: DateRange, opts: { take?: number; book?: BookFilter } = {}) {
  const book = opts.book ?? "GENERAL";
  const opening = range.gte
    ? round2([...(await balancesBefore(businessId, range.gte, accountIds, book)).values()].reduce((s, v) => s + v, 0))
    : 0;
  const entries = await prisma.journalEntry.findMany({
    where: { businessId, ...bookWhere(book), accountId: { in: accountIds }, ...(range.gte || range.lt ? { date: range } : {}) },
    orderBy: [{ date: "asc" }, { voucher: { createdAt: "asc" } }, { lineNo: "asc" }],
    take: opts.take ?? 5000,
    include: { voucher: { select: { id: true, voucherNo: true, type: true, narration: true } }, account: { select: { name: true } } },
  });

  // Counter ledgers ("against") for each voucher
  const voucherIds = [...new Set(entries.map((e) => e.voucherId))];
  const others = voucherIds.length
    ? await prisma.journalEntry.findMany({
        where: { voucherId: { in: voucherIds }, accountId: { notIn: accountIds } },
        select: { voucherId: true, account: { select: { name: true } } },
      })
    : [];
  const against = new Map<string, Set<string>>();
  for (const o of others) (against.get(o.voucherId) ?? against.set(o.voucherId, new Set()).get(o.voucherId)!).add(o.account.name);

  let running = opening;
  const lines: StatementLine[] = entries.map((e) => {
    const debit = Number(e.debit);
    const credit = Number(e.credit);
    running = round2(running + debit - credit);
    return {
      entryId: e.id,
      date: e.date,
      voucherId: e.voucher.id,
      voucherNo: e.voucher.voucherNo,
      voucherType: e.voucher.type,
      narration: e.voucher.narration ?? e.narration,
      against: [...(against.get(e.voucherId) ?? [])].join(", "),
      accountName: e.account.name,
      debit,
      credit,
      balance: running,
    };
  });
  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
  return { opening, lines, totalDebit, totalCredit, closing: round2(opening + totalDebit - totalCredit) };
}

/** Party (customer / supplier) summary: opening, debit, credit, closing in a period. */
export async function partySummaries(businessId: string, kind: "CUSTOMER" | "SUPPLIER", range: DateRange, accountIds?: string[], book: BookFilter = "GENERAL") {
  const accounts = await prisma.account.findMany({
    where: { businessId, kind, ...(accountIds ? { id: { in: accountIds } } : {}) },
    select: { id: true },
  });
  const ids = accounts.map((a) => a.id);
  const [openings, period] = await Promise.all([
    range.gte ? balancesBefore(businessId, range.gte, ids, book) : Promise.resolve(new Map<string, number>()),
    accountMovements(businessId, range, ids, book),
  ]);
  return new Map(
    ids.map((id) => {
      const opening = openings.get(id) ?? 0;
      const m = period.get(id) ?? { debit: 0, credit: 0 };
      return [id, { opening, debit: round2(m.debit), credit: round2(m.credit), closing: round2(opening + m.debit - m.credit) }];
    }),
  );
}
