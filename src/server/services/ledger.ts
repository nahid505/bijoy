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
  if (accountIds && accountIds.length === 0) return new Map();
  const rows = await prisma.journalEntry.groupBy({
    by: ["accountId"],
    where: {
      businessId,
      ...bookWhere(book),
      voucher: { verificationStatus: { not: "REJECTED" } },
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
  imageUrl?: string | null;
}

export async function listAccounts(businessId: string, where: Prisma.AccountWhereInput = {}): Promise<AccountRow[]> {
  const rows = await prisma.account.findMany({
    where: { businessId, ...where },
    include: { group: true, customer: { select: { imageUrl: true } }, supplier: { select: { imageUrl: true } } },
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
    imageUrl: a.imageUrl ?? a.customer?.imageUrl ?? a.supplier?.imageUrl ?? null,
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
  /** who entered the voucher */
  enteredBy: string | null;
  against: string; // counter ledgers
  accountName?: string;
  debit: number;
  credit: number;
  balance: number; // running, debit − credit
  verificationStatus: "UNVERIFIED" | "VERIFIED" | "REJECTED";
  verifiedBy?: string | null;
  verifiedAt?: Date | null;
  verificationNote?: string | null;
}

export interface StatementResult {
  opening: number;
  lines: StatementLine[];
  entries: StatementLine[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
}

/**
 * Statement for one or more ledgers (multiple = combined cash book / bank book).
 * Opening = balance before `range.gte`; lines are in date order with a running balance.
 */
/**
 * parts: a statement over several (accounts, book) pairs at once — e.g. the depot cash book: every cash ledger's
 * depot-book movements plus the depot cash box's general-book ones. The pairs must not overlap; accountIds is
 * then their union (it decides the counter ledgers).
 */
export async function statement(
  businessId: string,
  accountIds: string[],
  range: DateRange,
  opts: { take?: number; book?: BookFilter; parts?: { accountIds: string[]; book: BookFilter }[]; verificationStatus?: "UNVERIFIED" | "VERIFIED" | "REJECTED" } = {}
): Promise<StatementResult> {
  const parts = opts.parts ?? [{ accountIds, book: opts.book ?? "GENERAL" }];
  const validParts = parts.filter((p) => Array.isArray(p.accountIds) && p.accountIds.length > 0);

  // If no account IDs exist in any scope/part, return empty statement safely without throwing Prisma validation error
  if (!validParts || validParts.length === 0) {
    return {
      opening: 0,
      lines: [],
      entries: [],
      totalDebit: 0,
      totalCredit: 0,
      closing: 0,
    };
  }

  let opening = 0;
  if (range.gte) {
    for (const p of validParts) {
      opening += [...(await balancesBefore(businessId, range.gte, p.accountIds, p.book)).values()].reduce((s, v) => s + v, 0);
    }
  }
  opening = round2(opening);

  const scope = validParts.map((p) => ({ ...bookWhere(p.book), accountId: { in: p.accountIds } }));

  // Double check: if scope array is empty, return safely
  if (!scope || scope.length === 0) {
    return {
      opening: round2(opening),
      lines: [],
      entries: [],
      totalDebit: 0,
      totalCredit: 0,
      closing: round2(opening),
    };
  }

  const whereClause: Prisma.JournalEntryWhereInput = {
    businessId,
    ...(scope.length === 1 ? scope[0] : { OR: scope }),
  };

  if (range.gte || range.lt) {
    whereClause.date = range;
  }

  whereClause.voucher = opts.verificationStatus
    ? { verificationStatus: opts.verificationStatus }
    : { verificationStatus: { not: "REJECTED" } };

  const entries = await prisma.journalEntry.findMany({
    where: whereClause,
    orderBy: [{ date: "asc" }, { voucher: { createdAt: "asc" } }, { lineNo: "asc" }],
    take: opts.take ?? 5000,
    include: {
      voucher: {
        select: {
          id: true,
          voucherNo: true,
          type: true,
          narration: true,
          verificationStatus: true,
          verifiedAt: true,
          verificationNote: true,
          createdBy: { select: { id: true, name: true } },
          verifiedBy: { select: { id: true, name: true } },
        },
      },
      account: { select: { name: true } },
    },
  });

  // Counter ledgers ("against") for each voucher
  const voucherIds = [...new Set(entries.map((e) => e.voucherId).filter(Boolean))];
  const allAccountIds = [
    ...new Set(
      validParts
        .flatMap((p) => p.accountIds || [])
        .concat(accountIds || [])
        .filter(Boolean)
    ),
  ];
  const others = voucherIds.length && allAccountIds.length
    ? await prisma.journalEntry.findMany({
        where: { voucherId: { in: voucherIds }, accountId: { notIn: allAccountIds } },
        select: { voucherId: true, account: { select: { name: true } } },
      })
    : [];
  const against = new Map<string, Set<string>>();
  for (const o of others) {
    if (!o.account?.name) continue;
    (against.get(o.voucherId) ?? against.set(o.voucherId, new Set()).get(o.voucherId)!).add(o.account.name);
  }

  let running = opening;
  const lines: StatementLine[] = entries.map((e) => {
    const debit = Number(e.debit) || 0;
    const credit = Number(e.credit) || 0;
    running = round2(running + debit - credit);
    const v = e.voucher;
    const rawStatus = (v?.verificationStatus || "UNVERIFIED") as string;
    const verificationStatus = (rawStatus === "VERIFIED" || rawStatus === "REJECTED" ? rawStatus : "UNVERIFIED") as "UNVERIFIED" | "VERIFIED" | "REJECTED";
    const enteredByName =
      typeof v?.createdBy === "object" && v?.createdBy !== null
        ? (v.createdBy as any).name?.trim() || null
        : typeof v?.createdBy === "string"
        ? (v.createdBy as string).trim() || null
        : null;
    const verifiedByName =
      typeof v?.verifiedBy === "object" && v?.verifiedBy !== null
        ? (v.verifiedBy as any).name?.trim() || null
        : typeof v?.verifiedBy === "string"
        ? (v.verifiedBy as string).trim() || null
        : null;
    const verifiedAtDate =
      v?.verifiedAt instanceof Date
        ? v.verifiedAt
        : v?.verifiedAt
        ? new Date(v.verifiedAt)
        : null;

    return {
      entryId: e.id,
      date: e.date,
      voucherId: v?.id ?? e.voucherId ?? "",
      voucherNo: v?.voucherNo ?? "",
      voucherType: v?.type ?? "JOURNAL",
      narration: v?.narration ?? e.narration ?? null,
      enteredBy: enteredByName,
      against: [...(against.get(e.voucherId) ?? [])].join(", "),
      accountName: e.account?.name ?? "",
      debit,
      credit,
      balance: running,
      verificationStatus,
      verifiedBy: verifiedByName,
      verifiedAt: verifiedAtDate,
      verificationNote: v?.verificationNote ?? null,
    };
  });
  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
  return {
    opening,
    lines,
    entries: lines,
    totalDebit,
    totalCredit,
    closing: round2(opening + totalDebit - totalCredit),
  };
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
