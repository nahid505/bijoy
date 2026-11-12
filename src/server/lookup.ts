import "server-only";
// Server-side search for the customer / supplier / product pickers. Results come back in the same
// option shapes the forms already use (PartyOption / ProductOption), so a picked item carries
// everything the form needs (balance, credit terms, prices, stock, unit).
import type { Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { toDateInput } from "@/lib/format";
import type { PartyOption, PartyType, ProductOption } from "@/components/trade-parts";
import { balancesBefore } from "./services/ledger";
import { partyAging } from "./services/aging";
import { bookAccountWhere } from "./services/accounting";
import type { BookKey } from "@/lib/book";
import { commissionPerUnit, dealerLabel } from "@/lib/depot";
import { digitVariants, toAsciiDigits } from "@/lib/digits";
import { ci, rawRows, sql } from "@/lib/dialect";

export const LOOKUP_LIMIT = 20;

/** Bangla digits → ASCII, so "০১৭১১" finds 01711… */
const asciiDigits = toAsciiDigits;

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

export type PartyKind = "CUSTOMER" | "SUPPLIER" | "ALL";

/** ids of parties whose mobile, reduced to digits, contains `digits` */
async function mobileMatches(businessId: string, kind: "CUSTOMER" | "SUPPLIER", digits: string, take: number): Promise<string[]> {
  const like = `%${digits}%`;
  const rows =
    kind === "CUSTOMER"
      ? await rawRows<{ id: string }>(prisma, sql`SELECT id FROM "Customer" WHERE "businessId" = ${businessId} AND "isActive" AND regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g') LIKE ${like} LIMIT ${take}`)
      : await rawRows<{ id: string }>(prisma, sql`SELECT id FROM "Supplier" WHERE "businessId" = ${businessId} AND "isActive" AND regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g') LIKE ${like} LIMIT ${take}`);
  return rows.map((r) => r.id);
}
export type PartyHit = PartyOption & { partyId: string; code: string | null };

// English ↔ Bangla words used in account names, so "cash", "bkash", "rent" find Bangla-named ledgers and back.
const ALIASES: [string, string[]][] = [
  ["cash", ["ক্যাশ", "নগদ"]], ["bank", ["ব্যাংক"]], ["bkash", ["বিকাশ"]], ["nagad", ["নগদ"]], ["rocket", ["রকেট"]], ["upay", ["উপায়"]],
  ["mobile", ["মোবাইল"]], ["sales", ["বিক্রয়", "বিক্রি"]], ["purchase", ["ক্রয়"]], ["rent", ["ভাড়া"]], ["salary", ["বেতন"]],
  ["wage", ["মজুরি"]], ["electricity", ["বিদ্যুৎ"]], ["utility", ["বিল", "বিদ্যুৎ"]], ["water", ["পানি"]], ["gas", ["গ্যাস"]],
  ["expense", ["খরচ", "ব্যয়"]], ["cost", ["খরচ", "ব্যয়"]], ["income", ["আয়"]], ["capital", ["মূলধন"]], ["drawing", ["উত্তোলন"]],
  ["owner", ["মালিক", "স্বত্বাধিকারী"]], ["partner", ["পার্টনার", "অংশীদার"]], ["proprietor", ["স্বত্বাধিকারী", "মালিক"]],
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
 * Picks up to `take` initial rows when the search box is empty, prioritizing `preferredKind` while
 * keeping Owner equity accounts and opposite-role parties immediately reachable without typing.
 */
function pickInitialPartySlice<T extends { hasCustomer: boolean; hasSupplier: boolean; hasOwner: boolean }>(
  allRows: T[],
  take: number,
  preferredKind?: "CUSTOMER" | "SUPPLIER",
): T[] {
  const owners = allRows.filter((r) => r.hasOwner && !r.hasCustomer && !r.hasSupplier);
  const suppliers = allRows.filter((r) => r.hasSupplier);
  const customers = allRows.filter((r) => r.hasCustomer && !r.hasSupplier);

  const ordered =
    preferredKind === "SUPPLIER"
      ? { primary: suppliers, owners, secondary: customers }
      : preferredKind === "CUSTOMER"
        ? { primary: customers, owners, secondary: suppliers }
        : null;

  if (!ordered) return allRows.slice(0, take);
  const full = [...ordered.primary, ...ordered.owners, ...ordered.secondary];
  if (full.length <= take) return full;

  const ownerKeep = ordered.owners.slice(0, Math.min(ordered.owners.length, 4));
  const secondaryReserve = ordered.secondary.length ? Math.min(ordered.secondary.length, 4) : 0;
  const primaryBudget = Math.max(0, take - ownerKeep.length - secondaryReserve);
  const primaryPick = ordered.primary.slice(0, primaryBudget);
  const remaining = Math.max(0, take - primaryPick.length - ownerKeep.length);
  const secondaryPick = ordered.secondary.slice(0, remaining);
  return [...primaryPick, ...ownerKeep, ...secondaryPick].slice(0, take);
}

/** Customers / suppliers (and Owner equity ledgers for ALL / includeAll) matching name, mobile, ledger code or id. */
/**
 * opts.allowed: the party accounts the user may see (ctx.partyScope; null / undefined = all).
 * opts.dealer: customers = depot dealers only (depot forms); otherwise general customers only. Balances are
 * read from the matching book (dealers: DEPOT; opts.book overrides, e.g. a company in a depot form).
 */
export async function searchParties(
  businessId: string,
  kind: PartyKind,
  q: string,
  opts: {
    accountIds?: string[];
    take?: number;
    allowed?: string[] | null;
    customerAllowed?: string[] | null;
    supplierAllowed?: string[] | null;
    ownerScopeWhere?: Prisma.AccountWhereInput;
    dealer?: boolean;
    book?: BookKey;
    includeAll?: boolean;
    preferredKind?: "CUSTOMER" | "SUPPLIER";
  } = {}
): Promise<PartyHit[]> {
  const book: BookKey = opts.book ?? (opts.dealer ? "DEPOT" : "GENERAL");
  const query = q.trim().slice(0, 100);
  const digits = mobileDigits(query);
  const take = opts.take ?? LOOKUP_LIMIT;

  const searchAll = kind === "ALL" || Boolean(opts.includeAll);
  const searchCust = kind === "CUSTOMER" || searchAll;
  const searchSupp = kind === "SUPPLIER" || searchAll;
  const searchOwner = searchAll && !opts.dealer && book !== "DEPOT";

  const [custByMobile, suppByMobile, ownerMobMatches] =
    digits && !opts.accountIds
      ? await Promise.all([
          searchCust ? mobileMatches(businessId, "CUSTOMER", digits.replace(/^0/, ""), take * 3) : Promise.resolve([]),
          searchSupp ? mobileMatches(businessId, "SUPPLIER", digits.replace(/^0/, ""), take * 3) : Promise.resolve([]),
          searchOwner
            ? (async () => {
                const cleanDigits = digits.replace(/^0/, "");
                const biz = await prisma.business.findUnique({
                  where: { id: businessId },
                  select: {
                    mobile: true,
                    memberships: { where: { isActive: true, role: { isSystem: true } }, select: { user: { select: { mobile: true } } } },
                  },
                });
                const ownerMobs = [biz?.mobile, ...(biz?.memberships.map((m) => m.user.mobile) ?? [])]
                  .filter((x): x is string => Boolean(x))
                  .map((m) => asciiDigits(m).replace(/\D/g, "").replace(/^880/, "0").replace(/^0/, ""));
                return ownerMobs.some((m) => m.includes(cleanDigits));
              })()
            : Promise.resolve(false),
        ])
      : [[], [], false];

  const custAllowed = opts.customerAllowed !== undefined ? opts.customerAllowed : opts.allowed;
  const suppAllowed = opts.supplierAllowed !== undefined ? opts.supplierAllowed : opts.allowed;

  const custScoped = {
    ...(custAllowed ? { AND: [{ accountId: { in: custAllowed } }] } : {}),
    ...(opts.dealer ? { isDepotDealer: true } : { isDepotDealer: false }),
  };
  const suppScoped = {
    ...(suppAllowed ? { AND: [{ accountId: { in: suppAllowed } }] } : {}),
  };

  const custWhere: Prisma.CustomerWhereInput = opts.accountIds
    ? { businessId, accountId: { in: opts.accountIds }, ...custScoped }
    : {
        ...custScoped,
        businessId,
        isActive: true,
        ...(query
          ? {
              OR: [
                ...digitVariants(query).map((v) => ({ name: ci(v) })),
                ...(opts.dealer ? digitVariants(query).map((v) => ({ ownerName: ci(v) })) : []),
                { id: query },
                { accountId: query },
                { account: { code: ci(asciiDigits(query)) } },
                ...(custByMobile.length ? [{ id: { in: custByMobile } }] : []),
              ],
            }
          : {}),
      };

  const suppWhere: Prisma.SupplierWhereInput = opts.accountIds
    ? { businessId, accountId: { in: opts.accountIds }, ...suppScoped }
    : {
        ...suppScoped,
        businessId,
        isActive: true,
        ...(query
          ? {
              OR: [
                ...digitVariants(query).map((v) => ({ name: ci(v) })),
                { id: query },
                { accountId: query },
                { account: { code: ci(asciiDigits(query)) } },
                ...(suppByMobile.length ? [{ id: { in: suppByMobile } }] : []),
              ],
            }
          : {}),
      };

  const ownerNames = query ? [query, ...aliasTerms(query)] : [];
  const ownerWhere: Prisma.AccountWhereInput = {
    businessId,
    nature: "EQUITY",
    customer: { is: null },
    supplier: { is: null },
    AND: [
      bookAccountWhere(book),
      { OR: [{ systemKey: null }, { systemKey: { notIn: ["OPENING_EQUITY"] } }] },
      ...(opts.ownerScopeWhere ? [opts.ownerScopeWhere] : []),
    ],
    ...(opts.accountIds
      ? { id: { in: opts.accountIds } }
      : {
          isActive: true,
          ...(query && !ownerMobMatches
            ? {
                OR: [
                  ...ownerNames.flatMap(digitVariants).map((v) => ({ name: ci(v) })),
                  { code: ci(asciiDigits(query)) },
                  { accountNumber: ci(asciiDigits(query)) },
                  { id: query },
                  { systemKey: { contains: query.toUpperCase().replace(/\s+/g, "_") } },
                  ...digitVariants(query).flatMap((v) => [{ group: { name: ci(v) } }, { description: ci(v) }]),
                ],
              }
            : {}),
        }),
  };

  const [custRows, suppRows, ownerRows] = await Promise.all([
    searchCust
      ? prisma.customer.findMany({
          where: custWhere,
          select: {
            id: true,
            name: true,
            mobile: true,
            address: true,
            accountId: true,
            creditDays: true,
            creditLimit: true,
            ownerName: true,
            account: {
              select: {
                code: true,
                group: { select: { name: true } },
                supplier: { select: { id: true, name: true, mobile: true, address: true, creditDays: true } },
              },
            },
          },
          orderBy: { name: "asc" },
          take: opts.accountIds ? undefined : take * 3,
        })
      : Promise.resolve([]),
    searchSupp
      ? prisma.supplier.findMany({
          where: suppWhere,
          select: {
            id: true,
            name: true,
            mobile: true,
            address: true,
            accountId: true,
            creditDays: true,
            account: {
              select: {
                code: true,
                group: { select: { name: true } },
                customer: { select: { id: true, name: true, mobile: true, address: true, creditDays: true, creditLimit: true, ownerName: true } },
              },
            },
          },
          orderBy: { name: "asc" },
          take: opts.accountIds ? undefined : take * 3,
        })
      : Promise.resolve([]),
    searchOwner
      ? prisma.account.findMany({
          where: ownerWhere,
          select: {
            id: true,
            name: true,
            code: true,
            accountNumber: true,
            systemKey: true,
            group: { select: { name: true } },
          },
          orderBy: { name: "asc" },
          take: opts.accountIds ? undefined : take * 2,
        })
      : Promise.resolve([]),
  ]);

  type MergedItem = {
    id: string; // party id (or account id for owner)
    name: string;
    ownerName?: string | null;
    mobile: string | null;
    address?: string | null;
    accountId: string;
    creditDays: number;
    creditLimit: number;
    account: { code: string | null; group: { name: string }; systemKey?: string | null };
    hasCustomer: boolean;
    hasSupplier: boolean;
    hasOwner: boolean;
  };

  const merged = new Map<string, MergedItem>();

  for (const c of custRows) {
    merged.set(c.accountId, {
      id: c.id,
      name: c.name,
      ownerName: c.ownerName,
      mobile: c.mobile,
      address: c.address,
      accountId: c.accountId,
      creditDays: c.creditDays,
      creditLimit: num(c.creditLimit),
      account: c.account,
      hasCustomer: true,
      hasSupplier: Boolean(c.account.supplier),
      hasOwner: false,
    });
  }

  for (const s of suppRows) {
    const existing = merged.get(s.accountId);
    if (existing) {
      existing.hasSupplier = true;
      if (!existing.mobile && s.mobile) existing.mobile = s.mobile;
      if (!existing.address && s.address) existing.address = s.address;
    } else {
      merged.set(s.accountId, {
        id: s.id,
        name: s.name,
        ownerName: s.account.customer?.ownerName ?? null,
        mobile: s.mobile,
        address: s.address,
        accountId: s.accountId,
        creditDays: s.creditDays,
        creditLimit: s.account.customer?.creditLimit ? num(s.account.customer.creditLimit) : 0,
        account: s.account,
        hasCustomer: Boolean(s.account.customer),
        hasSupplier: true,
        hasOwner: false,
      });
    }
  }

  for (const o of ownerRows) {
    if (!merged.has(o.id)) {
      merged.set(o.id, {
        id: o.id,
        name: o.name,
        ownerName: null,
        mobile: o.accountNumber ?? null,
        address: null,
        accountId: o.id,
        creditDays: 0,
        creditLimit: 0,
        account: { code: o.code, group: o.group, systemKey: o.systemKey },
        hasCustomer: false,
        hasSupplier: false,
        hasOwner: true,
      });
    }
  }

  const allRows = Array.from(merged.values());
  const top = opts.accountIds
    ? allRows
    : query
      ? rank(allRows, query, (r) => ({
          name: r.name,
          exact: [r.account.code, r.account.systemKey, r.mobile?.replace(/\D/g, ""), r.id, r.accountId],
          partial: [r.mobile?.replace(/\D/g, ""), r.account.code, r.ownerName],
        })).slice(0, take)
      : pickInitialPartySlice(allRows, take, opts.preferredKind);

  if (top.length === 0) return [];
  const ids = top.map((r) => r.accountId);

  const today = new Date(`${toDateInput()}T00:00:00.000Z`);
  const [bal, custAging, suppAging, voucherTypes] = await Promise.all([
    balancesBefore(businessId, undefined, ids, book),
    searchCust ? partyAging(businessId, "CUSTOMER", today, ids, book) : Promise.resolve([]),
    searchSupp ? partyAging(businessId, "SUPPLIER", today, ids, book) : Promise.resolve([]),
    prisma.voucher.findMany({
      where: {
        businessId,
        partyAccountId: { in: ids },
        type: { in: ["SALES", "SALES_RETURN", "PURCHASE", "PURCHASE_RETURN"] },
      },
      select: { partyAccountId: true, type: true },
      distinct: ["partyAccountId", "type"],
    }),
  ]);

  const overdue = new Map<string, number>();
  for (const a of [...custAging, ...suppAging]) {
    if (a.overdue > 0) overdue.set(a.accountId, Math.max(overdue.get(a.accountId) ?? 0, a.overdue));
  }

  const salesAccounts = new Set(voucherTypes.filter((v) => v.partyAccountId && (v.type === "SALES" || v.type === "SALES_RETURN")).map((v) => v.partyAccountId!));
  const purchaseAccounts = new Set(voucherTypes.filter((v) => v.partyAccountId && (v.type === "PURCHASE" || v.type === "PURCHASE_RETURN")).map((v) => v.partyAccountId!));

  return top.map((r) => {
    const hasSales = salesAccounts.has(r.accountId);
    const hasPurchases = purchaseAccounts.has(r.accountId);
    const isOwnerOnly = r.hasOwner && !r.hasCustomer && !r.hasSupplier;
    const isBoth =
      !isOwnerOnly && (
        (r.hasCustomer && r.hasSupplier) ||
        (hasSales && hasPurchases) ||
        (r.hasCustomer && hasPurchases) ||
        (r.hasSupplier && hasSales)
      );

    const partyType: PartyType = isOwnerOnly
      ? "OWNER"
      : isBoth
        ? "BOTH"
        : r.hasCustomer
          ? "CUSTOMER"
          : r.hasSupplier
            ? "SUPPLIER"
            : "OWNER";

    return {
      id: r.accountId,
      partyId: r.id,
      name: dealerLabel(r.name, r.ownerName),
      code: r.account.code,
      group: r.account.group.name,
      balance: bal.get(r.accountId) ?? 0,
      mobile: r.mobile,
      address: r.address ?? null,
      creditLimit: r.creditLimit,
      creditDays: r.creditDays,
      overdue: overdue.get(r.accountId) ?? 0,
      partyType,
    };
  });
}

export function toProductOption(p: { id: string; name: string; code: string | null; barcode: string | null; unitId: string; trackBatch: boolean; salePrice: unknown; wholesalePrice: unknown; purchasePrice: unknown; avgCost: unknown; stock: unknown; depotCommissionRate?: unknown; depotCommissionType?: string | null; packSize?: unknown }): ProductOption {
  return {
    id: p.id, name: p.name, code: p.code, barcode: p.barcode, unitId: p.unitId, trackBatch: p.trackBatch,
    salePrice: num(p.salePrice as never), wholesalePrice: num(p.wholesalePrice as never), purchasePrice: num(p.purchasePrice as never), avgCost: num(p.avgCost as never), stock: num(p.stock as never),
    packSize: p.packSize !== undefined ? num(p.packSize as never) || 24 : 24,
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
          ? { OR: [...digitVariants(query).map((v) => ({ name: ci(v) })), { code: ci(code) }, { barcode: { contains: code } }, { id: query }] }
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
              ...names.flatMap(digitVariants).map((t) => ({ name: ci(t) })),
              { code: ci(ascii) },
              { accountNumber: ci(ascii) },
              { bankName: ci(query) },
              { systemKey: { contains: query.toUpperCase().replace(/\s+/g, "_") } },
              { id: query },
              ...digitVariants(query).flatMap((v) => [{ customer: { name: ci(v) } }, { supplier: { name: ci(v) } }]),
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
