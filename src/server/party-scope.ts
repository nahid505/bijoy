import "server-only";
// Row-level party and account-head restriction ("শুধু নির্ধারিত কাস্টমার / সরবরাহকারী / হিসাব খাত").
//
// A member whose role holds "customers:assigned_only" (or "suppliers:assigned_only") — ticked explicitly,
// never through "*" or the Owner role — sees only the customers (suppliers) assigned to them in
// UserCustomer / UserSupplier. ctx.partyScope carries the allowed party ACCOUNT ids (null = unrestricted).
// Every party-bearing query goes through the helpers here:
//   parties      partyListWhere          customer / supplier lists, pickers
//   vouchers     voucherScopeWhere       a voucher touching a party you may not see is hidden, and so
//                                        is a walk-in (no party) trade voucher someone else entered
//   ledgers      accountScopeWhere / canSeeAccount   party ledger accounts in ledgers and account lists
//   saving       assertPartiesAllowed    no voucher for a party outside your list
// Reports state how they treat it (ReportDef.partyScope); unmarked reports are refused to restricted users.
//
// Account heads ("accounts:assigned_only", UserAccount): the general ledgers (cash, bank, income, expense … —
// not customer / supplier ledgers, which follow the party restriction) a member may see. Ledger lists, pickers
// and ledger pages show only the assigned heads; a voucher is visible when it touches at least one of them; a
// voucher using an unassigned head cannot be saved.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { strList } from "@/lib/dialect";
import { UserError } from "@/lib/errors";
type PartyKind = "CUSTOMER" | "SUPPLIER";

export interface PartyScope {
  /** allowed customer ledger-account ids; null = every customer */
  customers: string[] | null;
  /** allowed supplier ledger-account ids; null = every supplier */
  suppliers: string[] | null;
  /** allowed general (non-party) ledger ids; null / absent = every head */
  accounts?: string[] | null;
}

export const UNRESTRICTED: PartyScope = { customers: null, suppliers: null, accounts: null };

interface ScopeCtx {
  partyScope: PartyScope;
  user: { id: string };
  business: { id: string };
}

/** Restriction keys only count when the role names them (an Owner / "*" role is never restricted). */
export function restrictionsOf(rolePermissions: unknown, isOwner: boolean) {
  const keys = strList(rolePermissions);
  if (isOwner || keys.includes("*")) return { customers: false, suppliers: false, accounts: false };
  return { customers: keys.includes("customers:assigned_only"), suppliers: keys.includes("suppliers:assigned_only"), accounts: keys.includes("accounts:assigned_only") };
}

/** Loads the allowed party accounts for a member (used by getContext). */
export async function loadPartyScope(businessId: string, userId: string, r: { customers: boolean; suppliers: boolean; accounts?: boolean }): Promise<PartyScope> {
  if (!r.customers && !r.suppliers && !r.accounts) return UNRESTRICTED;
  const [c, s, a] = await Promise.all([
    r.customers ? prisma.userCustomer.findMany({ where: { businessId, userId }, select: { customer: { select: { accountId: true } } } }) : null,
    r.suppliers ? prisma.userSupplier.findMany({ where: { businessId, userId }, select: { supplier: { select: { accountId: true } } } }) : null,
    r.accounts ? prisma.userAccount.findMany({ where: { businessId, userId }, select: { accountId: true } }) : null,
  ]);
  return { customers: c ? c.map((x) => x.customer.accountId) : null, suppliers: s ? s.map((x) => x.supplier.accountId) : null, accounts: a ? a.map((x) => x.accountId) : null };
}

/** the assigned account heads (null = every head) */
export const allowedAccounts = (ctx: ScopeCtx) => ctx.partyScope.accounts ?? null;
const partyRestricted = (ctx: ScopeCtx) => ctx.partyScope.customers !== null || ctx.partyScope.suppliers !== null;
export const isRestricted = (ctx: ScopeCtx) => partyRestricted(ctx) || allowedAccounts(ctx) !== null;
const allowedOf = (ctx: ScopeCtx, kind: PartyKind) => (kind === "CUSTOMER" ? ctx.partyScope.customers : ctx.partyScope.suppliers);

