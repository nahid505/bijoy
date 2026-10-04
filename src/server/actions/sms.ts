"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { normalizeBdMobile } from "@/lib/mobile";
import { toBnDigits } from "@/lib/format";
import { AUTOMATIC_EVENTS, EDITABLE_EVENTS, renderTemplate, SMS_EVENT } from "@/lib/sms-text";
import { assertPermission } from "../auth";
import { audit } from "../audit";
import { guard, toResult, UserError, type ActionState } from "../action-utils";
import { businessToday } from "../services/notifications";
import { isBulk, sendManualSms, resolveRecipients, type SmsTarget } from "../sms/manual";
import { availableProviders } from "../sms/providers";
import { checkSmsBalance, enqueueSms, kickSmsQueue, processSmsMessage } from "../sms/queue";
import { encryptSecret, secretHint } from "../sms/secret";

const settingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.string().refine((v) => availableProviders().includes(v), "প্রোভাইডার নির্বাচন করুন"),
  apiKey: z.string().trim().max(500).optional(),
  clearApiKey: z.boolean(),
  senderId: z.string().trim().max(20, "সেন্ডার আইডি সর্বোচ্চ ২০ অক্ষর").regex(/^[A-Za-z0-9 ._-]*$/, "সেন্ডার আইডিতে শুধু ইংরেজি অক্ষর/সংখ্যা").optional(),
  lowBalanceThreshold: z.coerce.number().min(0).max(1_000_000),
  events: z.array(z.string()).transform((e) => e.filter((x) => AUTOMATIC_EVENTS.includes(x))),
  alertMobiles: z.string().max(500).transform((s, ctx) => {
    const list = s.split(/[,\s]+/).filter(Boolean);
    const out = list.map((m) => normalizeBdMobile(m));
    if (out.some((m) => !m)) ctx.addIssue({ code: "custom", message: "সতর্কতার মোবাইল নম্বর সঠিক নয়" });
    return [...new Set(out.filter((m): m is string => !!m))].slice(0, 5);
  }),
  expiryAlertDays: z.array(z.coerce.number().int().min(1).max(365)).max(8).transform((d) => [...new Set(d)].sort((a, b) => b - a)),
  dueReminderEveryDays: z.coerce.number().int().min(1, "কমপক্ষে ১ দিন").max(90),
});

/** Settings page. The API key is write-only: stored encrypted, shown back only as a hint. */
export async function saveSmsSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("sms:manage");
    const input = settingsSchema.parse({
      enabled: fd.get("enabled") === "on",
      provider: String(fd.get("provider") ?? ""),
      apiKey: String(fd.get("apiKey") ?? ""),
      clearApiKey: fd.get("clearApiKey") === "on",
      senderId: String(fd.get("senderId") ?? ""),
      lowBalanceThreshold: fd.get("lowBalanceThreshold") || 0,
      events: fd.getAll("events").map(String),
      alertMobiles: String(fd.get("alertMobiles") ?? ""),
      expiryAlertDays: fd.getAll("expiryAlertDays").map(String).filter((v) => v.trim() !== ""),
      dueReminderEveryDays: fd.get("dueReminderEveryDays") || 7,
    });
    const key = input.apiKey ? { apiKeyEnc: encryptSecret(input.apiKey), apiKeyHint: secretHint(input.apiKey) } : input.clearApiKey ? { apiKeyEnc: null, apiKeyHint: null } : {};
    const data = {
      enabled: input.enabled, provider: input.provider, senderId: input.senderId || null, lowBalanceThreshold: input.lowBalanceThreshold,
      events: input.events, alertMobiles: input.alertMobiles, expiryAlertDays: input.expiryAlertDays.length ? input.expiryAlertDays : [90, 60, 30, 15, 7],
      dueReminderEveryDays: input.dueReminderEveryDays, ...key,
    };
    if (input.enabled && !["platform", "mock"].includes(input.provider)) {
      const existing = await prisma.smsSettings.findUnique({ where: { businessId: ctx.business.id }, select: { apiKeyEnc: true } });
      if (!("apiKeyEnc" in key ? key.apiKeyEnc : existing?.apiKeyEnc)) throw new UserError("এই প্রোভাইডারের জন্য API কী দিন", { apiKey: ["API কী আবশ্যক"] });
    }
    await prisma.smsSettings.upsert({ where: { businessId: ctx.business.id }, create: { businessId: ctx.business.id, ...data }, update: data });
    await audit({
      businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: "SmsSettings", entityId: ctx.business.id,
      details: { ...data, apiKeyEnc: undefined, apiKeyChanged: !!input.apiKey, apiKeyCleared: input.clearApiKey }, // never log the key
    });
  });
  revalidatePath("/sms", "layout");
  return result.ok ? { ok: true, message: "এসএমএস সেটিং সংরক্ষণ হয়েছে" } : toResult(result);
}

