// Self-service sign-up: creates the owner's login AND a fully configured, isolated business
// (chart of accounts, system ledgers, units, warehouse, roles, settings) in ONE transaction.
//
// Abuse protection (stored in PostgreSQL via AuthThrottle, shared by every app instance):
//   • per client address (only when known through a trusted proxy): 5 sign-ups / hour
//   • per mobile number: 5 attempts / hour (stops hammering a number)
//   • whole site: REGISTRATION_HOURLY_LIMIT sign-ups / hour (default 30) — a ceiling that holds
//     even when client addresses are unknown or spoofed
// Duplicate mobiles / e-mails are refused; the unique indexes make this race-safe.
import bcrypt from "bcryptjs";
import { Prisma, type PrismaClient } from "@prisma/client";
import { UserError } from "@/lib/errors";
import { toBnDigits } from "@/lib/format";
import type { RegistrationInput } from "@/lib/validation";
import { createBusiness } from "./bootstrap";
import { reserveAttempt } from "./login-guard";

const HOUR = 60 * 60_000;

export function registrationPolicy(env: Record<string, string | undefined> = process.env) {
  const hourly = Number.parseInt(env.REGISTRATION_HOURLY_LIMIT ?? "30", 10);
  return {
    enabled: env.REGISTRATION_ENABLED !== "false",
    ip: { max: 5, windowMs: HOUR, lockMs: HOUR },
    mobile: { max: 5, windowMs: HOUR, lockMs: HOUR },
    site: { max: Number.isFinite(hourly) && hourly > 0 ? hourly : 30, windowMs: HOUR, lockMs: 15 * 60_000 },
  };
}

const tooMany = (until: Date, now: Date) =>
  new UserError(`অনেকবার অ্যাকাউন্ট তৈরির চেষ্টা হয়েছে। ${toBnDigits(Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000)))} মিনিট পর আবার চেষ্টা করুন।`);

export async function registerAccount(db: PrismaClient, input: RegistrationInput, meta: { clientIp: string | null; now?: Date }) {
  const policy = registrationPolicy();
  if (!policy.enabled) throw new UserError("এই মুহূর্তে নতুন অ্যাকাউন্ট খোলা বন্ধ আছে। প্রশাসকের সাথে যোগাযোগ করুন।");
  const now = meta.now ?? new Date();

  // throttles: every validated submission counts, successful or not
  if (meta.clientIp) {
    const until = await reserveAttempt(db, `register:ip:${meta.clientIp}`, policy.ip, now);
    if (until) throw tooMany(until, now);
  }
  const mobileUntil = await reserveAttempt(db, `register:mobile:${input.mobile}`, policy.mobile, now);
  if (mobileUntil) throw tooMany(mobileUntil, now);
  const siteUntil = await reserveAttempt(db, "register:site", policy.site, now);
  if (siteUntil) throw tooMany(siteUntil, now);

  // friendly duplicate messages (the unique indexes below are the real guarantee)
  if (await db.user.findUnique({ where: { mobile: input.mobile }, select: { id: true } })) {
    throw new UserError("এই মোবাইল নম্বর দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে — লগইন করুন", { mobile: ["এই মোবাইল নম্বর দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে"] });
  }
  if (input.email && (await db.user.findUnique({ where: { email: input.email }, select: { id: true } }))) {
    throw new UserError("এই ইমেইল দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে", { email: ["এই ইমেইল দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে"] });
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    return await db.$transaction(
      async (tx) => {
        const user = await tx.user.create({ data: { name: input.ownerName, mobile: input.mobile, email: input.email, passwordHash } });
        const business = await createBusiness(tx, { name: input.businessName, ownerUserId: user.id, mobile: input.mobile, address: input.address, planCode: input.plan }); // business types: chosen later in settings
        if (input.email) await tx.business.update({ where: { id: business.id }, data: { email: input.email } });
        await tx.auditLog.create({
          data: { businessId: business.id, userId: user.id, action: "CREATE", entity: "Registration", entityId: business.id, ipAddress: meta.clientIp, details: { business: input.businessName, mobile: input.mobile, plan: input.plan } },
        });
        return { user: { id: user.id, name: user.name, mobile: user.mobile, email: user.email }, business: { id: business.id, name: business.name } };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = String((e.meta as { target?: unknown })?.target ?? "");
      throw target.includes("email")
        ? new UserError("এই ইমেইল দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে", { email: ["এই ইমেইল দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে"] })
        : new UserError("এই মোবাইল নম্বর দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে — লগইন করুন", { mobile: ["এই মোবাইল নম্বর দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে"] });
    }
    throw e;
  }
}