/** Customer / supplier rows this user may see. */
export function partyListWhere(ctx: ScopeCtx, kind: PartyKind): { accountId?: { in: string[] } } {
  const allowed = allowedOf(ctx, kind);
  return allowed ? { accountId: { in: allowed } } : {};
}

/** Party ledgers this user may not open: customer / supplier accounts outside the allowed lists. */
function hiddenParties(ctx: ScopeCtx): Prisma.AccountWhereInput[] {
  const out: Prisma.AccountWhereInput[] = [];
  if (ctx.partyScope.customers) out.push({ customer: { isNot: null }, id: { notIn: ctx.partyScope.customers } });
  if (ctx.partyScope.suppliers) out.push({ supplier: { isNot: null }, id: { notIn: ctx.partyScope.suppliers } });
  return out;
}

/** Ledger accounts this user may not open or use: hidden parties, and general heads outside the assigned list. */
function hiddenAccounts(ctx: ScopeCtx): Prisma.AccountWhereInput[] {
  const out = hiddenParties(ctx);
  const heads = allowedAccounts(ctx);
  if (heads) out.push({ customer: { is: null }, supplier: { is: null }, id: { notIn: heads } });
  return out;
}

/** For account lists (ledgers, debtors, creditors, pickers). */
export function accountScopeWhere(ctx: ScopeCtx): Prisma.AccountWhereInput {
  const hidden = hiddenAccounts(ctx);
  return hidden.length ? { NOT: { OR: hidden } } : {};
}

/** For journal-entry queries (ledger lines of an account list). */
export function entryScopeWhere(ctx: ScopeCtx): Prisma.JournalEntryWhereInput {
  const hidden = hiddenAccounts(ctx);
  return hidden.length ? { NOT: { account: { OR: hidden } } } : {};
}

const CUSTOMER_TRADE = ["SALES", "SALES_RETURN", "DEPOT_DELIVERY"] as const;
const SUPPLIER_TRADE = ["PURCHASE", "PURCHASE_RETURN"] as const;

/**
 * Vouchers this user may see: none that posts to (or names) a party outside their list, and no walk-in
 * trade voucher of the restricted kind that someone else entered.
 */
export function voucherScopeWhere(ctx: ScopeCtx): Prisma.VoucherWhereInput {
  const hidden = hiddenParties(ctx);
  const heads = allowedAccounts(ctx);
  const parts: Prisma.VoucherWhereInput[] = [];
  if (hidden.length) {
    const walkIn = [...(ctx.partyScope.customers ? CUSTOMER_TRADE : []), ...(ctx.partyScope.suppliers ? SUPPLIER_TRADE : [])];
    parts.push({
      NOT: {
        OR: [
          { partyAccount: { is: { OR: hidden } } },
          { entries: { some: { account: { OR: hidden } } } },
          { partyAccountId: null, type: { in: walkIn }, createdById: { not: ctx.user.id } },
        ],
      },
    });
  }
  // account heads: a voucher of one of my heads (it posts to at least one assigned ledger)
  if (heads) parts.push({ entries: { some: { accountId: { in: heads } } } });
  return parts.length === 0 ? {} : parts.length === 1 ? parts[0] : { AND: parts };
}

/** May this user see this voucher? */
export async function canSeeVoucher(ctx: ScopeCtx, voucherId: string) {
  if (!isRestricted(ctx)) return true;
  return (await prisma.voucher.count({ where: { id: voucherId, businessId: ctx.business.id, ...voucherScopeWhere(ctx) } })) > 0;
}

/** May this user open this ledger account (a party outside their list: no)? */
export async function canSeeAccount(ctx: ScopeCtx, accountId: string) {
  if (!isRestricted(ctx)) return true;
  return (await prisma.account.count({ where: { id: accountId, businessId: ctx.business.id, ...accountScopeWhere(ctx) } })) > 0;
}

