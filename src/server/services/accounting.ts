// AccountingService — the single gateway for writing to the general ledger.
// Every voucher is posted here, inside the caller's DB transaction, and is rejected
// unless Σ debit = Σ credit (see prepareEntries in src/lib/accounting.ts).
import type { AccountKind, Prisma, VoucherType } from "@prisma/client";
import { openingEntries, prepareEntries, UnbalancedVoucherError, VOUCHER_TYPES, type EntryLine, type SystemAccounts } from "@/lib/accounting";
import { isMySql } from "@/lib/dialect";
import { UserError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { DEPOT_PREFIX, type BookKey } from "@/lib/book";

export type Tx = Prisma.TransactionClient;

export interface Ctx {
  businessId: string;
  userId: string;
}

const SYSTEM_KEYS: (keyof SystemAccounts)[] = [
  "CASH", "INVENTORY", "VAT_PAYABLE", "OPENING_EQUITY", "SALES", "SALES_RETURN", "COGS", "DISCOUNT_ALLOWED", "STOCK_ADJUSTMENT",
];

export async function systemAccounts(tx: Tx, businessId: string): Promise<SystemAccounts> {
  const rows = await tx.account.findMany({ where: { businessId, systemKey: { in: SYSTEM_KEYS } }, select: { id: true, systemKey: true } });
  const map = Object.fromEntries(rows.map((r) => [r.systemKey, r.id])) as Partial<SystemAccounts>;
  for (const k of SYSTEM_KEYS) if (!map[k]) throw new Error(`System account ${k} missing for business ${businessId}`);
  return map as SystemAccounts;
}

/** Atomic, gap-free document number per business: "RV-000001". */
export async function nextVoucherNo(tx: Tx, businessId: string, type: VoucherType, invoicePrefix?: string, book: BookKey = "GENERAL"): Promise<string> {
  // depot book: its own series (SI-, MS-, MC-, DP- …); DEPOT_DELIVERY keeps DO-
  const depot = book === "DEPOT" && DEPOT_PREFIX[type];
  const prefix = depot ? depot : type === "SALES" && invoicePrefix ? invoicePrefix : VOUCHER_TYPES[type].prefix;
  const key = depot ? `DEPOT:${type}` : type;
  const counter = await tx.counter.upsert({
    where: { businessId_key: { businessId, key } },
    create: { businessId, key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}-${String(counter.value).padStart(6, "0")}`;
}

/**
 * Period lock: once books are closed up to Business.lockDate, nothing dated on or before
 * that day may be created, edited or deleted (protects audited / filed figures).
 */
export async function assertNotLocked(tx: Tx, businessId: string, ...dates: (Date | null | undefined)[]) {
  const b = await tx.business.findUnique({ where: { id: businessId }, select: { lockDate: true } });
  if (!b?.lockDate) return;
  const lock = b.lockDate;
  if (dates.some((d) => d && d.getTime() <= lock.getTime())) {
    throw new UserError(`${formatDate(lock)} পর্যন্ত হিসাব লক (বন্ধ) করা আছে — এই সময়ের লেনদেন তৈরি, সম্পাদনা বা মুছা যাবে না`);
  }
}

/** Verifies every account belongs to the business (tenant isolation) and is active. */
export async function assertAccounts(tx: Tx, businessId: string, ids: string[], opts: { kinds?: AccountKind[]; label?: string } = {}) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map<string, { id: string; name: string; kind: AccountKind }>();
  const rows = await tx.account.findMany({ where: { id: { in: unique }, businessId }, select: { id: true, name: true, kind: true, isActive: true } });
  if (rows.length !== unique.length) throw new UserError(`${opts.label ?? "হিসাব"} পাওয়া যায়নি`);
  for (const r of rows) {
    if (opts.kinds && !opts.kinds.includes(r.kind)) throw new UserError(`"${r.name}" এই লেনদেনের জন্য উপযুক্ত হিসাব নয়`);
  }
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Database-level double-entry guarantee on MySQL / MariaDB. PostgreSQL enforces it with the deferred
 * constraint trigger "JournalEntry_voucher_balanced" at commit; MySQL has no deferred triggers, so the
 * stored entries are re-summed inside the posting transaction and any difference aborts it.
 */
export async function assertVouchersBalanced(tx: Tx, voucherIds: string[]) {
  if (!isMySql() || voucherIds.length === 0) return;
  for (let i = 0; i < voucherIds.length; i += 500) {
    const sums = await tx.journalEntry.groupBy({ by: ["voucherId"], where: { voucherId: { in: voucherIds.slice(i, i + 500) } }, _sum: { debit: true, credit: true } });
    for (const g of sums) {
      const debit = g._sum.debit ?? 0;
      const credit = g._sum.credit ?? 0;
      // amounts are DECIMAL(14,2): compare in paisa
      if (Math.round(Number(debit) * 100) !== Math.round(Number(credit) * 100)) throw new UnbalancedVoucherError(Number(debit), Number(credit));
    }
  }
}

/** Writes balanced journal entries for a voucher (replacing any existing ones). */
export async function writeEntries(tx: Tx, voucher: { id: string; businessId: string; date: Date; book?: BookKey }, lines: EntryLine[], opts: { allowEmpty?: boolean } = {}) {
  const prepared = prepareEntries(lines, opts); // throws if unbalanced
  await tx.journalEntry.deleteMany({ where: { voucherId: voucher.id } });
  // entries carry their voucher's book (GENERAL / DEPOT) — general reports filter on it
  const book = voucher.book ?? (await tx.voucher.findUniqueOrThrow({ where: { id: voucher.id }, select: { book: true } })).book;
  if (prepared.length) {
    await tx.journalEntry.createMany({
      data: prepared.map((l, i) => ({
        businessId: voucher.businessId,
        voucherId: voucher.id,
        accountId: l.accountId,
        date: voucher.date,
        debit: l.debit,
        credit: l.credit,
        narration: l.narration ?? null,
        lineNo: i,
        book,
      })),
    });
  }
  await assertVouchersBalanced(tx, [voucher.id]);
  return prepared.reduce((s, l) => s + l.debit, 0);
}

/**
 * Creates / updates / removes the OPENING voucher of a ledger.
 * signedAmount > 0 → debit balance (asset, receivable); < 0 → credit balance (payable, capital).
 */
export async function setAccountOpening(tx: Tx, ctx: Ctx, accountId: string, signedAmount: number) {
  const business = await tx.business.findUniqueOrThrow({ where: { id: ctx.businessId } });
  const acc = await systemAccounts(tx, ctx.businessId);
  const sourceKey = `opening:account:${accountId}`;
  const existing = await tx.voucher.findUnique({ where: { businessId_sourceKey: { businessId: ctx.businessId, sourceKey } } });
  const lines = openingEntries(accountId, signedAmount, acc);
  const current = existing ? await getAccountOpening(tx, ctx.businessId, accountId) : 0;
  if (Math.abs(current - signedAmount) < 0.005 && (existing || lines.length === 0)) return; // unchanged
  await assertNotLocked(tx, ctx.businessId, business.booksStartDate);
  if (lines.length === 0) {
    if (existing) await tx.voucher.delete({ where: { id: existing.id } });
    return;
  }
  const amount = Math.abs(signedAmount);
  const book = await accountBook(tx, accountId); // a depot dealer's opening due is in the depot book
  const voucher = existing
    ? await tx.voucher.update({ where: { id: existing.id }, data: { amount, book, date: business.booksStartDate, updatedById: ctx.userId } })
    : await tx.voucher.create({
        data: {
          businessId: ctx.businessId,
          type: "OPENING",
          book,
          voucherNo: await nextVoucherNo(tx, ctx.businessId, "OPENING", undefined, book),
          date: business.booksStartDate,
          narration: "প্রারম্ভিক ব্যালেন্স",
          amount,
          sourceKey,
          createdById: ctx.userId,
        },
      });
  await writeEntries(tx, voucher, lines);
}

/** The book a ledger belongs to by itself: depot dealers and depot system accounts → DEPOT. */
export async function accountBook(tx: Tx, accountId: string): Promise<BookKey> {
  const a = await tx.account.findUnique({ where: { id: accountId }, select: { systemKey: true, customer: { select: { isDepotDealer: true } } } });
  return a?.customer?.isDepotDealer || a?.systemKey?.startsWith("DEPOT_") ? "DEPOT" : "GENERAL";
}

/** Signed opening balance of a ledger (+ debit / − credit). */
export async function getAccountOpening(tx: Tx, businessId: string, accountId: string): Promise<number> {
  const v = await tx.voucher.findUnique({
    where: { businessId_sourceKey: { businessId, sourceKey: `opening:account:${accountId}` } },
    include: { entries: { where: { accountId } } },
  });
  if (!v) return 0;
  return v.entries.reduce((s, e) => s + Number(e.debit) - Number(e.credit), 0);
}

/**
 * Keeps the books apart. A GENERAL voucher may not touch a depot dealer or a depot system account
 * (commission receivable / income …); a DEPOT voucher may not touch a general (non-dealer) customer.
 * Suppliers, cash / bank and other ledgers are shared — their balance is kept per book.
 */
export async function assertBookAccounts(tx: Tx, businessId: string, book: BookKey, accountIds: (string | null | undefined)[]) {
  const ids = [...new Set(accountIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  const bad = await tx.account.findFirst({
    where: {
      businessId,
      id: { in: ids },
      OR: book === "GENERAL" ? [{ customer: { is: { isDepotDealer: true } } }, { systemKey: { startsWith: "DEPOT_" } }] : [{ customer: { is: { isDepotDealer: false } } }],
    },
    select: { name: true },
  });
  if (bad) {
    throw new UserError(
      book === "GENERAL"
        ? `"${bad.name}" ডিপোর হিসাব — সাধারণ লেনদেনে ব্যবহার করা যাবে না (ডিপো ব্যবস্থাপনা মেনু থেকে এন্ট্রি দিন)`
        : `"${bad.name}" সাধারণ কাস্টমার — ডিপোর লেনদেনে শুধু ডিপো ডিলার নির্বাচন করা যাবে`,
    );
  }
}

/** Ledgers usable in a book: GENERAL hides depot dealers and depot system accounts; DEPOT hides general customers. */
export function bookAccountWhere(book: BookKey): Prisma.AccountWhereInput {
  return book === "GENERAL"
    ? // (systemKey is nullable: NOT startsWith on NULL is NULL in SQL, so null keys are allowed explicitly)
      { AND: [{ NOT: { customer: { is: { isDepotDealer: true } } } }, { OR: [{ systemKey: null }, { NOT: { systemKey: { startsWith: "DEPOT_" } } }] }] }
    : { NOT: { customer: { is: { isDepotDealer: false } } } };
}
