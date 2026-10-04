"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { accountSchema, nameSchema, partySchema, productSchema, unitSchema, warehouseSchema } from "@/lib/validation";
import { assertPermission } from "../auth";
import { audit } from "../audit";
import { formToObject, guard, parseForm, safeReturnPath, toResult, UserError, type ActionState } from "../action-utils";
import { flash } from "../flash";
import { deleteAccount, deleteParty, deleteProduct, saveAccount, saveParty, saveProduct, setPartyActive } from "../services/master";

// ───────────────────────── customers & suppliers ─────────────────────────

type PartyKind = "CUSTOMER" | "SUPPLIER";
const PARTY_CFG = {
  CUSTOMER: { perm: "customers:manage", path: "/customers", entity: "Customer" },
  SUPPLIER: { perm: "suppliers:manage", path: "/suppliers", entity: "Supplier" },
} as const;

export async function savePartyAction(kind: PartyKind, id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const cfg = PARTY_CFG[kind];
  const result = await guard(async () => {
    const ctx = await assertPermission(cfg.perm);
    const input = parseForm(partySchema, fd);
    const saved = await saveParty(ctx.svc, kind, input, id ?? undefined);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: id ? "UPDATE" : "CREATE", entity: cfg.entity, entityId: saved.id, details: { name: input.name, opening: input.openingBalance } });
    return saved.id;
  });
  if (!result.ok) return toResult(result);
  await flash(`${kind === "CUSTOMER" ? "কাস্টমার" : "সরবরাহকারী"} সংরক্ষণ হয়েছে`);
  revalidatePath(cfg.path);
  redirect(`${cfg.path}/${result.data}`);
}

export async function deletePartyAction(kind: PartyKind, id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const cfg = PARTY_CFG[kind];
  const result = await guard(async () => {
    const ctx = await assertPermission(cfg.perm);
    const p = await deleteParty(ctx.svc, kind, id);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "DELETE", entity: cfg.entity, entityId: id, details: { name: p.name } });
  });
  if (!result.ok) return toResult(result);
  revalidatePath(cfg.path);
  redirect(cfg.path);
}

export async function togglePartyAction(kind: PartyKind, id: string, active: boolean, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const cfg = PARTY_CFG[kind];
  const result = await guard(async () => {
    const ctx = await assertPermission(cfg.perm);
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

// ───────────────────────── products ─────────────────────────

export async function saveProductAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("inventory:manage");
    const input = productSchema.parse({ ...formToObject(fd), trackBatch: fd.get("trackBatch") === "on" });
    const productId = await saveProduct(ctx.svc, input, id ?? undefined);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: id ? "UPDATE" : "CREATE", entity: "Product", entityId: productId, details: { name: input.name, openingStock: input.openingStock } });
    return productId;
  });
  if (!result.ok) return toResult(result);
  await flash("পণ্য সংরক্ষণ হয়েছে");
  revalidatePath("/products");
  redirect(`/products/${result.data}`);
}

export async function deleteProductAction(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("inventory:manage");
    const p = await deleteProduct(ctx.svc, id);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "DELETE", entity: "Product", entityId: id, details: { name: p.name } });
  });
  if (!result.ok) return toResult(result);
  revalidatePath("/products");
  redirect("/products");
}

export async function toggleProductAction(id: string, active: boolean, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("inventory:manage");
    const p = await prisma.product.findFirst({ where: { id, businessId: ctx.business.id } });
    if (!p) throw new UserError("পণ্য পাওয়া যায়নি");
    await prisma.product.update({ where: { id }, data: { isActive: active } });
  });
  revalidatePath(`/products/${id}`);
  return toResult(result);
}

// ───────────────────────── catalogue: category / brand / unit / warehouse ─────────────────────────

type CatalogKind = "category" | "brand" | "unit" | "warehouse";

export async function saveCatalogAction(kind: CatalogKind, id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("inventory:manage");
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