/** The ids of these accounts that this user may not use (parties outside their list). */
export async function forbiddenAccounts(ctx: ScopeCtx, accountIds: (string | null | undefined)[]) {
  const ids = [...new Set(accountIds.filter((x): x is string => !!x))];
  if (!isRestricted(ctx) || ids.length === 0) return [];
  const hidden = hiddenAccounts(ctx);
  const rows = await prisma.account.findMany({ where: { id: { in: ids }, businessId: ctx.business.id, OR: hidden }, select: { id: true, name: true, customer: { select: { id: true } }, supplier: { select: { id: true } } } });
  return rows;
}

/** Refuses a voucher that names / posts to a party or an account head outside the user's lists. */
export async function assertPartiesAllowed(ctx: ScopeCtx, accountIds: (string | null | undefined)[]) {
  const bad = await forbiddenAccounts(ctx, accountIds);
  if (!bad.length) return;
  if (bad.some((a) => a.customer || a.supplier)) throw new UserError("এই কাস্টমার/সরবরাহকারী আপনার জন্য নির্ধারিত নয় — অ্যাডমিনের সাথে যোগাযোগ করুন");
  throw new UserError(`হিসাব খাত "${bad[0].name}" আপনার জন্য নির্ধারিত নয় — অ্যাডমিনের সাথে যোগাযোগ করুন`);
}

/** A restricted user who creates a customer / supplier keeps access to it: it is assigned to them. */
export async function assignToCreator(ctx: ScopeCtx, kind: PartyKind, partyId: string) {
  if (allowedOf(ctx, kind) === null) return;
  const data = { businessId: ctx.business.id, userId: ctx.user.id };
  if (kind === "CUSTOMER") await prisma.userCustomer.upsert({ where: { userId_customerId: { userId: ctx.user.id, customerId: partyId } }, create: { ...data, customerId: partyId }, update: {} });
  else await prisma.userSupplier.upsert({ where: { userId_supplierId: { userId: ctx.user.id, supplierId: partyId } }, create: { ...data, supplierId: partyId }, update: {} });
}

/** May this user see this customer / supplier (by its ledger account)? */
export function canSeeParty(ctx: ScopeCtx, kind: PartyKind, accountId: string) {
  const allowed = allowedOf(ctx, kind);
  return allowed === null || allowed.includes(accountId);
}

/** Refuses an action on a customer / supplier record outside the user's list. */
export async function assertPartyRecordAllowed(ctx: ScopeCtx, kind: PartyKind, partyId: string) {
  if (allowedOf(ctx, kind) === null) return;
  const row = kind === "CUSTOMER"
    ? await prisma.customer.findFirst({ where: { id: partyId, businessId: ctx.business.id }, select: { accountId: true } })
    : await prisma.supplier.findFirst({ where: { id: partyId, businessId: ctx.business.id }, select: { accountId: true } });
  if (!row || !canSeeParty(ctx, kind, row.accountId)) throw new UserError(kind === "CUSTOMER" ? "এই কাস্টমার আপনার জন্য নির্ধারিত নয়" : "এই সরবরাহকারী আপনার জন্য নির্ধারিত নয়");
}

/** Refuses editing / deleting a voucher this user may not see. */
export async function assertVoucherAllowed(ctx: ScopeCtx, voucherId: string | null | undefined) {
  if (voucherId && !(await canSeeVoucher(ctx, voucherId))) throw new UserError("এই ভাউচারটি আপনার নির্ধারিত কাস্টমার/সরবরাহকারীর নয়");
}

/**
 * Restricted users: the only ledgers they may open are the customer / supplier accounts they may see
 * (a sales, cash or expense ledger lists every party's transactions).
 */
export async function canOpenLedger(ctx: ScopeCtx, accountId: string) {
  if (!isRestricted(ctx)) return true;
  const a = await prisma.account.findFirst({ where: { id: accountId, businessId: ctx.business.id }, select: { customer: { select: { id: true } }, supplier: { select: { id: true } } } });
  if (!a) return false;
  if (a.customer) return canSeeParty(ctx, "CUSTOMER", accountId);
  if (a.supplier) return canSeeParty(ctx, "SUPPLIER", accountId);
  const heads = allowedAccounts(ctx);
  if (heads) return heads.includes(accountId); // account-head restriction: my heads only
  return !partyRestricted(ctx); // party-restricted users: a sales / cash ledger lists every party
}

