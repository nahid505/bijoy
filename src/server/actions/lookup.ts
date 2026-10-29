"use server";

import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { accountSchema, partySchema, productSchema } from "@/lib/validation";
import type { PartyOption, ProductOption } from "@/components/trade-parts";
import { assertPermission } from "../auth";
import { audit } from "../audit";
import { guard } from "../action-utils";
import { saveAccount, saveParty, saveProduct } from "../services/master";
import { ACCOUNT_SCOPES, SCOPE_GROUPS, searchAccounts, searchParties, searchProducts, type AccountHit, type AccountScope } from "../lookup";
import { assignToCreator } from "../party-scope";
import { DEPOT_ACCESS, isDepot } from "@/lib/depot";

type Result<T> = { ok: true; item: T } | { ok: false; message: string; errors?: Record<string, string[]> };

/** "Create new" from a customer / supplier picker: name + mobile, ready to use in the voucher. */
export async function quickCreatePartyAction(kind: "CUSTOMER" | "SUPPLIER", input: { name: string; mobile: string; ownerName?: string; dealer?: boolean }): Promise<Result<PartyOption>> {
  const dealer = kind === "CUSTOMER" && !!input.dealer; // "+ নতুন ডিলার তৈরি করুন" (depot forms)
  const r = await guard(async () => {
    const ctx = await assertPermission(dealer ? DEPOT_ACCESS.dealerQuickCreate : kind === "CUSTOMER" ? "customers:manage" : "suppliers:manage");
    if (dealer && !isDepot(ctx.business.businessType)) throw new UserError("ডিলার শুধু ডিপো ব্যবসায় তৈরি করা যায়");
    const data = partySchema.parse({ name: input.name, mobile: input.mobile, ownerName: dealer ? input.ownerName ?? "" : "", email: "", address: "", notes: "", openingBalance: 0, creditLimit: 0, creditDays: 0 });
    const party = await saveParty(ctx.svc, kind, data, undefined, { dealer });
    await assignToCreator(ctx, kind, party.id); // a restricted user keeps what they create
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "CREATE", entity: kind === "CUSTOMER" ? "Customer" : "Supplier", entityId: party.id, details: { name: data.name, via: "quick-create", ...(dealer ? { dealer: true } : {}) } });
    const [item] = await searchParties(ctx.business.id, kind, "", { accountIds: [party.accountId], dealer });
    return item;
  });
  return r.ok ? { ok: true, item: r.data } : { ok: false, message: r.message, errors: r.errors };
}

/** "Create new" from a product picker: the essentials only (more can be added on the product page). */
export async function quickCreateProductAction(input: { name: string; code: string; barcode: string; unitId: string; purchasePrice: string; salePrice: string; depot?: boolean }): Promise<Result<ProductOption>> {
  const r = await guard(async () => {
    // from a depot form: a depot product (depot:products_manage), never a general one
    const ctx = await assertPermission(input.depot ? DEPOT_ACCESS.products : "inventory:manage");
    const data = productSchema.parse({
      name: input.name, code: input.code, barcode: input.barcode, categoryId: "", brandId: "", unitId: input.unitId,
      purchasePrice: input.purchasePrice || 0, salePrice: input.salePrice || 0, wholesalePrice: 0, minStock: 0, openingStock: 0, openingRate: 0, trackBatch: false,
      isDepotProduct: input.depot === true,
    });
    const id = await saveProduct(ctx.svc, data);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "CREATE", entity: "Product", entityId: id, details: { name: data.name, via: "quick-create", ...(input.depot ? { depotProduct: true } : {}) } });
    const [item] = await searchProducts(ctx.business.id, "", { ids: [id] });
    return item;
  });
  return r.ok ? { ok: true, item: r.data } : { ok: false, message: r.message, errors: r.errors };
}

const scopeOf = (s: string): AccountScope => ((ACCOUNT_SCOPES as string[]).includes(s) ? (s as AccountScope) : "all");

/** Groups offered by the "create new account" dialog: only groups whose ledgers that picker shows. */
export async function accountGroupsForCreateAction(scope: string): Promise<{ ok: true; groups: { id: string; name: string; systemKey: string | null }[] } | { ok: false; message: string }> {
  const r = await guard(async () => {
    const ctx = await assertPermission("accounts:manage");
    return prisma.accountGroup.findMany({ where: { businessId: ctx.business.id, ...SCOPE_GROUPS[scopeOf(scope)] }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, systemKey: true } });
  });
  return r.ok ? { ok: true, groups: r.data } : { ok: false, message: r.message };
}

/** "Create new" from an account picker: a ledger with no opening balance, ready to use in the voucher. */
export async function quickCreateAccountAction(
  scope: string,
  input: { name: string; code: string; groupId: string; bankName: string; accountNumber: string },
): Promise<Result<AccountHit>> {
  const r = await guard(async () => {
    const ctx = await assertPermission("accounts:manage");
    const allowed = await prisma.accountGroup.findFirst({ where: { id: input.groupId, businessId: ctx.business.id, ...SCOPE_GROUPS[scopeOf(scope)] }, select: { id: true } });
    if (!allowed) throw new UserError("এই তালিকার জন্য গ্রুপটি প্রযোজ্য নয় — অন্য গ্রুপ নির্বাচন করুন");
    const data = accountSchema.parse({ name: input.name, code: input.code, groupId: input.groupId, description: "", bankName: input.bankName, accountNumber: input.accountNumber, openingBalance: 0, openingSide: "DR" });
    const id = await saveAccount(ctx.svc, data);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "CREATE", entity: "Account", entityId: id, details: { name: data.name, via: "quick-create" } });
    const { items } = await searchAccounts(ctx.business.id, "", { ids: [id] });
    return items[0];
  });
  return r.ok ? { ok: true, item: r.data } : { ok: false, message: r.message, errors: r.errors };
}
