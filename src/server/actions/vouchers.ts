"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { VOUCHER_TYPES, type VoucherTypeKey } from "@/lib/accounting";
import { cashVoucherSchema, journalVoucherSchema, stockJournalSchema, tradeVoucherSchema } from "@/lib/validation";
import { prisma } from "@/lib/db";
import { assertPermission, ForbiddenError, getContext } from "../auth";
import { audit } from "../audit";
import { flash } from "../flash";
import { guard, parseJsonPayload, toResult, UserError, type ActionState } from "../action-utils";
import { voucherAccess } from "../voucher-permissions";
import type { BookKey } from "@/lib/book";
import { isDepot } from "@/lib/depot";
import { assertEntryDate, originalEntryDate } from "../entry-date";
import { smsForCancelledInvoice, smsForVoucher } from "../sms/events";
import { deleteVoucher, saveCashVoucher, saveJournalVoucher, saveStockJournal, saveTradeVoucher, voucherSnapshot } from "../services/voucher";
import { assertPartiesAllowed, assertVoucherAllowed } from "../party-scope";

type EditableType = Exclude<VoucherTypeKey, "OPENING">;

/**
 * Create (id = null) or edit any voucher type. Payload is JSON in the "payload" field.
 * Optional "then": "print" → open the printable invoice/receipt, "pos" → back to a fresh POS screen.
 */
export async function saveVoucherAction(type: EditableType, id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return saveVoucher(type, id, fd);
}

/** A NEW depot-book voucher (depot stock in / market collection / company payment — src/lib/book.ts). */
export async function saveDepotVoucherAction(type: EditableType, id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return saveVoucher(type, id, fd, "DEPOT");
}

async function saveVoucher(type: EditableType, id: string | null, fd: FormData, newBook?: BookKey): Promise<ActionState> {
  const result = await guard(async () => {
    const base = await getContext();
    if (!base) throw new ForbiddenError();
    if (newBook === "DEPOT" && !isDepot(base.business.businessType)) throw new UserError("ডিপো হিসাব শুধু ডিপো ব্যবসায়");
    // an edit keeps the voucher's own book; the depot permissions open depot-book vouchers only
    const book: BookKey = id
      ? ((await prisma.voucher.findFirst({ where: { id, businessId: base.business.id }, select: { book: true } }))?.book ?? "GENERAL")
      : newBook ?? "GENERAL";
    const ctx = await assertPermission(voucherAccess(type, id ? "edit" : "create", base.business.businessType, book));
    await assertVoucherAllowed(ctx, id); // assigned-only roles: only their parties' vouchers
    const before = id ? await voucherSnapshot(ctx.business.id, id) : null;
    const editId = id ?? undefined;
    // date lock (transaction:change_date): new entries today, edits keep their date
    const original = await originalEntryDate(ctx.business.id, id);
    let voucher;
    switch (type) {
      case "SALES":
      case "PURCHASE":
      case "SALES_RETURN":
      case "PURCHASE_RETURN":
        {
          const input = parseJsonPayload(tradeVoucherSchema, fd);
          assertEntryDate(ctx, input.date, original);
          await assertPartiesAllowed(ctx, [input.partyAccountId, ...input.payments.map((p) => p.accountId)]);
          if (!id && !ctx.features.includes("MULTI_WAREHOUSE")) input.warehouseId = null; // → main warehouse
          voucher = await saveTradeVoucher(ctx.svc, type, input, editId, book);
          if (book === "DEPOT" && type === "SALES") {
            const challan = {
              mode: "DEPOT_COLLECTION" as const,
              doNumber: input.reference ?? null,
              dealerAccountId: input.partyAccountId ?? null,
              companyAccountId: null,
              warehouseId: input.warehouseId ?? null,
              vehicleNo: null,
              driverName: null,
              notes: input.narration ?? null,
              commissionTotal: 0,
            };
            await prisma.depotDelivery.upsert({
              where: { voucherId: voucher.id },
              create: { ...challan, voucherId: voucher.id, businessId: ctx.business.id },
              update: challan,
            });
            const items = await prisma.voucherItem.findMany({ where: { voucherId: voucher.id }, select: { id: true, rate: true } });
            for (const it of items) {
              await prisma.voucherItem.update({ where: { id: it.id }, data: { challanRate: it.rate } });
            }
          }
        }
        break;
      case "RECEIPT":
      case "PAYMENT":
        {
          const input = parseJsonPayload(cashVoucherSchema, fd);
          assertEntryDate(ctx, input.date, original);
          await assertPartiesAllowed(ctx, [input.cashAccountId, ...input.lines.map((l) => l.accountId)]);
          voucher = await saveCashVoucher(ctx.svc, type, input, editId, book);
        }
        break;
      case "JOURNAL":
        {
          const input = parseJsonPayload(journalVoucherSchema, fd);
          assertEntryDate(ctx, input.date, original);
          await assertPartiesAllowed(ctx, input.lines.map((l) => l.accountId));
          voucher = await saveJournalVoucher(ctx.svc, input, editId, book);
        }
        break;
      case "STOCK_JOURNAL":
        {
          const input = parseJsonPayload(stockJournalSchema, fd);
          assertEntryDate(ctx, input.date, original);
          if (!id && !ctx.features.includes("MULTI_WAREHOUSE")) {
            const main = await mainWarehouseId(ctx.business.id);
            input.lines = input.lines.map((l) => ({ ...l, warehouseId: main }));
          }
          voucher = await saveStockJournal(ctx.svc, input, editId, book);
        }
        break;
      default:
        throw new UserError("অজানা ভাউচার");
    }
    await audit({
      businessId: ctx.business.id, userId: ctx.user.id, action: id ? "UPDATE" : "CREATE", entity: "Voucher", entityId: voucher.id,
      details: { type, voucherNo: voucher.voucherNo, amount: Number(voucher.amount), ...(before ? { before } : {}) },
    });
    return voucher;
  });
  if (!result.ok) return toResult(result);
  const v = result.data;
  // The voucher is committed. SMS is queued separately and never affects it (errors are logged).
  if (!id) {
    const c = await getContext();
    if (c) await smsForVoucher(prisma, c.business.id, v.id, c.user.id);
  }
  await flash(v.book === "DEPOT" && type === "SALES" ? `ডিপো ডেলিভারি চালান ${v.voucherNo} সংরক্ষণ হয়েছে` : `${VOUCHER_TYPES[type].long} ${v.voucherNo} সংরক্ষণ হয়েছে`);
  revalidatePath("/", "layout");
  const then = fd.get("then");
  if (then === "print") redirect(fd.get("from") === "dealer-challan" || v.book === "DEPOT" ? `/vouchers/v/${v.id}/print?challan=1` : `/vouchers/v/${v.id}/print`);
  if (then === "pos") redirect(`/pos?last=${v.id}`);
  if (then === "dealer-challan") redirect(`/depot/deliveries?last=${v.id}`);
  redirect(`/vouchers/v/${v.id}`);
}

