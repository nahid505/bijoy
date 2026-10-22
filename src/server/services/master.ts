// Master data connected to accounting: every customer / supplier owns a ledger;
// opening balances and opening stock are posted as OPENING vouchers.
import type { AccountKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { NATURE_LABELS } from "@/lib/accounting";
import { canHaveSubgroups, groupDepth, MAX_GROUP_DEPTH, NO_SUBGROUP_KEYS, orderGroupTree } from "@/lib/account-groups";
import { ciEquals } from "@/lib/dialect";
import type { AccountGroupInput, PartyInput, ProductInput } from "@/lib/validation";
import { getAccountOpening, setAccountOpening, type Ctx, type Tx } from "./accounting";
import { setOpeningStock } from "./inventory";

const TX = { timeout: 30_000, maxWait: 10_000 };

type PartyKind = "CUSTOMER" | "SUPPLIER";

const PARTY = {
  CUSTOMER: { group: "SUNDRY_DEBTORS", sign: 1 }, // opening = receivable (debit)
  SUPPLIER: { group: "SUNDRY_CREDITORS", sign: -1 }, // opening = payable (credit)
} as const;

async function groupByKey(tx: Tx, businessId: string, key: string) {
  const g = await tx.accountGroup.findUnique({ where: { businessId_systemKey: { businessId, systemKey: key } } });
  if (!g) throw new Error(`group ${key} missing`);
  return g;
}

/** True if the ledger has postings other than its own opening voucher. */
async function hasActivity(tx: Tx, businessId: string, accountId: string) {
  const count = await tx.journalEntry.count({
    where: { businessId, accountId, voucher: { NOT: { sourceKey: `opening:account:${accountId}` } } },
  });
  return count > 0;
}

// ───────────────────────── customers / suppliers ─────────────────────────

/** opts.dealer: a NEW customer is a depot dealer (kept out of the general customer list; trades in the depot book). */
export async function saveParty(ctx: Ctx, kind: PartyKind, input: PartyInput, id?: string, opts: { dealer?: boolean } = {}) {
  return prisma.$transaction(async (tx) => {
    const cfg = PARTY[kind];
    const base = { name: input.name, mobile: input.mobile, email: input.email, address: input.address, notes: input.notes, creditDays: input.creditDays };
    const data = kind === "CUSTOMER" ? { ...base, creditLimit: input.creditLimit, groupName: input.groupName ?? null, ...(input.route !== undefined ? { route: input.route } : {}) } : base;
    let accountId: string;
    let partyId: string;
    if (id) {
      const existing =
        kind === "CUSTOMER"
          ? await tx.customer.findFirst({ where: { id, businessId: ctx.businessId } })
          : await tx.supplier.findFirst({ where: { id, businessId: ctx.businessId } });
      if (!existing) throw new UserError("রেকর্ড পাওয়া যায়নি");
      accountId = existing.accountId;
      partyId = existing.id;
      if (kind === "CUSTOMER") await tx.customer.update({ where: { id }, data });
      else await tx.supplier.update({ where: { id }, data });
      await tx.account.update({ where: { id: accountId }, data: { name: input.name } });
    } else {
      const group = await groupByKey(tx, ctx.businessId, cfg.group);
      const account = await tx.account.create({
        data: { businessId: ctx.businessId, groupId: group.id, nature: group.nature, name: input.name, kind: kind as AccountKind },
      });
      accountId = account.id;
      const party =
        kind === "CUSTOMER"
          ? await tx.customer.create({ data: { ...data, businessId: ctx.businessId, accountId, isDepotDealer: !!opts.dealer } })
          : await tx.supplier.create({ data: { ...data, businessId: ctx.businessId, accountId } });
      partyId = party.id;
    }
    await setAccountOpening(tx, ctx, accountId, cfg.sign * input.openingBalance);
    return { id: partyId, accountId };
  }, TX);
}

export async function deleteParty(ctx: Ctx, kind: PartyKind, id: string) {
  return prisma.$transaction(async (tx) => {
    const party =
      kind === "CUSTOMER"
        ? await tx.customer.findFirst({ where: { id, businessId: ctx.businessId } })
        : await tx.supplier.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!party) throw new UserError("রেকর্ড পাওয়া যায়নি");
    if (await hasActivity(tx, ctx.businessId, party.accountId)) {
      throw new UserError("এই হিসাবে লেনদেন রয়েছে, তাই মুছা যাবে না। পরিবর্তে নিষ্ক্রিয় করুন।");
    }
    await setAccountOpening(tx, ctx, party.accountId, 0);
    if (kind === "CUSTOMER") await tx.customer.delete({ where: { id } });
    else await tx.supplier.delete({ where: { id } });
    await tx.account.delete({ where: { id: party.accountId } });
    return party;
  }, TX);
}

