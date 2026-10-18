import "server-only";
// Row-level party restriction ("শুধু নির্ধারিত কাস্টমার / সরবরাহকারী").
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
}

export const UNRESTRICTED: PartyScope = { customers: null, suppliers: null };

interface ScopeCtx {
  partyScope: PartyScope;
  user: { id: string };
  business: { id: string };
}

/** Restriction keys only count when the role names them (an Owner / "*" role is never restricted). */
export function restrictionsOf(rolePermissions: unknown, isOwner: boolean) {
  const keys = strList(rolePermissions);
  if (isOwner || keys.includes("*")) return { customers: false, suppliers: false };
  return { customers: keys.includes("customers:assigned_only"), suppliers: keys.includes("suppliers:assigned_only") };
}

/** Loads the allowed party accounts for a member (used by getContext). */
export async function loadPartyScope(businessId: string, userId: string, r: { customers: boolean; suppliers: boolean }): Promise<PartyScope> {
  if (!r.customers && !r.suppliers) return UNRESTRICTED;
  const [c, s] = await Promise.all([
    r.customers ? prisma.userCustomer.findMany({ where: { businessId, userId }, select: { customer: { select: { accountId: true } } } }) : null,
    r.suppliers ? prisma.userSupplier.findMany({ where: { businessId, userId }, select: { supplier: { select: { accountId: true } } } }) : null,
  ]);
  return { customers: c ? c.map((x) => x.customer.accountId) : null, suppliers: s ? s.map((x) => x.supplier.accountId) : null };
}

export const isRestricted = (ctx: ScopeCtx) => ctx.partyScope.customers !== null || ctx.partyScope.suppliers !== null;
const allowedOf = (ctx: ScopeCtx, kind: PartyKind) => (kind === "CUSTOMER" ? ctx.partyScope.customers : ctx.partyScope.suppliers);

/** Customer / supplier rows this user may see. */
export function partyListWhere(ctx: ScopeCtx, kind: PartyKind): { accountId?: { in: string[] } } {
  const allowed = allowedOf(ctx, kind);
  return allowed ? { accountId: { in: allowed } } : {};
}

/** Ledger accounts this user may not open: customer / supplier accounts outside the allowed lists. */
function hiddenAccounts(ctx: ScopeCtx): Prisma.AccountWhereInput[] {
  const out: Prisma.AccountWhereInput[] = [];
  if (ctx.partyScope.customers) out.push({ customer: { isNot: null }, id: { notIn: ctx.partyScope.customers } });
  if (ctx.partyScope.suppliers) out.push({ supplier: { isNot: null }, id: { notIn: ctx.partyScope.suppliers } });
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
  const hidden = hiddenAccounts(ctx);
  if (!hidden.length) return {};
  const walkIn = [...(ctx.partyScope.customers ? CUSTOMER_TRADE : []), ...(ctx.partyScope.suppliers ? SUPPLIER_TRADE : [])];
  return {
    NOT: {
      OR: [
        { partyAccount: { is: { OR: hidden } } },
        { entries: { some: { account: { OR: hidden } } } },
        { partyAccountId: null, type: { in: walkIn }, createdById: { not: ctx.user.id } },
      ],
    },
  };
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
  const rows = await prisma.account.findMany({ where: { id: { in: ids }, businessId: ctx.business.id, OR: hidden }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Refuses a voucher that names / posts to a party outside the user's list. */
export async function assertPartiesAllowed(ctx: ScopeCtx, accountIds: (string | null | undefined)[]) {
  if ((await forbiddenAccounts(ctx, accountIds)).length) throw new UserError("এই কাস্টমার/সরবরাহকারী আপনার জন্য নির্ধারিত নয় — অ্যাডমিনের সাথে যোগাযোগ করুন");
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
  return false;
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
    return { id: r.id, name: r.name, customersOnly: x.customers, suppliersOnly: x.suppliers };
  });
}

/** The customers / suppliers assigned to a member. */
export async function assignedPartiesOf(businessId: string, userId: string) {
  const select = { id: true, name: true, mobile: true } as const;
  const [c, s] = await Promise.all([
    prisma.userCustomer.findMany({ where: { businessId, userId }, select: { customer: { select } }, orderBy: { customer: { name: "asc" } } }),
    prisma.userSupplier.findMany({ where: { businessId, userId }, select: { supplier: { select } }, orderBy: { supplier: { name: "asc" } } }),
  ]);
  return { customers: c.map((x) => x.customer), suppliers: s.map((x) => x.supplier) };
}

/** Replaces a member's assignment (ids of another business are ignored). */
export async function saveAssignments(businessId: string, userId: string, customerIds: string[], supplierIds: string[]) {
  const [customers, suppliers] = await Promise.all([
    prisma.customer.findMany({ where: { businessId, id: { in: [...new Set(customerIds)] } }, select: { id: true } }),
    prisma.supplier.findMany({ where: { businessId, id: { in: [...new Set(supplierIds)] } }, select: { id: true } }),
  ]);
  await prisma.$transaction([
    prisma.userCustomer.deleteMany({ where: { businessId, userId } }),
    prisma.userSupplier.deleteMany({ where: { businessId, userId } }),
    prisma.userCustomer.createMany({ data: customers.map((c) => ({ businessId, userId, customerId: c.id })) }),
    prisma.userSupplier.createMany({ data: suppliers.map((s) => ({ businessId, userId, supplierId: s.id })) }),
  ]);
  return { customers: customers.length, suppliers: suppliers.length };
}
