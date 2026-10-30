import "server-only";
import { daysBetween } from "@/lib/expiry";
import type { Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { round3 } from "@/lib/calc";
import { toDateInput } from "@/lib/format";
import { VOUCHER_TYPES, type VoucherTypeKey } from "@/lib/accounting";
import { accountScopeWhere, voucherScopeWhere } from "./party-scope";
import { bookAccountWhere } from "./services/accounting";
import {
  CashVoucherForm,
  JournalVoucherForm,
  StockJournalForm,
  TradeVoucherForm,
  type AccountOption,
  type TradeDefaults,
} from "@/components/voucher-forms";
import type { AppContext } from "./auth";
import { canChangeEntryDate } from "./entry-date";
import { isDepot, commissionPerUnit } from "@/lib/depot";
import { balancesBefore } from "./services/ledger";
import { availableBatches } from "./services/inventory";
import { saveDepotVoucherAction, saveVoucherAction } from "./actions/vouchers";
import type { BookKey } from "@/lib/book";
import { searchParties } from "./lookup";

type EditableType = Exclude<VoucherTypeKey, "OPENING">;

/** Ledger options; `includeInactive` for accounts already used on a voucher being edited. */
export async function accountOptions(businessId: string, where: Prisma.AccountWhereInput, withBalance = true, includeInactive = false, book: BookKey = "GENERAL"): Promise<AccountOption[]> {
  const rows = await prisma.account.findMany({
    where: { businessId, ...(includeInactive ? {} : { isActive: true }), ...where },
    include: { group: { select: { name: true, sortOrder: true } } },
    orderBy: [{ group: { sortOrder: "asc" } }, { name: "asc" }],
  });
  const bal = withBalance ? await balancesBefore(businessId, undefined, rows.map((r) => r.id), book) : new Map<string, number>();
  return rows.map((r) => ({ id: r.id, name: r.name, group: r.group.name, ...(withBalance ? { balance: bal.get(r.id) ?? 0 } : {}) }));
}

/**
 * Units, warehouses, batches and products for inventory forms. With `productIds` only those products
 * are loaded (voucher forms search the rest on demand); without it, every active product (POS tiles).
 */
export async function inventoryOptions(businessId: string, opts: { productIds?: string[]; includeProductIds?: string[]; book?: BookKey } = {}) {
  const today = new Date(`${toDateInput()}T00:00:00.000Z`);
  const isDepotProduct = opts.book === "DEPOT";
  let where: Prisma.ProductWhereInput = opts.productIds
    ? { businessId, id: { in: [...new Set(opts.productIds)] } }
    : opts.includeProductIds?.length
      ? { businessId, isActive: true, OR: [{ isDepotProduct }, { id: { in: opts.includeProductIds } }] }
      : { businessId, isActive: true, isDepotProduct };

  if (!opts.productIds && isDepotProduct) {
    const hasDepot = await prisma.product.count({ where: { businessId, isActive: true, isDepotProduct: true } });
    if (hasDepot === 0) {
      where = opts.includeProductIds?.length
        ? { businessId, isActive: true, OR: [{ id: { in: opts.includeProductIds } }, { isActive: true }] }
        : { businessId, isActive: true };
    }
  }

  const [products, units, warehouses, batches, categories] = await Promise.all([
    // without ids (POS tiles): depot products for depot book, general products for general book
    prisma.product.findMany({
      where,
      include: { category: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.unit.findMany({ where: { businessId }, orderBy: { name: "asc" } }),
    prisma.warehouse.findMany({ where: { businessId }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    availableBatches(prisma, businessId),
    prisma.category.findMany({ where: { businessId }, orderBy: { name: "asc" } }),
  ]);
  return {
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      barcode: p.barcode,
      unitId: p.unitId,
      trackBatch: p.trackBatch,
      categoryId: p.categoryId,
      categoryName: p.category?.name ?? null,
      salePrice: num(p.salePrice),
      wholesalePrice: num(p.wholesalePrice),
      purchasePrice: num(p.purchasePrice),
      avgCost: num(p.avgCost),
      stock: num(p.stock),
      ...(p.depotCommissionRate !== null && p.depotCommissionRate !== undefined
        ? {
            depotCommissionRate: commissionPerUnit({
              depotCommissionType: p.depotCommissionType,
              depotCommissionRate: num(p.depotCommissionRate),
              purchasePrice: num(p.purchasePrice),
            }),
          }
        : {}),
    })),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    units: units.map((u) => ({ id: u.id, name: u.name, baseUnitId: u.baseUnitId, factor: num(u.factor) })),
    warehouses: warehouses.map((w) => ({ id: w.id, name: w.name })),
    batches: batches.map((b) => ({
      productId: b.productId,
      warehouseId: b.warehouseId,
      batchNo: b.batchNo,
      quantity: b.quantity,
      expiryDate: b.expiryDate ? toDateInput(b.expiryDate) : null,
      daysLeft: b.expiryDate ? daysBetween(today, b.expiryDate) : null,
    })),
  };
}

const slugOf = (type: EditableType) => VOUCHER_TYPES[type].slug;

/** Loads options and (for edits / returns) the existing data, then renders the right form. */
export async function VoucherEditor({
  ctx,
  type,
  voucherId,
  partyAccountId,
  fromInvoiceId,
  mode,
  cancelTo,
  book: newBook,
}: {
  ctx: AppContext;
  type: EditableType;
  voucherId?: string;
  partyAccountId?: string;
  fromInvoiceId?: string;
  mode?: string;
  /** where "বাতিল" goes on a new voucher (default: the voucher list) */
  cancelTo?: string;
  /** book of a NEW voucher (depot pages: DEPOT); an existing voucher keeps its own */
  book?: BookKey;
}) {
  const businessId = ctx.business.id;
  const currency = ctx.business.currencySymbol;
  const existing = voucherId
    ? await prisma.voucher.findFirst({
        where: { id: voucherId, businessId },
        include: { items: { orderBy: { lineNo: "asc" }, include: { batch: { select: { mfgDate: true } } } }, entries: { orderBy: { lineNo: "asc" } }, payments: { orderBy: { lineNo: "asc" } }, returnOf: { select: { voucherNo: true } } },
      })
    : null;
  // a return against an invoice is in that invoice's book (depot stock in / market sale → DEPOT)
  const fromBook = !existing && fromInvoiceId ? (await prisma.voucher.findFirst({ where: { id: fromInvoiceId, businessId }, select: { book: true } }))?.book : undefined;
  const book: BookKey = existing?.book ?? fromBook ?? newBook ?? "GENERAL";
  const depot = book === "DEPOT";
  const pickerBook = depot ? ("depot" as const) : undefined;
  const action = !existing && depot ? saveDepotVoucherAction.bind(null, type, null) : saveVoucherAction.bind(null, type, voucherId ?? null);
  const date = existing ? toDateInput(existing.date) : toDateInput();
  // no transaction:change_date permission: new entries are dated today, edits keep their date
  const dateLocked = !canChangeEntryDate(ctx);
  const cancelHref = existing ? `/vouchers/v/${existing.id}` : cancelTo ?? `/vouchers/${slugOf(type)}`;

  if (type === "SALES" || type === "PURCHASE" || type === "SALES_RETURN" || type === "PURCHASE_RETURN") {
    const partyKind = type === "SALES" || type === "SALES_RETURN" ? "CUSTOMER" : "SUPPLIER";
    let defaults: TradeDefaults;
    if (existing) {
      defaults = {
        date, dateLocked, reference: existing.reference ?? "", narration: existing.narration ?? "", partyAccountId: existing.partyAccountId ?? "", warehouseId: existing.warehouseId ?? "",
        discount: num(existing.discount), vatPercent: num(existing.vatPercent), dueDate: existing.dueDate ? toDateInput(existing.dueDate) : "",
        returnOfId: existing.returnOfId ?? "", returnOfNo: existing.returnOf?.voucherNo ?? "",
        payments: existing.payments.map((p) => ({ accountId: p.accountId, amount: num(p.amount), reference: p.reference ?? "" })),
        items: existing.items.map((i) => ({ productId: i.productId, unitId: i.unitId ?? "", quantity: num(i.quantity), freeQuantity: num(i.freeQuantity), rate: num(i.rate), discount: num(i.discount), batchNo: i.batchNo ?? "", expiryDate: i.expiryDate ? toDateInput(i.expiryDate) : "", mfgDate: i.batch?.mfgDate ? toDateInput(i.batch.mfgDate) : "" })),
      };
    } else if (fromInvoiceId && (type === "SALES_RETURN" || type === "PURCHASE_RETURN")) {
      // Return against an invoice: prefill remaining returnable quantities at the invoiced rates.
      const original = await prisma.voucher.findFirst({
        where: { id: fromInvoiceId, businessId, type: type === "SALES_RETURN" ? "SALES" : "PURCHASE", ...voucherScopeWhere(ctx) },
        include: {
          items: { orderBy: { lineNo: "asc" }, include: { stockMovements: { include: { batch: { select: { batchNo: true, expiryDate: true } } }, orderBy: { createdAt: "asc" } } } },
          returns: { include: { items: true } },
        },
      });
      const returned = new Map<string, number>();
      for (const r of original?.returns ?? []) for (const i of r.items) returned.set(i.productId, round3((returned.get(i.productId) ?? 0) + num(i.baseQuantity)));
      // a FEFO line may have used several batches: offer one return line per batch
      const parts = (original?.items ?? []).flatMap((i) => {
        const batched = i.stockMovements.filter((m) => m.batch);
        return batched.length
          ? batched.map((m) => ({ item: i, base: num(m.quantityIn) || num(m.quantityOut), batchNo: m.batch!.batchNo, expiry: m.batch!.expiryDate }))
          : [{ item: i, base: num(i.baseQuantity), batchNo: i.batchNo ?? "", expiry: i.expiryDate }];
      });
      const items = parts
        .map(({ item: i, base, batchNo, expiry }) => {
          const already = Math.min(returned.get(i.productId) ?? 0, base);
          returned.set(i.productId, round3((returned.get(i.productId) ?? 0) - already));
          const leftBase = round3(base - already);
          const factor = num(i.unitFactor) || 1;
          return { productId: i.productId, unitId: i.unitId ?? "", quantity: round3(leftBase / factor), rate: num(i.rate), discount: 0, batchNo, expiryDate: expiry ? toDateInput(expiry) : "", maxQty: round3(leftBase / factor) };
        })
        .filter((i) => i.quantity > 0);
      defaults = {
        date, dateLocked, reference: original?.voucherNo ?? "", narration: original ? `${original.voucherNo} এর বিপরীতে ফেরত` : "", partyAccountId: original?.partyAccountId ?? "",
        warehouseId: original?.warehouseId ?? "", discount: 0, vatPercent: 0, dueDate: "", returnOfId: original?.id ?? "", returnOfNo: original?.voucherNo ?? "", payments: [], items,
      };
    } else {
      defaults = {
        date, dateLocked, reference: "", narration: "", partyAccountId: partyAccountId ?? "",
        warehouseId: "", discount: 0, vatPercent: type === "SALES" ? ctx.business.defaultVatPercent : 0, dueDate: "", returnOfId: "", returnOfNo: "", payments: [], items: [],
      };
    }
    const isDepotStockIn = depot && type === "PURCHASE";
    // only the party and products already on the voucher are sent; the pickers search the rest
    const [parties, cashAccounts, inv] = await Promise.all([
      defaults.partyAccountId ? searchParties(businessId, partyKind, "", { accountIds: [defaults.partyAccountId], allowed: partyKind === "CUSTOMER" ? ctx.partyScope.customers : ctx.partyScope.suppliers, dealer: depot && partyKind === "CUSTOMER", book }) : Promise.resolve([]),
      accountOptions(businessId, { kind: { in: ["CASH", "BANK"] }, ...accountScopeWhere(ctx) }, true, false, book),
      inventoryOptions(businessId, isDepotStockIn ? { book, includeProductIds: defaults.items.map((i) => i.productId) } : { productIds: defaults.items.map((i) => i.productId) }),
    ]);
    if (defaults.partyAccountId && parties.length === 0) defaults = { ...defaults, partyAccountId: "" }; // ?party= of another business / kind
    return (
      <TradeVoucherForm
        kind={type}
        action={action}
        parties={parties}
        cashAccounts={cashAccounts}
        {...warehousesFor(ctx, inv, [defaults.warehouseId])}
        defaults={defaults}
        currency={currency}
        cancelHref={cancelHref}
        allowExpiredSale={ctx.business.allowExpiredSale}
        showFree={isDepot(ctx.business.businessType) && (type === "PURCHASE" || type === "SALES")}
        book={pickerBook}
        categories={inv.categories}
        productGrid={isDepotStockIn}
      />
    );
  }

  if (type === "RECEIPT" || type === "PAYMENT") {
    const expenseMode = type === "PAYMENT" && mode === "expense";
    const cashId = existing?.cashAccountId ?? "";
    const lineIds = existing ? existing.entries.filter((e) => e.accountId !== cashId).map((e) => e.accountId) : partyAccountId ? [partyAccountId] : [];
    // cash / bank ledgers are few (they are the default and the quick choices); of the other ledgers only
    // those already on the voucher are sent — the line pickers search the rest on the server
    const [cashAccounts, accounts] = await Promise.all([
      accountOptions(businessId, { kind: { in: ["CASH", "BANK"] }, ...accountScopeWhere(ctx) }, true, false, book),
      lineIds.length ? accountOptions(businessId, { id: { in: lineIds }, AND: [accountScopeWhere(ctx), bookAccountWhere(book)] }, true, true, book) : Promise.resolve([]),
    ]);
    const lines = existing
      ? existing.entries.filter((e) => e.accountId !== cashId).map((e) => ({ accountId: e.accountId, amount: num(type === "RECEIPT" ? e.credit : e.debit), narration: e.narration ?? "" }))
      : partyAccountId && accounts.some((a) => a.id === partyAccountId) ? [{ accountId: partyAccountId, amount: 0, narration: "" }] : [];
    return (
      <CashVoucherForm
        kind={type}
        action={action}
        cashAccounts={cashAccounts}
        accounts={accounts}
        currency={currency}
        cancelHref={expenseMode ? "/expenses" : cancelHref}
        expenseMode={expenseMode}
        book={pickerBook}
        defaults={{ date, dateLocked, reference: existing?.reference ?? "", narration: existing?.narration ?? "", cashAccountId: cashId, lines }}
      />
    );
  }

  if (type === "JOURNAL") {
    const ids = [...new Set(existing?.entries.map((e) => e.accountId) ?? [])];
    const accounts = ids.length ? await accountOptions(businessId, { id: { in: ids } }, false, true) : [];
    return (
      <JournalVoucherForm
        action={action}
        accounts={accounts}
        currency={currency}
        cancelHref={cancelHref}
        defaults={{
          date, dateLocked, reference: existing?.reference ?? "", narration: existing?.narration ?? "",
          lines: existing?.entries.map((e) => ({ accountId: e.accountId, debit: num(e.debit), credit: num(e.credit), narration: e.narration ?? "" })) ?? [],
        }}
      />
    );
  }

  const inv = await inventoryOptions(businessId, { productIds: existing?.items.map((i) => i.productId) ?? [] });
  return (
    <StockJournalForm
      action={action}
      book={pickerBook}
      {...warehousesFor(ctx, inv, existing?.items.map((i) => i.warehouseId ?? "") ?? [])}
      currency={currency}
      cancelHref={cancelHref}
      defaults={{
        date, dateLocked, reference: existing?.reference ?? "", narration: existing?.narration ?? "",
        lines: existing?.items.map((i) => ({
          productId: i.productId, warehouseId: i.warehouseId ?? "", direction: i.direction === 1 ? 1 : -1, quantity: num(i.quantity), rate: i.direction === 1 ? num(i.rate) : null,
          batchNo: i.batchNo ?? "", expiryDate: i.expiryDate ? toDateInput(i.expiryDate) : "", mfgDate: i.batch?.mfgDate ? toDateInput(i.batch.mfgDate) : "",
        })) ?? [],
      }}
    />
  );
}

/** Multi Warehouse off: forms offer the main warehouse (first) and any warehouse already on the voucher. */
function warehousesFor<T extends { warehouses: { id: string }[] }>(ctx: AppContext, inv: T, keep: string[]): T {
  if (ctx.features.includes("MULTI_WAREHOUSE")) return inv;
  return { ...inv, warehouses: inv.warehouses.filter((w, i) => i === 0 || keep.includes(w.id)) };
}