export async function setPartyActive(ctx: Ctx, kind: PartyKind, id: string, isActive: boolean) {
  return prisma.$transaction(async (tx) => {
    const party =
      kind === "CUSTOMER"
        ? await tx.customer.findFirst({ where: { id, businessId: ctx.businessId } })
        : await tx.supplier.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!party) throw new UserError("রেকর্ড পাওয়া যায়নি");
    if (kind === "CUSTOMER") await tx.customer.update({ where: { id }, data: { isActive } });
    else await tx.supplier.update({ where: { id }, data: { isActive } });
    await tx.account.update({ where: { id: party.accountId }, data: { isActive } });
  });
}

export async function partyOpening(businessId: string, kind: PartyKind, accountId: string) {
  const signed = await getAccountOpening(prisma, businessId, accountId);
  return PARTY[kind].sign * signed;
}

// ───────────────────────── chart of accounts ─────────────────────────

const RESERVED_GROUPS = ["SUNDRY_DEBTORS", "SUNDRY_CREDITORS"];

export interface AccountGroupOption {
  id: string;
  name: string;
  nature: string;
  systemKey: string | null;
  parentId: string | null;
  depth: number;
  /** a sub-group may be created under it */
  canParent: boolean;
}

/** Groups for the account form, in tree order (debtors / creditors left out: their ledgers come from the party pages). */
export async function accountGroupOptions(businessId: string): Promise<AccountGroupOption[]> {
  const groups = await prisma.accountGroup.findMany({
    where: { businessId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, nature: true, systemKey: true, parentId: true },
  });
  return orderGroupTree(groups)
    .filter((g) => !RESERVED_GROUPS.includes(g.systemKey ?? ""))
    .map((g) => ({ ...g, canParent: canHaveSubgroups(groups, g.id) }));
}

/** A new account group (top level or a sub-group). A sub-group takes its parent's nature and P&L section. */
export async function createAccountGroup(ctx: Ctx, input: AccountGroupInput): Promise<AccountGroupOption> {
  return prisma.$transaction(async (tx) => {
    if (await tx.accountGroup.findFirst({ where: { businessId: ctx.businessId, name: ciEquals(input.name) }, select: { id: true } })) {
      throw new UserError("এই নামে একটি গ্রুপ আগে থেকেই আছে", { name: ["এই নামে একটি গ্রুপ আগে থেকেই আছে"] });
    }
    let isDirect = false;
    let sortOrder: number;
    let depth = 0;
    if (input.parentId) {
      const all = await tx.accountGroup.findMany({ where: { businessId: ctx.businessId }, select: { id: true, parentId: true, systemKey: true } });
      const parent = await tx.accountGroup.findFirst({ where: { id: input.parentId, businessId: ctx.businessId } });
      if (!parent) throw new UserError("প্যারেন্ট গ্রুপ পাওয়া যায়নি", { parentId: ["প্যারেন্ট গ্রুপ পাওয়া যায়নি"] });
      if (NO_SUBGROUP_KEYS.includes(parent.systemKey ?? "")) {
        throw new UserError(`"${parent.name}" এর অধীনে সাব-গ্রুপ খোলা যায় না — এর হিসাবগুলো নিজস্ব পাতা থেকে পরিচালিত হয়`, { parentId: ["এই গ্রুপের অধীনে সাব-গ্রুপ খোলা যায় না"] });
      }
      if (!canHaveSubgroups(all, parent.id)) throw new UserError(`সর্বোচ্চ ${MAX_GROUP_DEPTH} স্তর পর্যন্ত সাব-গ্রুপ খোলা যায়`, { parentId: ["এর নিচে আর স্তর খোলা যাবে না"] });
      if (parent.nature !== input.nature) {
        throw new UserError(`সাব-গ্রুপের মূল ধরন প্যারেন্ট গ্রুপের মতোই হতে হবে (${NATURE_LABELS[parent.nature]})`, { nature: [`প্যারেন্টের ধরন: ${NATURE_LABELS[parent.nature]}`] });
      }
      isDirect = parent.isDirect;
      sortOrder = parent.sortOrder; // listed with its parent in reports
      depth = groupDepth(all, parent.id) + 1;
    } else {
      sortOrder = ((await tx.accountGroup.aggregate({ where: { businessId: ctx.businessId }, _max: { sortOrder: true } }))._max.sortOrder ?? 0) + 1;
    }
    const g = await tx.accountGroup.create({
      data: { businessId: ctx.businessId, name: input.name, nature: input.nature, parentId: input.parentId, description: input.description, isDirect, sortOrder },
      select: { id: true, name: true, nature: true, systemKey: true, parentId: true },
    });
    return { ...g, depth, canParent: depth < MAX_GROUP_DEPTH };
  }, TX);
}

