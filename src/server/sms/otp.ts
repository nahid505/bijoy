// One-time codes over SMS (registration, login second step, password reset).
//
//  • 6 digits from crypto.randomInt; only an HMAC of the code is stored (SmsOtp.codeHash)
//  • valid 5 minutes, 5 wrong tries per code, single use (consumed atomically)
//  • a new code invalidates older ones; 60 s resend cooldown; 3 codes / 15 min per number and
//    purpose; 10 / hour per client address (when known through a trusted proxy)
//  • sent immediately (not queued) — the SMS log stores the text with the code redacted
import { randomInt } from "node:crypto";
import type { OtpPurpose, PrismaClient } from "@prisma/client";
import { UserError } from "@/lib/errors";
import { normalizeBdMobile } from "@/lib/mobile";
import { renderTemplate, SMS_EVENT, smsSegments } from "@/lib/sms-text";
import { toBnDigits } from "@/lib/format";
import { reserveAttempt } from "../services/login-guard";
import { createProvider, platformConfig, SmsProviderError } from "./providers";
import { otpHash, safeEqual } from "./secret";

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000;

const EVENT: Record<OtpPurpose, string> = { REGISTRATION: "REGISTRATION_OTP", LOGIN: "LOGIN_OTP", PASSWORD_RESET: "PASSWORD_RESET_OTP" };

/** True when the server has SMS credentials for security codes. */
export const otpAvailable = () => platformConfig() !== null;

export async function issueOtp(db: PrismaClient, purpose: OtpPurpose, rawMobile: string, meta: { clientIp?: string | null; userId?: string | null } = {}, now = new Date()) {
  const mobile = normalizeBdMobile(rawMobile);
  if (!mobile) throw new UserError("সঠিক মোবাইল নম্বর দিন", { mobile: ["সঠিক মোবাইল নম্বর দিন"] });
  const cfg = platformConfig();
  if (!cfg) throw new UserError("এই মুহূর্তে এসএমএস কোড পাঠানো সম্ভব নয় — প্রশাসকের সাথে যোগাযোগ করুন");

  const last = await db.smsOtp.findFirst({ where: { mobile, purpose }, orderBy: { createdAt: "desc" } });
  if (last && now.getTime() - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (now.getTime() - last.createdAt.getTime())) / 1000);
    throw new UserError(`নতুন কোডের জন্য ${toBnDigits(wait)} সেকেন্ড অপেক্ষা করুন`);
  }
  const perNumber = await reserveAttempt(db, `otp:${purpose}:${mobile}`, { max: 3, windowMs: 15 * 60_000, lockMs: 15 * 60_000 }, now);
  const perIp = meta.clientIp ? await reserveAttempt(db, `otp:ip:${meta.clientIp}`, { max: 10, windowMs: 60 * 60_000, lockMs: 60 * 60_000 }, now) : null;
  if (perNumber || perIp) throw new UserError("অনেকবার কোড চাওয়া হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।");

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.smsOtp.updateMany({ where: { mobile, purpose, consumedAt: null }, data: { consumedAt: now } }); // older codes stop working
  const otp = await db.smsOtp.create({ data: { purpose, mobile, codeHash: otpHash(purpose, mobile, code), expiresAt: new Date(now.getTime() + OTP_TTL_MS), maxAttempts: OTP_MAX_ATTEMPTS, ipAddress: meta.clientIp ?? null } });

  const event = EVENT[purpose];
  const template = SMS_EVENT[event].defaultBody;
  const text = renderTemplate(template, { otp: code });
  const seg = smsSegments(text);
  const log = await db.smsMessage.create({
    data: { businessId: null, event, recipient: mobile, body: renderTemplate(template, { otp: "••••••" }), encoding: seg.encoding, parts: seg.parts, status: "SENDING", attempts: 1, maxAttempts: 1, priority: 10, userId: meta.userId ?? null, dedupeKey: `otp:${otp.id}` },
  });
  try {
    const provider = createProvider(cfg);
    const r = await provider.send({ to: mobile, text, encoding: seg.encoding, senderId: cfg.senderId });
    await db.smsMessage.update({ where: { id: log.id }, data: { status: r.status, provider: provider.id, requestId: r.requestId, cost: r.cost ?? null, sentAt: now, ...(r.status === "DELIVERED" ? { deliveredAt: now } : {}) } });
  } catch (e) {
    const msg = e instanceof SmsProviderError ? e.message : "অজানা ত্রুটি";
    await db.smsMessage.update({ where: { id: log.id }, data: { status: "FAILED", provider: cfg.provider, lastError: msg, failedAt: now } });
    await db.smsOtp.update({ where: { id: otp.id }, data: { consumedAt: now } });
    throw new UserError("কোড পাঠানো যায়নি — একটু পরে আবার চেষ্টা করুন");
  }
  return { expiresAt: otp.expiresAt, mobile };
}

/** Checks a code. Wrong codes count against the attempt limit; a correct code works once. */
export async function verifyOtp(db: PrismaClient, purpose: OtpPurpose, rawMobile: string, rawCode: string, now = new Date()): Promise<boolean> {
  const mobile = normalizeBdMobile(rawMobile);
  const code = String(rawCode ?? "").replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))).trim();
  if (!mobile || !/^\d{6}$/.test(code)) return false;
  const otp = await db.smsOtp.findFirst({ where: { mobile, purpose, consumedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } });
  if (!otp) return false;
  // count the try first (atomic), so parallel guesses cannot exceed the limit
  const counted = await db.smsOtp.updateMany({ where: { id: otp.id, consumedAt: null, attempts: { lt: otp.maxAttempts } }, data: { attempts: { increment: 1 } } });
  if (counted.count === 0) return false;
  if (!safeEqual(otp.codeHash, otpHash(purpose, mobile, code))) return false;
  const used = await db.smsOtp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: now } });
  return used.count === 1; // a second use of the same code fails here
}
