// Platform SMS (account messages to business owners: payment, expiry). Uses the platform gateway
// configured by SMS_PROVIDER / SMS_API_KEY (the same one as security codes); skipped when not set.
// Logged in SmsMessage (businessId null) and deduplicated, never retried in a loop, never throws.
import type { PrismaClient } from "@prisma/client";
import { normalizeBdMobile } from "@/lib/mobile";
import { smsSegments } from "@/lib/sms-text";
import { createProvider, platformConfig, SmsProviderError } from "./providers";

export async function sendPlatformSms(db: PrismaClient, rawMobile: string, text: string, dedupeKey: string): Promise<"sent" | "skipped" | "failed"> {
  const cfg = platformConfig();
  const to = normalizeBdMobile(rawMobile);
  if (!cfg || !to) return "skipped";
  const seg = smsSegments(text);
  let log;
  try {
    log = await db.smsMessage.create({ data: { businessId: null, event: "ACCOUNT_NOTICE", recipient: to, body: text, encoding: seg.encoding, parts: seg.parts, status: "SENDING", attempts: 1, maxAttempts: 1, priority: 5, dedupeKey } });
  } catch {
    return "skipped"; // dedupe key already used: sent before
  }
  try {
    const provider = createProvider(cfg);
    const r = await provider.send({ to, text, encoding: seg.encoding, senderId: cfg.senderId });
    await db.smsMessage.update({ where: { id: log.id }, data: { status: r.status, provider: provider.id, requestId: r.requestId, cost: r.cost ?? null, sentAt: new Date() } });
    return "sent";
  } catch (e) {
    await db.smsMessage.update({ where: { id: log.id }, data: { status: "FAILED", provider: cfg.provider, lastError: e instanceof SmsProviderError ? e.message : "অজানা ত্রুটি", failedAt: new Date() } });
    return "failed";
  }
}