/** customer / supplier account ids this user may see (null = all) — for queries by account list */
export const allowedParties = (ctx: ScopeCtx, kind: PartyKind) => allowedOf(ctx, kind);

/** Alerts about a customer outside the user's list (overdue dues) are not shown to them. */
export function notificationScopeWhere(ctx: ScopeCtx): Prisma.NotificationWhereInput {
  const allowed = ctx.partyScope.customers;
  return allowed ? { OR: [{ accountId: null }, { accountId: { in: allowed } }] } : {};
}

// ───────────────────────── user assignment (users page) ─────────────────────────

/** Roles for the user form, with their restriction flags. */
export async function roleChoices(businessId: string) {
  const roles = await prisma.role.findMany({ where: { businessId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, permissions: true, isSystem: true } });
  return roles.map((r) => {
    const x = restrictionsOf(r.permissions, r.isSystem);
    return { id: r.id, name: r.name, customersOnly: x.customers, suppliersOnly: x.suppliers, accountsOnly: x.accounts };
  });
}

/** The customers / suppliers assigned to a member. */
export async function assignedPartiesOf(businessId: string, userId: string) {
  const select = { id: true, name: true, mobile: true } as const;
  const [c, s, a] = await Promise.all([
    prisma.userCustomer.findMany({ where: { businessId, userId }, select: { customer: { select: { ...select, isDepotDealer: true } } }, orderBy: { customer: { name: "asc" } } }),
    prisma.userSupplier.findMany({ where: { businessId, userId }, select: { supplier: { select } }, orderBy: { supplier: { name: "asc" } } }),
    prisma.userAccount.findMany({ where: { businessId, userId }, select: { account: { select: { id: true, name: true, group: { select: { name: true } } } } }, orderBy: { account: { name: "asc" } } }),
  ]);
  const strip = ({ id, name, mobile }: { id: string; name: string; mobile: string | null }) => ({ id, name, mobile });
  return {
    customers: c.filter((x) => !x.customer.isDepotDealer).map((x) => strip(x.customer)),
    dealers: c.filter((x) => x.customer.isDepotDealer).map((x) => strip(x.customer)),
    suppliers: s.map((x) => x.supplier),
    accounts: a.map((x) => ({ id: x.account.id, name: x.account.name, mobile: x.account.group.name })),
  };
}

/** Replaces a member's assignment (ids of another business are ignored). */
export async function saveAssignments(businessId: string, userId: string, customerIds: string[], supplierIds: string[], accountIds: string[] = []) {
  const [customers, suppliers, accounts] = await Promise.all([
    prisma.customer.findMany({ where: { businessId, id: { in: [...new Set(customerIds)] } }, select: { id: true } }),
    prisma.supplier.findMany({ where: { businessId, id: { in: [...new Set(supplierIds)] } }, select: { id: true } }),
    // account heads only: party ledgers are assigned as customers / suppliers
    prisma.account.findMany({ where: { businessId, id: { in: [...new Set(accountIds)] }, customer: { is: null }, supplier: { is: null } }, select: { id: true } }),
  ]);
  await prisma.$transaction([
    prisma.userCustomer.deleteMany({ where: { businessId, userId } }),
    prisma.userSupplier.deleteMany({ where: { businessId, userId } }),
    prisma.userAccount.deleteMany({ where: { businessId, userId } }),
    prisma.userCustomer.createMany({ data: customers.map((c) => ({ businessId, userId, customerId: c.id })) }),
    prisma.userSupplier.createMany({ data: suppliers.map((s) => ({ businessId, userId, supplierId: s.id })) }),
    prisma.userAccount.createMany({ data: accounts.map((a) => ({ businessId, userId, accountId: a.id })) }),
  ]);
  return { customers: customers.length, suppliers: suppliers.length, accounts: accounts.length };
}