export interface AccountInput {
  name: string;
  code: string | null;
  groupId: string;
  description: string | null;
  bankName: string | null;
  accountNumber: string | null;
  openingBalance: number;
  openingSide: "DR" | "CR";
}

export async function saveAccount(ctx: Ctx, input: AccountInput, id?: string) {
  return prisma.$transaction(async (tx) => {
    const group = await tx.accountGroup.findFirst({ where: { id: input.groupId, businessId: ctx.businessId } });
    if (!group) throw new UserError("গ্রুপ পাওয়া যায়নি");
    const kind: AccountKind = group.systemKey === "CASH_IN_HAND" ? "CASH" : group.systemKey === "BANK_ACCOUNTS" ? "BANK" : "GENERAL";
    const base = {
      name: input.name,
      code: input.code,
      description: input.description,
      bankName: kind === "BANK" ? input.bankName : null,
      accountNumber: kind === "BANK" ? input.accountNumber : null,
    };
    let accountId: string;
    if (id) {
      const existing = await tx.account.findFirst({ where: { id, businessId: ctx.businessId } });
      if (!existing) throw new UserError("হিসাব পাওয়া যায়নি");
      if (existing.kind === "CUSTOMER" || existing.kind === "SUPPLIER") throw new UserError("কাস্টমার/সরবরাহকারীর হিসাব তাদের পাতা থেকে সম্পাদনা করুন");
      const groupChange = existing.groupId !== group.id;
      if (groupChange && existing.isSystem) throw new UserError("সিস্টেম হিসাবের গ্রুপ পরিবর্তন করা যাবে না");
      if (groupChange && RESERVED_GROUPS.includes(group.systemKey ?? "")) throw new UserError("এই গ্রুপে কাস্টমার/সরবরাহকারী পাতা থেকে হিসাব খুলুন");
      await tx.account.update({ where: { id }, data: { ...base, groupId: group.id, nature: group.nature, kind: existing.isSystem ? existing.kind : kind } });
      accountId = id;
    } else {
      if (RESERVED_GROUPS.includes(group.systemKey ?? "")) throw new UserError("এই গ্রুপে কাস্টমার/সরবরাহকারী পাতা থেকে হিসাব খুলুন");
      const created = await tx.account.create({ data: { ...base, businessId: ctx.businessId, groupId: group.id, nature: group.nature, kind } });
      accountId = created.id;
    }
    const signed = input.openingSide === "DR" ? input.openingBalance : -input.openingBalance;
    const acc = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
    if (acc.systemKey === "OPENING_EQUITY" && signed !== 0) throw new UserError("এই হিসাবে সরাসরি প্রারম্ভিক ব্যালেন্স দেওয়া যাবে না");
    if (acc.systemKey === "INVENTORY" && signed !== 0) throw new UserError("মজুদের প্রারম্ভিক মূল্য পণ্যের প্রারম্ভিক স্টক থেকে আসে");
    await setAccountOpening(tx, ctx, accountId, signed);
    return accountId;
  }, TX);
}

export async function deleteAccount(ctx: Ctx, id: string) {
  return prisma.$transaction(async (tx) => {
    const a = await tx.account.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!a) throw new UserError("হিসাব পাওয়া যায়নি");
    if (a.isSystem) throw new UserError("সিস্টেম হিসাব মুছা যাবে না");
    if (a.kind === "CUSTOMER" || a.kind === "SUPPLIER") throw new UserError("কাস্টমার/সরবরাহকারী তাদের পাতা থেকে মুছুন");
    if (await hasActivity(tx, ctx.businessId, id)) throw new UserError("এই হিসাবে লেনদেন রয়েছে, তাই মুছা যাবে না। পরিবর্তে নিষ্ক্রিয় করুন।");
    const usedAsCash = await tx.voucher.count({ where: { OR: [{ cashAccountId: id }, { partyAccountId: id }] } });
    if (usedAsCash > 0) throw new UserError("এই হিসাব ভাউচারে ব্যবহৃত হয়েছে");
    await setAccountOpening(tx, ctx, id, 0);
    await tx.account.delete({ where: { id } });
    return a;
  }, TX);
}

