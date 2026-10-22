import "server-only";
// Server-side search for the customer / supplier / product pickers. Results come back in the same
// option shapes the forms already use (PartyOption / ProductOption), so a picked item carries
// everything the form needs (balance, credit terms, prices, stock, unit).
import type { Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { toDateInput } from "@/lib/format";
import type { PartyOption, ProductOption } from "@/components/trade-parts";
import { balancesBefore } from "./services/ledger";
import { partyAging } from "./services/aging";
import { bookAccountWhere } from "./services/accounting";
import type { BookKey } from "@/lib/book";
import { commissionPerUnit } from "@/lib/depot";
import { ci, rawRows, sql } from "@/lib/dialect";

export const LOOKUP_LIMIT = 20;

/** Bangla digits → ASCII, so "০১৭১১" finds 01711… */
const asciiDigits = (s: string) => s.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)));

/** Digits of a phone-like query, without the +88 / 88 country prefix. */
function mobileDigits(q: string): string | null {
  const d = asciiDigits(q).replace(/\D/g, "");
  if (d.length < 3) return null;
  return d.startsWith("880") ? d.slice(2) : d;
}

/** Ranks exact identifiers first, then names that start with the query, then other matches. */
function rank<T>(rows: T[], q: string, fields: (r: T) => { name: string; exact: (string | null | undefined)[]; partial: (string | null | undefined)[] }) {
  const n = asciiDigits(q).toLowerCase();
  const score = (r: T) => {
    const f = fields(r);
    if (f.exact.some((x) => x && x.toLowerCase() === n)) return 0;
    if (f.name.toLowerCase().startsWith(n)) return 1;
    if (f.partial.some((x) => x && x.toLowerCase().startsWith(n))) return 2;
    if (f.name.toLowerCase().includes(n)) return 3;
    return 4;
  };
  return [...rows].sort((a, b) => score(a) - score(b) || fields(a).name.localeCompare(fields(b).name, "bn"));
}

export type PartyKind = "CUSTOMER" | "SUPPLIER";

/** ids of parties whose mobile, reduced to digits, contains `digits` */
async function mobileMatches(businessId: string, kind: PartyKind, digits: string, take: number): Promise<string[]> {
  const like = `%${digits}%`;
  const rows =
    kind === "CUSTOMER"
      ? await rawRows<{ id: string }>(prisma, sql`SELECT id FROM "Customer" WHERE "businessId" = ${businessId} AND "isActive" AND regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g') LIKE ${like} LIMIT ${take}`)
      : await rawRows<{ id: string }>(prisma, sql`SELECT id FROM "Supplier" WHERE "businessId" = ${businessId} AND "isActive" AND regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g') LIKE ${like} LIMIT ${take}`);
  return rows.map((r) => r.id);
}
export type PartyHit = PartyOption & { partyId: string; code: string | null };

/** Customers / suppliers matching name, mobile, ledger code or id (or exactly the given account ids). */
/**
 * opts.allowed: the party accounts the user may see (ctx.partyScope; null / undefined = all).
 * opts.dealer: customers = depot dealers only (depot forms); otherwise general customers only. Balances are
 * read from the matching book (dealers: DEPOT; opts.book overrides, e.g. a company in a depot form).
 */
