"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { accountGroupSchema, accountSchema, nameSchema, partySchema, productSchema, unitSchema, warehouseSchema } from "@/lib/validation";
import { assertPermission } from "../auth";
import { audit } from "../audit";
import { formToObject, guard, parseForm, safeReturnPath, toResult, UserError, type ActionState } from "../action-utils";
import { flash } from "../flash";
import { createAccountGroup, deleteAccount, deleteParty, deleteProduct, saveAccount, saveParty, saveProduct, setPartyActive, type AccountGroupOption } from "../services/master";
import { assertFeature } from "../features";
import { assertPartyRecordAllowed, assignToCreator } from "../party-scope";
import { DEPOT_ACCESS, isDepot } from "@/lib/depot";

// ───────────────────────── customers & suppliers ─────────────────────────

type PartyKind = "CUSTOMER" | "SUPPLIER";
/** DEALER: a depot dealer (customer row with isDepotDealer) — managed from the depot menu */
type PartyPageKind = PartyKind | "DEALER";
const PARTY_CFG = {
  CUSTOMER: { perm: "customers:manage", path: "/customers", entity: "Customer", model: "CUSTOMER" },
  SUPPLIER: { perm: "suppliers:manage", path: "/suppliers", entity: "Supplier", model: "SUPPLIER" },
  DEALER: { perm: DEPOT_ACCESS.dealers, path: "/depot/dealers", entity: "Customer", model: "CUSTOMER" },
} as const;

/** The record must be of the page's kind: a dealer is not edited as a general customer, nor the reverse. */
async function assertPartyKind(businessId: string, kind: PartyPageKind, id: string) {
  if (kind === "SUPPLIER") return;
  const dealer = kind === "DEALER";
  if (!(await prisma.customer.count({ where: { id, businessId, isDepotDealer: dealer } }))) throw new UserError(dealer ? "ডিলার পাওয়া যায়নি" : "কাস্টমার পাওয়া যায়নি");
}

/** Create / edit a depot dealer (/depot/dealers). */
export async function saveDealerAction(id: string | null, prev: ActionState, fd: FormData): Promise<ActionState> {
  return savePartyAction("DEALER", id, prev, fd);
}

export async function savePartyAction(pageKind: PartyPageKind, id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const cfg = PARTY_CFG[pageKind];
  const kind = cfg.model;
  const result = await guard(async () => {
    const ctx = await assertPermission(cfg.perm);
    if (pageKind === "DEALER" && !isDepot(ctx.business.businessType)) throw new UserError("ডিলার শুধু ডিপো ব্যবসায়");
    if (id) await assertPartyKind(ctx.business.id, pageKind, id);
    const input = parseForm(partySchema, fd);
    if (!fd.has("route")) delete (input as { route?: string | null }).route; // form without the depot field: keep the stored route
    if (!fd.has("ownerName")) delete (input as { ownerName?: string | null }).ownerName; // only the dealer form has the owner
    if (id) await assertPartyRecordAllowed(ctx, kind, id);
    const saved = await saveParty(ctx.svc, kind, input, id ?? undefined, { dealer: pageKind === "DEALER" });
    if (!id) await assignToCreator(ctx, kind, saved.id); // a restricted user keeps what they create
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: id ? "UPDATE" : "CREATE", entity: cfg.entity, entityId: saved.id, details: { name: input.name, ...(input.ownerName ? { owner: input.ownerName } : {}), opening: input.openingBalance } });
    return saved.id;
  });
  if (!result.ok) return toResult(result);
  await flash(`${pageKind === "DEALER" ? "ডিলার" : pageKind === "CUSTOMER" ? "কাস্টমার" : "সরবরাহকারী"} সংরক্ষণ হয়েছে`);
  revalidatePath(cfg.path);
  redirect(`${cfg.path}/${result.data}`);
}

