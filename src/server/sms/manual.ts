// Manual and bulk SMS to customers (single, selected, customer group or a dues segment).
// Safety: permission checked by the caller (sms:send for one, sms:bulk for more), max 500
// recipients, bulk jobs rate-limited per business, the same text never goes twice to the same
// number on the same day (dedupe key), every job is written to the audit log.
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { round2 } from "@/lib/calc";
import { UserError } from "@/lib/errors";
import { formatNumber, toBnDigits } from "@/lib/format";
import { normalizeBdMobile } from "@/lib/mobile";
import { MAX_SMS_PARTS, renderTemplate, smsSegments } from "@/lib/sms-text";
import { partyAging } from "../services/aging";
import { reserveAttempt } from "../services/login-guard";
import { enqueueSms, kickSmsQueue } from "./queue";

export const MAX_BULK_RECIPIENTS = 500;

export type SmsTarget =
  | { kind: "customers"; ids: string[] }
  | { kind: "group"; group: string }
  | { kind: "segment"; segment: "all" | "due" | "overdue" };

export interface Recipient {
  customerId: string;
  name: string;
  mobile: string | null;
  due: number;
}

/** allowed: the customer accounts an assigned-only user may reach (ctx.partyScope.customers; null = all). */
export async function resolveRecipients(db: PrismaClient, businessId: string, target: SmsTarget, today: Date, allowed: string[] | null = null): Promise<Recipient[]> {
  const scope = allowed ? { accountId: { in: allowed } } : {};
  const where =
    target.kind === "customers" ? { businessId, ...scope, id: { in: target.ids.slice(0, MAX_BULK_RECIPIENTS + 1) } }
    : target.kind === "group" ? { businessId, ...scope, isActive: true, groupName: target.group }
    : { businessId, ...scope, isActive: true };
  const customers = await db.customer.findMany({ where, orderBy: { name: "asc" }, select: { id: true, name: true, mobile: true, accountId: true } });
  const aging = new Map((await partyAging(businessId, "CUSTOMER", today, customers.map((c) => c.accountId))).map((a) => [a.accountId, a]));
  return customers
    .map((c) => ({ customerId: c.id, name: c.name, mobile: normalizeBdMobile(c.mobile), due: round2(aging.get(c.accountId)?.balance ?? 0), overdue: aging.get(c.accountId)?.overdue ?? 0 }))
    .filter((r) => target.kind !== "segment" || target.segment === "all" || (target.segment === "due" ? r.due > 0 : r.overdue > 0))
    .map(({ customerId, name, mobile, due }) => ({ customerId, name, mobile, due }));
}

export const isBulk = (target: SmsTarget) => target.kind !== "customers" || target.ids.length > 1;

export async function sendManualSms(
  db: PrismaClient,
  ctx: { businessId: string; userId: string; businessName: string; allowedCustomers?: string[] | null },
  input: { target: SmsTarget; message: string },
  today: Date,
  now = new Date(),
) {
  const settings = await db.smsSettings.findUnique({ where: { businessId: ctx.businessId } });
  if (!settings?.enabled) throw new UserError("এসএমএস চালু নেই — আগে এসএমএস সেটিং থেকে চালু করুন");
  const message = input.message.trim();
  if (!message) throw new UserError("বার্তা লিখুন");
  if (message.length > 1000) throw new UserError("বার্তা খুব বড়");

  const recipients = await resolveRecipients(db, ctx.businessId, input.target, today, ctx.allowedCustomers ?? null);
  if (recipients.length === 0) throw new UserError("কোনো প্রাপক পাওয়া যায়নি");
  if (recipients.length > MAX_BULK_RECIPIENTS) throw new UserError(`একবারে সর্বোচ্চ ${toBnDigits(MAX_BULK_RECIPIENTS)} জনকে পাঠানো যায়`);

  const bulk = isBulk(input.target);
  const until = bulk
    ? await reserveAttempt(db, `smsbulk:${ctx.businessId}`, { max: 10, windowMs: 60 * 60_000, lockMs: 60 * 60_000 }, now)
    : await reserveAttempt(db, `smssingle:${ctx.businessId}:${ctx.userId}`, { max: 60, windowMs: 60 * 60_000, lockMs: 15 * 60_000 }, now);
  if (until) throw new UserError(bulk ? "এক ঘণ্টায় অনেকবার বাল্ক এসএমএস পাঠানো হয়েছে — পরে চেষ্টা করুন" : "অনেক এসএমএস পাঠানো হয়েছে — কিছুক্ষণ পর চেষ্টা করুন");

  const batchId = randomUUID();
  const day = today.toISOString().slice(0, 10);
  const fingerprint = createHash("sha256").update(message).digest("hex").slice(0, 16);
  const result = { batchId, queued: 0, duplicates: 0, noMobile: 0, tooLong: 0, parts: 0 };
  const seen = new Set<string>();
  for (const r of recipients) {
    if (!r.mobile) {
      result.noMobile++;
      continue;
    }
    if (seen.has(r.mobile)) {
      result.duplicates++; // two customers sharing a number get one message
      continue;
    }
    seen.add(r.mobile);
    const body = renderTemplate(message, { customer_name: r.name, due: formatNumber(Math.max(0, r.due)).replace(/\.০০$/, ""), business_name: ctx.businessName });
    if (smsSegments(body).parts > MAX_SMS_PARTS) {
      result.tooLong++;
      continue;
    }
    const q = await enqueueSms(db, {
      businessId: ctx.businessId, event: "MANUAL", recipient: r.mobile, body, customerId: r.customerId, createdById: ctx.userId, batchId,
      dedupeKey: `${ctx.businessId}:manual:${fingerprint}:${r.mobile}:${day}`,
    });
    if (q.status === "queued") {
      result.queued++;
      result.parts += smsSegments(body).parts;
    } else if (q.status === "duplicate") result.duplicates++;
  }
  await db.auditLog.create({
    data: {
      businessId: ctx.businessId, userId: ctx.userId, action: "CREATE", entity: bulk ? "BulkSms" : "Sms", entityId: batchId,
      details: { target: input.target.kind === "customers" ? `${input.target.ids.length} customer(s)` : input.target.kind === "group" ? `group: ${input.target.group}` : `segment: ${input.target.segment}`, recipients: recipients.length, ...result, message: message.slice(0, 300) },
    },
  });
  if (result.queued) kickSmsQueue(db);
  return result;
}