export async function searchParties(businessId: string, kind: PartyKind, q: string, opts: { accountIds?: string[]; take?: number; allowed?: string[] | null; dealer?: boolean; book?: BookKey } = {}): Promise<PartyHit[]> {
  const book: BookKey = opts.book ?? (opts.dealer ? "DEPOT" : "GENERAL");
  const query = q.trim().slice(0, 100);
  const digits = mobileDigits(query);
  const take = opts.take ?? LOOKUP_LIMIT;
  // mobiles may be stored formatted ("01711-000001", "+880 1711…"): compare digits only
  const byMobile = digits && !opts.accountIds ? await mobileMatches(businessId, kind, digits.replace(/^0/, ""), take * 3) : [];
  const scoped = {
    ...(opts.allowed ? { AND: [{ accountId: { in: opts.allowed } }] } : {}),
    ...(kind === "CUSTOMER" ? { isDepotDealer: !!opts.dealer } : {}),
  };
  const where: Prisma.CustomerWhereInput & Prisma.SupplierWhereInput = opts.accountIds
    ? { businessId, accountId: { in: opts.accountIds }, ...scoped }
    : {
        ...scoped,
        businessId,
        isActive: true,
        ...(query
          ? {
              OR: [
                { name: ci(query) },
                { id: query },
                { accountId: query },
                { account: { code: ci(asciiDigits(query)) } },
                ...(byMobile.length ? [{ id: { in: byMobile } }] : []),
              ],
            }
          : {}),
      };
  const select = { id: true, name: true, mobile: true, accountId: true, creditDays: true, account: { select: { code: true, group: { select: { name: true } } } } } as const;
  const rows = (kind === "CUSTOMER"
    ? await prisma.customer.findMany({ where, select: { ...select, creditLimit: true }, orderBy: { name: "asc" }, take: opts.accountIds ? undefined : take * 3 })
    : await prisma.supplier.findMany({ where, select, orderBy: { name: "asc" }, take: opts.accountIds ? undefined : take * 3 })) as {
    id: string; name: string; mobile: string | null; accountId: string; creditDays: number; creditLimit?: unknown; account: { code: string | null; group: { name: string } };
  }[];
  const top = (query ? rank(rows, query, (r) => ({ name: r.name, exact: [r.account.code, r.mobile?.replace(/\D/g, ""), r.id, r.accountId], partial: [r.mobile?.replace(/\D/g, ""), r.account.code] })) : rows).slice(0, opts.accountIds ? undefined : take);
  if (top.length === 0) return [];
  const ids = top.map((r) => r.accountId);
  const [bal, aging] = await Promise.all([
    balancesBefore(businessId, undefined, ids, book),
    partyAging(businessId, kind, new Date(`${toDateInput()}T00:00:00.000Z`), ids, book),
  ]);
  const overdue = new Map(aging.map((a) => [a.accountId, a.overdue]));
  return top.map((r) => ({
    id: r.accountId,
    partyId: r.id,
    name: r.name,
    code: r.account.code,
    group: r.account.group.name,
    balance: bal.get(r.accountId) ?? 0,
    mobile: r.mobile,
    creditLimit: r.creditLimit !== undefined ? num(r.creditLimit as never) : 0,
    creditDays: r.creditDays,
    overdue: overdue.get(r.accountId) ?? 0,
  }));
}

export function toProductOption(p: { id: string; name: string; code: string | null; barcode: string | null; unitId: string; trackBatch: boolean; salePrice: unknown; wholesalePrice: unknown; purchasePrice: unknown; avgCost: unknown; stock: unknown; depotCommissionRate?: unknown; depotCommissionType?: string | null }): ProductOption {
  return {
    id: p.id, name: p.name, code: p.code, barcode: p.barcode, unitId: p.unitId, trackBatch: p.trackBatch,
    salePrice: num(p.salePrice as never), wholesalePrice: num(p.wholesalePrice as never), purchasePrice: num(p.purchasePrice as never), avgCost: num(p.avgCost as never), stock: num(p.stock as never),
    // the challan's default commission: taka per base unit (a PERCENT product: its % of the DP)
    ...(p.depotCommissionRate !== undefined
      ? { depotCommissionRate: commissionPerUnit({ depotCommissionType: p.depotCommissionType, depotCommissionRate: num(p.depotCommissionRate as never), purchasePrice: num(p.purchasePrice as never) }) }
      : {}),
  };
}

/** Products matching name, code / SKU, barcode or id (or exactly the given ids). */
/** book: DEPOT = the depot (dealership) products only, GENERAL (default) = never them; ids: exactly those products. */
export async function searchProducts(businessId: string, q: string, opts: { ids?: string[]; take?: number; batchOnly?: boolean; book?: BookKey } = {}): Promise<ProductOption[]> {
  const query = q.trim().slice(0, 100);
  const code = asciiDigits(query);
  const take = opts.take ?? LOOKUP_LIMIT;
  const where: Prisma.ProductWhereInput = opts.ids
    ? { businessId, id: { in: opts.ids } }
    : {
        businessId,
        isActive: true,
        isDepotProduct: opts.book === "DEPOT",
        ...(opts.batchOnly ? { trackBatch: true } : {}),
        ...(query
          ? { OR: [{ name: ci(query) }, { code: ci(code) }, { barcode: { contains: code } }, { id: query }] }
          : {}),
      };
  const rows = await prisma.product.findMany({ where, orderBy: { name: "asc" }, take: opts.ids ? undefined : take * 3 });
  const ranked = query ? rank(rows, query, (r) => ({ name: r.name, exact: [r.code, r.barcode, r.id], partial: [r.code, r.barcode] })) : rows;
  return ranked.slice(0, opts.ids ? undefined : take).map(toProductOption);
}

// ───────────────────────── ledger accounts (SearchableAccountSelect) ─────────────────────────