export async function deletePartyAction(pageKind: PartyPageKind, id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const cfg = PARTY_CFG[pageKind];
  const kind = cfg.model;
  const result = await guard(async () => {
    const ctx = await assertPermission(cfg.perm);
    await assertPartyKind(ctx.business.id, pageKind, id);
    await assertPartyRecordAllowed(ctx, kind, id);
    const p = await deleteParty(ctx.svc, kind, id);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "DELETE", entity: cfg.entity, entityId: id, details: { name: p.name } });
  });
  if (!result.ok) return toResult(result);
  revalidatePath(cfg.path);
  redirect(cfg.path);
}

export async function togglePartyAction(pageKind: PartyPageKind, id: string, active: boolean, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const cfg = PARTY_CFG[pageKind];
  const kind = cfg.model;
  const result = await guard(async () => {
    const ctx = await assertPermission(cfg.perm);
    await assertPartyKind(ctx.business.id, pageKind, id);
    await assertPartyRecordAllowed(ctx, kind, id);
    await setPartyActive(ctx.svc, kind, id, active);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: cfg.entity, entityId: id, details: { isActive: active } });
  });
  revalidatePath(`${cfg.path}/${id}`);
  return toResult(result);
}

// ───────────────────────── chart of accounts ─────────────────────────

export async function saveAccountAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("accounts:manage");
    const input = parseForm(accountSchema, fd);
    const accountId = await saveAccount(ctx.svc, input, id ?? undefined);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: id ? "UPDATE" : "CREATE", entity: "Account", entityId: accountId, details: { name: input.name, opening: input.openingBalance, side: input.openingSide } });
    return accountId;
  });
  if (!result.ok) return toResult(result);
  await flash("হিসাব সংরক্ষণ হয়েছে");
  revalidatePath("/accounts");
  redirect(`/accounts/${result.data}`);
}

export async function deleteAccountAction(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("accounts:manage");
    const a = await deleteAccount(ctx.svc, id);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "DELETE", entity: "Account", entityId: id, details: { name: a.name } });
  });
  if (!result.ok) return toResult(result);
  revalidatePath("/accounts");
  redirect("/accounts");
}

export async function toggleAccountAction(id: string, active: boolean, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("accounts:manage");
    const a = await prisma.account.findFirst({ where: { id, businessId: ctx.business.id } });
    if (!a) throw new UserError("হিসাব পাওয়া যায়নি");
    if (a.isSystem && !active) throw new UserError("সিস্টেম হিসাব নিষ্ক্রিয় করা যাবে না");
    await prisma.account.update({ where: { id }, data: { isActive: active } });
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: "Account", entityId: id, details: { isActive: active } });
  });
  revalidatePath(`/accounts/${id}`);
  return toResult(result);
}

/** "+ নতুন গ্রুপ" on the account form: creates the group without leaving the page and returns it for the dropdown. */
export async function createAccountGroupAction(input: { name: string; nature: string; parentId: string; description: string }): Promise<{ ok: true; group: AccountGroupOption } | { ok: false; message: string; errors?: Record<string, string[]> }> {
  const r = await guard(async () => {
    const ctx = await assertPermission("accounts:manage");
    const data = accountGroupSchema.parse(input);
    const group = await createAccountGroup(ctx.svc, data);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "CREATE", entity: "AccountGroup", entityId: group.id, details: { name: data.name, nature: data.nature, parentId: data.parentId } });
    return group;
  });
  if (!r.ok) return { ok: false, message: r.message, errors: r.errors };
  revalidatePath("/accounts");
  return { ok: true, group: r.data };
}

// ───────────────────────── products ─────────────────────────

/** Products: a depot (dealership) product needs depot:products_manage (or inventory:manage), a general one inventory:manage. */
const productPermission = (depotProduct: boolean) => (depotProduct ? DEPOT_ACCESS.products : ("inventory:manage" as const));
const productBase = (depotProduct: boolean) => (depotProduct ? "/depot/products" : "/products");