/** Sends a test SMS right away (through the queue, so it is logged like every other SMS). */
export async function sendTestSmsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("sms:manage");
    const to = normalizeBdMobile(String(fd.get("testMobile") ?? ""));
    if (!to) throw new UserError("সঠিক মোবাইল নম্বর দিন", { testMobile: ["সঠিক মোবাইল নম্বর দিন"] });
    const q = await enqueueSms(prisma, {
      businessId: ctx.business.id, event: "TEST", recipient: to, priority: 10, maxAttempts: 1, createdById: ctx.user.id,
      body: renderTemplate(SMS_EVENT.TEST.defaultBody, { business_name: ctx.business.name }),
    });
    if (q.status !== "queued") throw new UserError(q.status === "skipped" ? q.reason : "আগেই পাঠানো হয়েছে");
    await processSmsMessage(prisma, q.id); // this message only, even if other SMS are waiting
    const m = await prisma.smsMessage.findUniqueOrThrow({ where: { id: q.id } });
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "CREATE", entity: "Sms", entityId: m.id, details: { test: true, to, status: m.status } });
    if (m.status === "FAILED" || m.status === "QUEUED") throw new UserError(`টেস্ট এসএমএস যায়নি: ${m.lastError ?? "অজানা ত্রুটি"}`);
    return to;
  });
  revalidatePath("/sms", "layout");
  return result.ok ? { ok: true, message: `${result.data} নম্বরে টেস্ট এসএমএস পাঠানো হয়েছে` } : toResult(result);
}

export async function refreshSmsBalanceAction(_prev?: ActionState, _fd?: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("sms:manage");
    const r = await checkSmsBalance(prisma, ctx.business.id);
    if (!r.ok) throw new UserError(r.message);
    return r.balance;
  });
  revalidatePath("/sms", "layout");
  return result.ok ? { ok: true, message: result.data === null ? "এই প্রোভাইডার ব্যালেন্স জানায় না" : `বর্তমান ব্যালেন্স: ${result.data}` } : toResult(result);
}

export async function saveSmsTemplateAction(event: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("sms:manage");
    if (!EDITABLE_EVENTS.some((e) => e.key === event)) throw new UserError("এই টেমপ্লেট পরিবর্তন করা যায় না");
    const body = String(fd.get("body") ?? "").trim();
    if (!body) throw new UserError("টেমপ্লেট খালি রাখা যাবে না", { body: ["টেমপ্লেট লিখুন"] });
    if (body.length > 600) throw new UserError("টেমপ্লেট খুব বড় (সর্বোচ্চ ৬০০ অক্ষর)", { body: ["সর্বোচ্চ ৬০০ অক্ষর"] });
    const before = await prisma.smsTemplate.findUnique({ where: { businessId_event: { businessId: ctx.business.id, event } } });
    await prisma.smsTemplate.upsert({ where: { businessId_event: { businessId: ctx.business.id, event } }, create: { businessId: ctx.business.id, event, body }, update: { body } });
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: "SmsTemplate", entityId: event, details: { before: before?.body ?? SMS_EVENT[event].defaultBody, after: body } });
  });
  revalidatePath("/sms/templates");
  return result.ok ? { ok: true, message: "টেমপ্লেট সংরক্ষণ হয়েছে" } : toResult(result);
}

