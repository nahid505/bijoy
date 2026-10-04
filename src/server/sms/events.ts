// Business events → SMS. Called AFTER the accounting transaction has committed; every entry point
// swallows its own errors (logged), so an SMS problem can never undo or fail a voucher.
import type { PrismaClient, VoucherType } from "@prisma/client";
import { round2 } from "@/lib/calc";
import { daysBetween } from "@/lib/expiry";
import { formatDate, formatNumber, formatQty, toBnDigits } from "@/lib/format";
import { renderTemplate, SMS_EVENT, type SmsVars } from "@/lib/sms-text";
import { partyAging } from "../services/aging";
import { enqueueSms, kickSmsQueue } from "./queue";

const money = (n: number) => formatNumber(round2(n)).replace(/\.০০$/, "");

export async function smsSettingsOf(db: PrismaClient, businessId: string) {
  return db.smsSettings.findUnique({ where: { businessId } });
}

export async function templateBody(db: PrismaClient, businessId: string, event: string): Promise<string> {
  const t = await db.smsTemplate.findUnique({ where: { businessId_event: { businessId, event } } });
  return t?.body ?? SMS_EVENT[event]?.defaultBody ?? "";
}

/** Is this automatic event switched on for the business (and SMS enabled)? */
async function eventEnabled(db: PrismaClient, businessId: string, event: string) {
  const s = await smsSettingsOf(db, businessId);
  return !!s?.enabled && s.events.includes(event);
}

async function ledgerBalance(db: PrismaClient, businessId: string, accountId: string) {
  const a = await db.journalEntry.aggregate({ where: { businessId, accountId }, _sum: { debit: true, credit: true } });
  return round2(Number(a._sum.debit ?? 0) - Number(a._sum.credit ?? 0));
}

const VOUCHER_EVENT: Partial<Record<VoucherType, string>> = {
  SALES: "SALE_INVOICE",
  SALES_RETURN: "SALES_RETURN",
  PURCHASE: "PURCHASE",
  PURCHASE_RETURN: "PURCHASE_RETURN",
  RECEIPT: "PAYMENT_RECEIVED",
  PAYMENT: "SUPPLIER_PAYMENT",
};