async function productFlag(businessId: string, id: string) {
  const p = await prisma.product.findFirst({ where: { id, businessId }, select: { isDepotProduct: true } });
  if (!p) throw new UserError("পণ্য পাওয়া যায়নি");
  return p.isDepotProduct;
}

/** kind: the form it came from — "DEPOT" (/depot/products) creates depot products. */
async function saveProductFrom(kind: "GENERAL" | "DEPOT", id: string | null, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    let ctx = await assertPermission([...DEPOT_ACCESS.products]);
    // the switch is on the form only in depot businesses; absent = new depot-form product is a depot product, else unchanged
    const flag = fd.get("depotFlag") ? fd.get("isDepotProduct") === "on" : !id && kind === "DEPOT" ? true : undefined;
    const input = productSchema.parse({ ...formToObject(fd), trackBatch: fd.get("trackBatch") === "on", isDepotProduct: flag });
    const before = id ? await productFlag(ctx.business.id, id) : kind === "DEPOT";
    ctx = await assertPermission(productPermission(before)); // the product as it is now …
    if (input.isDepotProduct !== undefined && input.isDepotProduct !== before) ctx = await assertPermission(productPermission(input.isDepotProduct)); // … and what it becomes
    if (input.isDepotProduct && !isDepot(ctx.business.businessType)) throw new UserError("ডিপো পণ্য শুধু ডিপো ব্যবসায় রাখা যায়");
    const productId = await saveProduct(ctx.svc, input, id ?? undefined);
    const after = input.isDepotProduct ?? before;
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: id ? "UPDATE" : "CREATE", entity: "Product", entityId: productId, details: { name: input.name, openingStock: input.openingStock, ...(after ? { depotProduct: true } : {}), ...(after !== before ? { movedTo: after ? "DEPOT" : "GENERAL" } : {}) } });
    return { productId, after };
  });
  if (!result.ok) return toResult(result);
  await flash(result.data.after ? "ডিপো পণ্য সংরক্ষণ হয়েছে" : "পণ্য সংরক্ষণ হয়েছে");
  revalidatePath("/", "layout");
  redirect(`${productBase(result.data.after)}/${result.data.productId}`);
}

export async function saveProductAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return saveProductFrom("GENERAL", id, fd);
}

/** The depot product form's action (same rules; a new product is a depot product). */
export async function saveDepotProductAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return saveProductFrom("DEPOT", id, fd);
}

export async function deleteProductAction(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  let depotProduct = false;
  const result = await guard(async () => {
    const pre = await assertPermission([...DEPOT_ACCESS.products]);
    depotProduct = await productFlag(pre.business.id, id);
    const ctx = await assertPermission(productPermission(depotProduct));
    const p = await deleteProduct(ctx.svc, id);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "DELETE", entity: "Product", entityId: id, details: { name: p.name, ...(depotProduct ? { depotProduct: true } : {}) } });
  });
  if (!result.ok) return toResult(result);
  revalidatePath("/", "layout");
  redirect(productBase(depotProduct));
}

export async function toggleProductAction(id: string, active: boolean, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const pre = await assertPermission([...DEPOT_ACCESS.products]);
    await assertPermission(productPermission(await productFlag(pre.business.id, id)));
    await prisma.product.update({ where: { id }, data: { isActive: active } });
  });
  revalidatePath("/", "layout");
  return toResult(result);
}

// ───────────────────────── catalogue: category / brand / unit / warehouse ─────────────────────────

type CatalogKind = "category" | "brand" | "unit" | "warehouse";