// ───────────────────────── products ─────────────────────────

export async function saveProduct(ctx: Ctx, input: ProductInput, id?: string) {
  return prisma.$transaction(async (tx) => {
    const unit = await tx.unit.findFirst({ where: { id: input.unitId, businessId: ctx.businessId } });
    if (!unit) throw new UserError("ইউনিট পাওয়া যায়নি");
    if (input.categoryId && !(await tx.category.findFirst({ where: { id: input.categoryId, businessId: ctx.businessId } }))) throw new UserError("ক্যাটাগরি পাওয়া যায়নি");
    if (input.brandId && !(await tx.brand.findFirst({ where: { id: input.brandId, businessId: ctx.businessId } }))) throw new UserError("ব্র্যান্ড পাওয়া যায়নি");
    // company / brand typed in (depot form): reuse one of that name, or create it
    let brandId = input.brandId;
    if (!brandId && input.newBrandName) {
      brandId = (await tx.brand.findFirst({ where: { businessId: ctx.businessId, name: ciEquals(input.newBrandName) }, select: { id: true } }))?.id
        ?? (await tx.brand.create({ data: { businessId: ctx.businessId, name: input.newBrandName } })).id;
    }
    const existing = id ? await tx.product.findFirst({ where: { id, businessId: ctx.businessId } }) : null;
    if (id && !existing) throw new UserError("পণ্য পাওয়া যায়নি");
    const depotProduct = input.isDepotProduct ?? existing?.isDepotProduct ?? false;
    if (depotProduct) {
      const b = await tx.business.findUnique({ where: { id: ctx.businessId }, select: { businessType: true } });
      if (b?.businessType !== "DEPOT") throw new UserError("ডিপো পণ্য শুধু ডিপো ব্যবসায় রাখা যায়");
    }
    // a product with transactions stays in its book: depot stock never mixes with the general stock
    if (existing && existing.isDepotProduct !== depotProduct && (await tx.voucherItem.count({ where: { productId: existing.id } })) > 0) {
      throw new UserError(existing.isDepotProduct ? "লেনদেন হওয়া ডিপো পণ্যকে সাধারণ পণ্য করা যাবে না" : "লেনদেন হওয়া সাধারণ পণ্যকে ডিপো পণ্য করা যাবে না — ডিপোর জন্য নতুন পণ্য তৈরি করুন");
    }
    const data = {
      name: input.name,
      code: input.code,
      barcode: input.barcode,
      categoryId: input.categoryId,
      brandId,
      unitId: input.unitId,
      purchasePrice: input.purchasePrice,
      salePrice: input.salePrice,
      wholesalePrice: input.wholesalePrice,
      ...(input.depotCommissionRate !== undefined ? { depotCommissionRate: input.depotCommissionRate } : {}),
      ...(input.depotCommissionType !== undefined ? { depotCommissionType: input.depotCommissionType } : {}),
      isDepotProduct: depotProduct,
      minStock: input.minStock,
      trackBatch: input.trackBatch,
      openingStock: input.openingStock,
      openingRate: input.openingRate || input.purchasePrice,
    };
    let productId: string;
    if (existing && id) {
      if (existing.unitId !== input.unitId && (await tx.voucherItem.count({ where: { productId: id } })) > 0) {
        throw new UserError("লেনদেন হওয়া পণ্যের মূল ইউনিট পরিবর্তন করা যাবে না");
      }
      await tx.product.update({ where: { id }, data });
      productId = id;
    } else {
      productId = (await tx.product.create({ data: { ...data, businessId: ctx.businessId } })).id;
    }
    // replays the stock timeline; a depot product's opening stock is in the depot book
    await setOpeningStock(tx, ctx, productId, input.openingStock, data.openingRate, depotProduct ? "DEPOT" : "GENERAL");
    return productId;
  }, TX);
}

export async function deleteProduct(ctx: Ctx, id: string) {
  return prisma.$transaction(async (tx) => {
    const p = await tx.product.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!p) throw new UserError("পণ্য পাওয়া যায়নি");
    if ((await tx.voucherItem.count({ where: { productId: id } })) > 0) {
      throw new UserError("এই পণ্যের লেনদেন রয়েছে, তাই মুছা যাবে না। পরিবর্তে নিষ্ক্রিয় করুন।");
    }
    await setOpeningStock(tx, ctx, id, 0, 0);
    await tx.stockMovement.deleteMany({ where: { productId: id } });
    await tx.product.delete({ where: { id } });
    return p;
  }, TX);
}