export async function deleteVoucherAction(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  let slug = "";
  let label = "";
  const cancelled: { v: (Parameters<typeof smsForCancelledInvoice>[2] & { businessId: string; userId: string }) | null } = { v: null };
  const result = await guard(async () => {
    const base = await getContext();
    if (!base) throw new ForbiddenError();
    const v = await prisma.voucher.findFirst({ where: { id, businessId: base.business.id }, select: { type: true, book: true } });
    if (!v || v.type === "OPENING") throw new UserError("ভাউচার পাওয়া যায়নি");
    const ctx = await assertPermission(voucherAccess(v.type, "delete", base.business.businessType, v.book));
    await assertVoucherAllowed(ctx, id);
    const before = await voucherSnapshot(ctx.business.id, id); // full posting snapshot kept in the audit log
    const party = await prisma.voucher.findFirst({ where: { id, businessId: ctx.business.id }, select: { partyAccountId: true, date: true } });
    const deleted = await deleteVoucher(ctx.svc, id);
    cancelled.v = { id, type: deleted.type, voucherNo: deleted.voucherNo, amount: Number(deleted.amount), date: party?.date ?? deleted.date, partyAccountId: party?.partyAccountId ?? null, businessId: ctx.business.id, userId: ctx.user.id };
    slug = VOUCHER_TYPES[deleted.type].slug;
    label = `${VOUCHER_TYPES[deleted.type].long} ${deleted.voucherNo}`;
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "DELETE", entity: "Voucher", entityId: id, details: { type: deleted.type, voucherNo: deleted.voucherNo, amount: Number(deleted.amount), before } });
  });
  if (!result.ok) return toResult(result);
  if (cancelled.v) await smsForCancelledInvoice(prisma, cancelled.v.businessId, cancelled.v, cancelled.v.userId); // after the delete committed
  await flash(`${label} মুছে ফেলা হয়েছে — স্টক ও হিসাব পুনর্গণনা করা হয়েছে`);
  revalidatePath("/", "layout");
  redirect(slug === "production" ? "/production" : `/vouchers/${slug}`);
}

/** The default warehouse (single-warehouse mode). */
async function mainWarehouseId(businessId: string) {
  const w = await prisma.warehouse.findFirst({ where: { businessId }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true } }); // same order as the voucher forms
  if (!w) throw new UserError("কোনো গুদাম নেই");
  return w.id;
}
