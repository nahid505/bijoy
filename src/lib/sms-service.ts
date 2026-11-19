import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, SmsStatus } from "@prisma/client";
import { normalizeBdMobile } from "./mobile";
import { MAX_SMS_PARTS, smsSegments } from "./sms-text";

export interface SendWhatsAppOptions {
  url: string;
  token: string;
  to: string; // 017XXXXXXXX or 88017XXXXXXXX
  body: string;
  defaultCountryCode?: string;
}

export interface SendWhatsAppResult {
  success: boolean;
  messageId?: string;
  status?: "SENT" | "DELIVERED" | "FAILED";
  error?: string;
}

/**
 * Normalizes a Bangladeshi mobile number to WhatsApp international format:
 * `017XXXXXXXX` -> `88017XXXXXXXX`.
 * Strips non-digits and leading plus signs, ensuring standard E.164 country prefix.
 */
export function formatWhatsAppMobile(mobile: string | null | undefined, defaultCountryCode = "88"): string {
  if (!mobile) return "";
  const digits = mobile.replace(/[^0-9]/g, "");
  const cc = defaultCountryCode.replace(/[^0-9]/g, "") || "88";

  // Already 8801XXXXXXXXX (13 digits)
  if (digits.startsWith("8801") && digits.length === 13) {
    return digits;
  }

  // Local 11 digits: 01XXXXXXXXX
  if (digits.startsWith("01") && digits.length === 11) {
    return cc.endsWith("0") ? `${cc}${digits.slice(1)}` : `${cc}${digits}`;
  }

  // 10 digits without leading 0: 1XXXXXXXXX
  if (digits.length === 10 && digits.startsWith("1")) {
    return cc.endsWith("0") ? `${cc}${digits}` : `${cc}0${digits}`;
  }

  // If already starts with the country code
  if (digits.startsWith(cc) && digits.length > 8) {
    return digits;
  }

  return `${cc}${digits}`;
}

/**
 * Sends a WhatsApp message via UltraMsg, WaSender, or compatible WhatsApp HTTP gateways.
 */
export async function sendWhatsAppMessage(opts: SendWhatsAppOptions): Promise<SendWhatsAppResult> {
  const to = formatWhatsAppMobile(opts.to, opts.defaultCountryCode ?? "88");
  if (!to || to.length < 10) {
    return { success: false, error: "সঠিক মোবাইল নম্বর নেই" };
  }

  const text = (opts.body || "").trim();
  if (!text) {
    return { success: false, error: "বার্তা খালি" };
  }

  const endpoint = (opts.url || "").trim();
  const token = (opts.token || "").trim();

  if (!endpoint) {
    return { success: false, error: "WhatsApp API URL / Endpoint কনফিগার করা নেই" };
  }
  if (!token) {
    return { success: false, error: "WhatsApp API Token / Key কনফিগার করা নেই" };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);

  try {
    // UltraMsg and standard WhatsApp API gateways support form-urlencoded payload
    const form = new URLSearchParams({
      token,
      to,
      body: text,
    });

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json, text/plain, */*",
      },
      body: form.toString(),
      signal: ctrl.signal,
    });

    const raw = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(raw);
    } catch {
      data = { rawResponse: raw };
    }

    const isSent =
      data.sent === true ||
      data.sent === "true" ||
      data.success === true ||
      data.status === "success" ||
      (res.status >= 200 && res.status < 300 && !data.error);

    if (isSent) {
      const messageId = String(data.id || data.messageId || data.message_id || randomUUID());
      return {
        success: true,
        messageId,
        status: "SENT",
      };
    }

    const errorMsg =
      (typeof data.error === "string" && data.error) ||
      (typeof data.message === "string" && data.message) ||
      (typeof data.reason === "string" && data.reason) ||
      `HTTP ${res.status}: ${raw.slice(0, 100)}`;

    return {
      success: false,
      error: `WhatsApp ডেলিভারি ত্রুটি: ${errorMsg}`,
      status: "FAILED",
    };
  } catch (err: unknown) {
    const isAbort = (err as Error)?.name === "AbortError";
    const msg = isAbort ? "গেটওয়ে রেসপন্স পেতে সময় শেষ (Timeout)" : (err as Error)?.message || "নেটওয়ার্ক ত্রুটি";
    return {
      success: false,
      error: `WhatsApp সংযোগে সমস্যা: ${msg}`,
      status: "FAILED",
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface LogNotificationOptions {
  businessId: string | null;
  channel?: "SMS" | "WHATSAPP";
  provider?: string;
  event: string;
  recipient: string;
  body: string;
  status: SmsStatus;
  requestId?: string | null;
  lastError?: string | null;
  voucherId?: string | null;
  voucherNo?: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  createdById?: string | null;
}

/**
 * Logs a dispatched SMS or WhatsApp message into the SmsMessage database table.
 */
export async function logNotification(
  db: PrismaClient | Prisma.TransactionClient,
  opts: LogNotificationOptions
) {
  const seg = smsSegments(opts.body);
  const to = normalizeBdMobile(opts.recipient) || opts.recipient;

  return db.smsMessage.create({
    data: {
      businessId: opts.businessId,
      channel: opts.channel ?? "SMS",
      provider: opts.provider ?? (opts.channel === "WHATSAPP" ? "whatsapp" : "bulksmsbd"),
      event: opts.event,
      recipient: to,
      body: opts.body,
      encoding: seg.encoding,
      parts: seg.parts,
      status: opts.status,
      requestId: opts.requestId ?? null,
      lastError: opts.lastError ?? null,
      sentAt: opts.status === "SENT" || opts.status === "DELIVERED" ? new Date() : null,
      deliveredAt: opts.status === "DELIVERED" ? new Date() : null,
      voucherId: opts.voucherId ?? null,
      voucherNo: opts.voucherNo ?? null,
      customerId: opts.customerId ?? null,
      supplierId: opts.supplierId ?? null,
      createdById: opts.createdById ?? null,
    },
  });
}