export async function saveCatalogAction(kind: CatalogKind, id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("inventory:manage");
    if (kind === "warehouse") await assertFeature(ctx.business.id, "MULTI_WAREHOUSE");
    const businessId = ctx.business.id;
    const owned = async () => {
      const found =
        kind === "category" ? await prisma.category.findFirst({ where: { id: id!, businessId } })
        : kind === "brand" ? await prisma.brand.findFirst({ where: { id: id!, businessId } })
        : kind === "unit" ? await prisma.unit.findFirst({ where: { id: id!, businessId } })
        : await prisma.warehouse.findFirst({ where: { id: id!, businessId } });
      if (!found) throw new UserError("রেকর্ড পাওয়া যায়নি");
    };
    if (id) await owned();
    if (kind === "category" || kind === "brand") {
      const { name } = parseForm(nameSchema, fd);
      const delegate = kind === "category" ? prisma.category : prisma.brand;
      if (id) await (delegate as typeof prisma.category).update({ where: { id }, data: { name } });
      else await (delegate as typeof prisma.category).create({ data: { name, businessId } });
    } else if (kind === "unit") {
      const input = unitSchema.parse(formToObject(fd));
      if (input.baseUnitId) {
        const base = await prisma.unit.findFirst({ where: { id: input.baseUnitId, businessId } });
        if (!base || base.baseUnitId) throw new UserError("মূল ইউনিট হিসেবে একটি বেস ইউনিট নির্বাচন করুন");
        if (id && base.id === id) throw new UserError("ইউনিট নিজেই নিজের মূল হতে পারে না");
      }
      if (id) {
        const used = await prisma.voucherItem.count({ where: { unitId: id } });
        const current = await prisma.unit.findUniqueOrThrow({ where: { id } });
        if (used > 0 && (current.baseUnitId !== input.baseUnitId || Number(current.factor) !== input.factor)) {
          throw new UserError("লেনদেনে ব্যবহৃত ইউনিটের রূপান্তর হার পরিবর্তন করা যাবে না");
        }
        await prisma.unit.update({ where: { id }, data: input });
      } else await prisma.unit.create({ data: { ...input, businessId } });
    } else {
      const input = parseForm(warehouseSchema, fd);
      if (id) await prisma.warehouse.update({ where: { id }, data: input });
      else await prisma.warehouse.create({ data: { ...input, businessId } });
    }
    await audit({ businessId, userId: ctx.user.id, action: id ? "UPDATE" : "CREATE", entity: kind, entityId: id, details: formToObject(fd) });
  });
  if (!result.ok) return toResult(result);
  await flash("সংরক্ষণ হয়েছে");
  const back = safeReturnPath(fd.get("returnTo"), "/products");
  revalidatePath(back);
  redirect(back);
}

export async function deleteCatalogAction(kind: CatalogKind, id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("inventory:manage");
    if (kind === "warehouse") await assertFeature(ctx.business.id, "MULTI_WAREHOUSE");
    const businessId = ctx.business.id;
    if (kind === "category") {
      if (await prisma.product.count({ where: { categoryId: id } })) throw new UserError("এই ক্যাটাগরিতে পণ্য আছে");
      await prisma.category.deleteMany({ where: { id, businessId } });
    } else if (kind === "brand") {
      if (await prisma.product.count({ where: { brandId: id } })) throw new UserError("এই ব্র্যান্ডে পণ্য আছে");
      await prisma.brand.deleteMany({ where: { id, businessId } });
    } else if (kind === "unit") {
      if ((await prisma.product.count({ where: { unitId: id } })) || (await prisma.voucherItem.count({ where: { unitId: id } })) || (await prisma.unit.count({ where: { baseUnitId: id } }))) {
        throw new UserError("এই ইউনিট ব্যবহৃত হচ্ছে");
      }
      await prisma.unit.deleteMany({ where: { id, businessId } });
    } else {
      if (await prisma.stockMovement.count({ where: { warehouseId: id } })) throw new UserError("এই গুদামে স্টক লেনদেন আছে");
      const w = await prisma.warehouse.findFirst({ where: { id, businessId } });
      if (w?.isDefault) throw new UserError("প্রধান গুদাম মুছা যাবে না");
      await prisma.warehouse.deleteMany({ where: { id, businessId } });
    }
    await audit({ businessId, userId: ctx.user.id, action: "DELETE", entity: kind, entityId: id });
  });
  revalidatePath("/products", "layout");
  return toResult(result);
}