/** Which accounts a picker offers. */
export type AccountScope = "all" | "cash" | "cash-in-hand" | "bank" | "expense" | "heads";
export const ACCOUNT_SCOPES: AccountScope[] = ["all", "cash", "cash-in-hand", "bank", "expense", "heads"];
const SCOPE_WHERE: Record<AccountScope, Prisma.AccountWhereInput> = {
  all: {},
  cash: { kind: { in: ["CASH", "BANK"] } }, // cash, bank and mobile banking
  "cash-in-hand": { kind: "CASH" },
  bank: { kind: "BANK" },
  expense: { nature: "EXPENSE", group: { isDirect: false }, isSystem: false },
  // general account heads (no customer / supplier ledgers) — the user form's "নির্ধারিত হিসাব খাতসমূহ"
  heads: { customer: { is: null }, supplier: { is: null } },
};
/** Groups a new account may be created in from a picker of this scope (customer/supplier ledgers come from their own pages). */
export const SCOPE_GROUPS: Record<AccountScope, Prisma.AccountGroupWhereInput> = {
  all: { NOT: { systemKey: { in: ["SUNDRY_DEBTORS", "SUNDRY_CREDITORS"] } } },
  cash: { systemKey: { in: ["CASH_IN_HAND", "BANK_ACCOUNTS"] } },
  "cash-in-hand": { systemKey: "CASH_IN_HAND" },
  bank: { systemKey: "BANK_ACCOUNTS" },
  expense: { nature: "EXPENSE", isDirect: false },
  heads: { NOT: { systemKey: { in: ["SUNDRY_DEBTORS", "SUNDRY_CREDITORS"] } } },
};

export interface AccountHit {
  id: string;
  name: string;
  group: string;
  code: string | null;
  kind: string;
  /** bank / account number, or the customer / supplier mobile */
  detail: string | null;
  balance: number;
}

// English ↔ Bangla words used in account names, so "cash", "bkash", "rent" find Bangla-named ledgers and back.
const ALIASES: [string, string[]][] = [
  ["cash", ["ক্যাশ", "নগদ"]], ["bank", ["ব্যাংক"]], ["bkash", ["বিকাশ"]], ["nagad", ["নগদ"]], ["rocket", ["রকেট"]], ["upay", ["উপায়"]],
  ["mobile", ["মোবাইল"]], ["sales", ["বিক্রয়", "বিক্রি"]], ["purchase", ["ক্রয়"]], ["rent", ["ভাড়া"]], ["salary", ["বেতন"]],
  ["wage", ["মজুরি"]], ["electricity", ["বিদ্যুৎ"]], ["utility", ["বিল", "বিদ্যুৎ"]], ["water", ["পানি"]], ["gas", ["গ্যাস"]],
  ["expense", ["খরচ", "ব্যয়"]], ["cost", ["খরচ", "ব্যয়"]], ["income", ["আয়"]], ["capital", ["মূলধন"]], ["drawing", ["উত্তোলন"]],
  ["discount", ["ছাড়", "ডিসকাউন্ট"]], ["vat", ["ভ্যাট"]], ["tax", ["কর"]], ["transport", ["পরিবহন"]], ["loan", ["ঋণ"]],
  ["advance", ["অগ্রিম"]], ["stock", ["মজুদ", "স্টক"]], ["inventory", ["মজুদ"]], ["furniture", ["আসবাব"]], ["commission", ["কমিশন"]],
  ["service", ["সেবা"]], ["office", ["অফিস"]], ["entertainment", ["আপ্যায়ন"]], ["interest", ["সুদ"]], ["customer", ["কাস্টমার", "গ্রাহক"]],
  ["supplier", ["সরবরাহকারী"]], ["return", ["ফেরত"]], ["loss", ["ক্ষতি"]], ["profit", ["লাভ", "মুনাফা"]],
];
function aliasTerms(q: string): string[] {
  const n = q.toLowerCase();
  if (n.length < 2) return [];
  const out = new Set<string>();
  for (const [en, bn] of ALIASES) {
    if (en.startsWith(n) || (n.length >= 4 && n.startsWith(en))) bn.forEach((b) => out.add(b));
    if (bn.some((b) => b.startsWith(q))) out.add(en);
  }
  return [...out];
}

/**
 * Ledger accounts of a business matching name (Bangla or English), code, bank account number / bank name,
 * the linked customer / supplier name or mobile, or id — or exactly the given ids (any status, for labels).
 * Without a query the scope is listed page by page in chart-of-accounts order.
 */