/** Queues the customer / supplier SMS for a newly saved voucher (edits never resend: dedupe). */
export async function smsForVoucher(db: PrismaClient, businessId: string, voucherId: string, actorId?: string | null) {
  try {
    const v = await db.voucher.findFirst({
      where: { id: voucherId, businessId },
      include: { business: { select: { name: true } }, partyAccount: { include: { customer: true, supplier: true } } },
    });
    if (!v) return null;
    const event = VOUCHER_EVENT[v.type];
    if (!event || !v.partyAccount) return null;
    const customer = v.partyAccount.customer;
    const supplier = v.partyAccount.supplier;
    // receipts only notify customers, payments only suppliers
    if ((event === "PAYMENT_RECEIVED" && !customer) || (event === "SUPPLIER_PAYMENT" && !supplier)) return null;
    if (!(await eventEnabled(db, businessId, event))) return null;
    const party = customer ?? supplier;
    if (!party?.mobile) return null;
    const bal = await ledgerBalance(db, businessId, v.partyAccount.id);
    const due = customer ? bal : -bal; // customer: receivable; supplier: payable
    const vars: SmsVars = {
      customer_name: customer?.name, supplier_name: supplier?.name, business_name: v.business.name, invoice_no: v.voucherNo,
      total: money(Number(v.amount)), paid: money(Number(v.paidAmount)), due: money(Math.max(0, due)), date: formatDate(v.date),
    };
    const r = await enqueueSms(db, {
      businessId, event, recipient: party.mobile, body: renderTemplate(await templateBody(db, businessId, event), vars),
      dedupeKey: `${businessId}:voucher:${v.id}:${event}`, customerId: customer?.id, supplierId: supplier?.id, voucherId: v.id, voucherNo: v.voucherNo, createdById: actorId,
    });
    if (r.status === "queued") kickSmsQueue(db);
    return r;
  } catch (e) {
    console.error("[sms] voucher SMS skipped:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** A deleted sales invoice = cancellation notice to the customer. */
export async function smsForCancelledInvoice(
  db: PrismaClient,
  businessId: string,
  v: { id: string; type: VoucherType; voucherNo: string; amount: number; date: Date; partyAccountId: string | null },
  actorId?: string | null,
) {
  try {
    if (v.type !== "SALES" || !v.partyAccountId) return null;
    if (!(await eventEnabled(db, businessId, "INVOICE_CANCELLED"))) return null;
    const customer = await db.customer.findFirst({ where: { accountId: v.partyAccountId, businessId }, include: { business: { select: { name: true } } } });
    if (!customer?.mobile) return null;
    const body = renderTemplate(await templateBody(db, businessId, "INVOICE_CANCELLED"), {
      customer_name: customer.name, invoice_no: v.voucherNo, total: money(v.amount), date: formatDate(v.date), business_name: customer.business.name,
    });
    const r = await enqueueSms(db, { businessId, event: "INVOICE_CANCELLED", recipient: customer.mobile, body, dedupeKey: `${businessId}:cancel:${v.id}`, customerId: customer.id, voucherNo: v.voucherNo, createdById: actorId });
    if (r.status === "queued") kickSmsQueue(db);
    return r;
  } catch (e) {
    console.error("[sms] cancellation SMS skipped:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Recipients for owner-facing alerts: configured numbers, else the business mobile. */
async function alertRecipients(db: PrismaClient, businessId: string, configured: string[]) {
  if (configured.length) return configured;
  const b = await db.business.findUnique({ where: { id: businessId }, select: { mobile: true } });
  return b?.mobile ? [b.mobile] : [];
}

/**
 * Daily SMS for one business (run by the daily check): due reminders, supplier statements,
 * low-stock and expiry alerts. Every message has a dedupe key, so re-running is harmless.
 */
export async function dailySms(db: PrismaClient, businessId: string, today: Date) {
  const out = { due: 0, supplier: 0, lowStock: 0, expiry: 0 };
  try {
    const s = await smsSettingsOf(db, businessId);
    if (!s?.enabled) return out;
    const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true } });
    const on = (e: string) => s.events.includes(e);
    const date = formatDate(today);
    const isoDay = today.toISOString().slice(0, 10);
    // at most one reminder per party every N days (rolling window, not calendar buckets)
    const windowStart = new Date(today.getTime() - (Math.max(1, s.dueReminderEveryDays) - 1) * 86_400_000);
    const recentlyReminded = async (event: string, where: { customerId?: string; supplierId?: string }) =>
      (await db.smsMessage.count({ where: { businessId, event, ...where, createdAt: { gte: windowStart } } })) > 0;

    if (on("DUE_REMINDER")) {
      const body = await templateBody(db, businessId, "DUE_REMINDER");
      for (const a of await partyAging(businessId, "CUSTOMER", today)) {
        if (a.overdue <= 0 || !a.mobile || (await recentlyReminded("DUE_REMINDER", { customerId: a.partyId }))) continue;
        const r = await enqueueSms(db, {
          businessId, event: "DUE_REMINDER", recipient: a.mobile, customerId: a.partyId,
          body: renderTemplate(body, { customer_name: a.name, due: money(a.balance), date, business_name: business.name }),
          dedupeKey: `${businessId}:due:${a.partyId}:${isoDay}`,
        });
        if (r.status === "queued") out.due++;
      }
    }
    if (on("SUPPLIER_DUE")) {
      const body = await templateBody(db, businessId, "SUPPLIER_DUE");
      for (const a of await partyAging(businessId, "SUPPLIER", today)) {
        if (a.balance <= 0 || !a.mobile || (await recentlyReminded("SUPPLIER_DUE", { supplierId: a.partyId }))) continue;
        const r = await enqueueSms(db, {
          businessId, event: "SUPPLIER_DUE", recipient: a.mobile, supplierId: a.partyId,
          body: renderTemplate(body, { supplier_name: a.name, due: money(a.balance), date, business_name: business.name }),
          dedupeKey: `${businessId}:supplierdue:${a.partyId}:${isoDay}`,
        });
        if (r.status === "queued") out.supplier++;
      }
    }

    const recipients = await alertRecipients(db, businessId, s.alertMobiles);
    if (recipients.length && on("LOW_STOCK")) {
      // one SMS per low-stock episode: tied to the open LOW_STOCK notification
      const lows = await db.notification.findMany({ where: { businessId, kind: "LOW_STOCK", resolvedAt: null }, include: { product: { select: { name: true, unit: { select: { name: true } } } } } });
      const body = await templateBody(db, businessId, "LOW_STOCK");
      for (const n of lows) {
        for (const to of recipients) {
          const r = await enqueueSms(db, {
            businessId, event: "LOW_STOCK", recipient: to,
            body: renderTemplate(body, { product_name: n.product?.name, quantity: `${formatQty(Number(n.quantity ?? 0))} ${n.product?.unit.name ?? ""}`, business_name: business.name }),
            dedupeKey: `${businessId}:lowstock:${n.id}:${to}`,
          });
          if (r.status === "queued") out.lowStock++;
        }
      }
    }
    if (recipients.length && (on("EXPIRY_WARNING") || on("EXPIRED"))) {
      const bands = [...s.expiryAlertDays].filter((d) => d > 0).sort((x, y) => x - y);
      const batches = await db.productBatch.findMany({
        where: { businessId, quantity: { gt: 0 }, expiryDate: { not: null } },
        include: { product: { select: { name: true, unit: { select: { name: true } } } } },
      });
      for (const b of batches) {
        const left = daysBetween(today, b.expiryDate!);
        const expired = left < 0;
        const band = expired ? null : bands.find((d) => left <= d);
        if ((expired && !on("EXPIRED")) || (!expired && (band === undefined || !on("EXPIRY_WARNING")))) continue;
        const event = expired ? "EXPIRED" : "EXPIRY_WARNING";
        const body = renderTemplate(await templateBody(db, businessId, event), {
          product_name: b.product.name, batch_no: b.batchNo, expiry_date: formatDate(b.expiryDate), days: toBnDigits(Math.max(0, left)),
          quantity: `${formatQty(Number(b.quantity))} ${b.product.unit.name}`, business_name: business.name,
        });
        for (const to of recipients) {
          const r = await enqueueSms(db, { businessId, event, recipient: to, body, dedupeKey: `${businessId}:expiry:${b.id}:${expired ? "expired" : `d${band}`}:${to}` });
          if (r.status === "queued") out.expiry++;
        }
      }
    }
    if (out.due + out.supplier + out.lowStock + out.expiry > 0) kickSmsQueue(db);
  } catch (e) {
    console.error("[sms] daily SMS failed for", businessId, e instanceof Error ? e.message : e);
  }
  return out;
}