export async function resetSmsTemplateAction(event: string, _prev?: ActionState, _fd?: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("sms:manage");
    await prisma.smsTemplate.deleteMany({ where: { businessId: ctx.business.id, event } });
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: "SmsTemplate", entityId: event, details: { reset: true } });
  });
  revalidatePath("/sms/templates");
  return result.ok ? { ok: true, message: "ডিফল্ট টেমপ্লেটে ফিরিয়ে আনা হয়েছে" } : toResult(result);
}

function parseTarget(fd: FormData): SmsTarget {
  const kind = String(fd.get("targetKind") ?? "customers");
  if (kind === "group") return { kind: "group", group: String(fd.get("group") ?? "").trim() };
  if (kind === "segment") {
    const segment = String(fd.get("segment") ?? "all");
    return { kind: "segment", segment: segment === "due" || segment === "overdue" ? segment : "all" };
  }
  return { kind: "customers", ids: [...new Set(String(fd.get("customerIds") ?? "").split(",").filter(Boolean))] };
}

/**
 * Manual / bulk SMS. One customer needs sms:send; several customers, a group or a segment need
 * sms:bulk. The form must echo the recipient count it showed in the confirmation dialog.
 */
export async function sendManualSmsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const target = parseTarget(fd);
    const ctx = await assertPermission(isBulk(target) ? "sms:bulk" : "sms:send");
    const today = businessToday();
    const recipients = await resolveRecipients(prisma, ctx.business.id, target, today);
    if (String(recipients.length) !== String(fd.get("confirmCount") ?? "")) {
      throw new UserError("প্রাপকের সংখ্যা পরিবর্তিত হয়েছে — পৃষ্ঠা নতুন করে খুলে আবার নিশ্চিত করুন");
    }
    return sendManualSms(prisma, { businessId: ctx.business.id, userId: ctx.user.id, businessName: ctx.business.name }, { target, message: String(fd.get("message") ?? "") }, today);
  });
  revalidatePath("/sms", "layout");
  if (!result.ok) return toResult(result);
  const r = result.data;
  const extra = [r.duplicates && `${toBnDigits(r.duplicates)} টি আগেই পাঠানো (বাদ)`, r.noMobile && `${toBnDigits(r.noMobile)} জনের মোবাইল নেই`, r.tooLong && `${toBnDigits(r.tooLong)} টি খুব বড়`].filter(Boolean).join(", ");
  return { ok: true, message: `${toBnDigits(r.queued)} টি এসএমএস পাঠানোর জন্য সারিতে রাখা হয়েছে${extra ? ` (${extra})` : ""}`, data: { batchId: r.batchId } };
}

/** Puts a FAILED message back into the queue (manual retry). */
export async function retrySmsAction(id: string, _prev?: ActionState, _fd?: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("sms:manage");
    const r = await prisma.smsMessage.updateMany({
      where: { id, businessId: ctx.business.id, status: "FAILED" },
      data: { status: "QUEUED", attempts: 0, nextAttemptAt: new Date(), lastError: null, failedAt: null },
    });
    if (r.count !== 1) throw new UserError("শুধু ব্যর্থ এসএমএস আবার পাঠানো যায়");
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: "Sms", entityId: id, details: { retry: true } });
    kickSmsQueue(prisma);
  });
  revalidatePath("/sms", "layout");
  return result.ok ? { ok: true, message: "আবার পাঠানোর জন্য সারিতে রাখা হয়েছে" } : toResult(result);
}