export async function searchAccounts(
  businessId: string,
  q: string,
  /** where: extra account filter (accountScopeWhere — parties outside a restricted user's list) */
  opts: { scope?: AccountScope; ids?: string[]; take?: number; offset?: number; where?: Prisma.AccountWhereInput; book?: BookKey } = {},
): Promise<{ items: AccountHit[]; hasMore: boolean }> {
  const book: BookKey = opts.book ?? "GENERAL";
  // each book offers its own ledgers (no depot dealer in a general voucher, no general customer in a depot one)
  opts = { ...opts, where: { AND: [bookAccountWhere(book), ...(opts.where ? [opts.where] : [])] } };
  const query = q.trim().slice(0, 100);
  const take = Math.min(opts.take ?? 30, 50);
  const offset = Math.max(0, opts.offset ?? 0);
  const include = { group: { select: { name: true, sortOrder: true } }, customer: { select: { mobile: true } }, supplier: { select: { mobile: true } } } as const;
  let rows: Prisma.AccountGetPayload<{ include: typeof include }>[];
  let hasMore = false;
  if (opts.ids) {
    rows = await prisma.account.findMany({ where: { businessId, id: { in: opts.ids }, ...(opts.where ? { AND: [opts.where] } : {}) }, include });
  } else {
    const base: Prisma.AccountWhereInput = { businessId, isActive: true, ...SCOPE_WHERE[opts.scope ?? "all"], ...(opts.where ? { AND: [opts.where] } : {}) };
    if (!query) {
      rows = await prisma.account.findMany({ where: base, include, orderBy: [{ group: { sortOrder: "asc" } }, { name: "asc" }], skip: offset, take: take + 1 });
      hasMore = rows.length > take;
      rows = rows.slice(0, take);
    } else {
      const ascii = asciiDigits(query);
      const digits = mobileDigits(query);
      const [custIds, supIds] = digits && (opts.scope ?? "all") === "all"
        ? await Promise.all([mobileMatches(businessId, "CUSTOMER", digits.replace(/^0/, ""), 100), mobileMatches(businessId, "SUPPLIER", digits.replace(/^0/, ""), 100)])
        : [[], []];
      const names = [query, ...aliasTerms(query)];
      const where: Prisma.AccountWhereInput = {
        AND: [
          base,
          {
            OR: [
              ...names.map((t) => ({ name: ci(t) })),
              { code: ci(ascii) },
              { accountNumber: ci(ascii) },
              { bankName: ci(query) },
              { systemKey: { contains: query.toUpperCase().replace(/\s+/g, "_") } },
              { id: query },
              { customer: { name: ci(query) } },
              { supplier: { name: ci(query) } },
              ...(custIds.length ? [{ customer: { id: { in: custIds } } }] : []),
              ...(supIds.length ? [{ supplier: { id: { in: supIds } } }] : []),
            ],
          },
        ],
      };
      const found = await prisma.account.findMany({ where, include, orderBy: [{ group: { sortOrder: "asc" } }, { name: "asc" }], take: 300 });
      const ranked = rank(found, query, (r) => ({ name: r.name, exact: [r.code, r.accountNumber, r.systemKey, r.id], partial: [r.code, r.accountNumber] }));
      rows = ranked.slice(offset, offset + take);
      hasMore = ranked.length > offset + take;
    }
  }
  if (rows.length === 0) return { items: [], hasMore: false };
  const bal = await balancesBefore(businessId, undefined, rows.map((r) => r.id), book);
  return {
    hasMore,
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      group: r.group.name,
      code: r.code,
      kind: r.kind,
      detail: [r.bankName, r.accountNumber].filter(Boolean).join(" · ") || r.customer?.mobile || r.supplier?.mobile || null,
      balance: bal.get(r.id) ?? 0,
    })),
  };
}

// ───────────────────────── employees (payroll pickers) ─────────────────────────

export interface EmployeeHit {
  id: string;
  name: string;
  code: string;
  mobile: string | null;
  designation: string | null;
  department: string | null;
  status: string;
}

/** Employees matching name, employee ID, mobile (digits) or NID — or exactly the given ids. */
export async function searchEmployees(businessId: string, q: string, opts: { ids?: string[]; take?: number; activeOnly?: boolean } = {}): Promise<EmployeeHit[]> {
  const query = q.trim().slice(0, 100);
  const take = opts.take ?? LOOKUP_LIMIT;
  const digits = asciiDigits(query).replace(/\D/g, "");
  const where: Prisma.EmployeeWhereInput = opts.ids
    ? { businessId, id: { in: opts.ids } }
    : {
        businessId,
        ...(opts.activeOnly ? { status: { in: ["ACTIVE", "PROBATION", "ON_LEAVE"] } } : {}),
        ...(query
          ? {
              OR: [
                { name: ci(query) },
                { code: ci(asciiDigits(query)) },
                { designation: ci(query) },
                { id: query },
                ...(digits.length >= 3 ? [{ mobile: { contains: digits.startsWith("880") ? digits.slice(2) : digits } }, { nid: { contains: digits } }] : []),
              ],
            }
          : {}),
      };
  const rows = await prisma.employee.findMany({ where, include: { department: { select: { name: true } } }, orderBy: [{ code: "asc" }], take: opts.ids ? undefined : take * 3 });
  const ranked = query ? rank(rows, query, (r) => ({ name: r.name, exact: [r.code, r.mobile, r.nid, r.id], partial: [r.code, r.mobile] })) : rows;
  return ranked.slice(0, opts.ids ? undefined : take).map((r) => ({ id: r.id, name: r.name, code: r.code, mobile: r.mobile, designation: r.designation, department: r.department?.name ?? null, status: r.status }));
}
