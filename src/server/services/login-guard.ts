// Login brute-force protection, stored in PostgreSQL so it is shared by every app instance and
// survives restarts.
//
//  • account key  "account:<email>"  — independent of the client address: changing or spoofing
//    X-Forwarded-For can never reset it. 5 attempts / 15 min, then the account is locked 15 min.
//  • address key  "ip:<address>"     — only when the address comes from a trusted proxy
//    (TRUSTED_PROXY_HOPS). 20 attempts / 15 min per address, then 15 min block.
//
// Attempts are reserved atomically BEFORE the password is checked, so parallel guesses cannot
// race past the limit. A successful login clears the account key.
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export const LOGIN_POLICY = {
  account: { max: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
  ip: { max: 20, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
} as const;

export const accountKey = (identifier: string) => `account:${identifier.trim().toLowerCase()}`;
export const userKey = (userId: string) => `user:${userId}`;
export const ipKey = (ip: string) => `ip:${ip}`;

interface Row {
  attempts: number;
  lockedUntil: Date | null;
}

/** Atomically counts one attempt on `key`; returns the lock end if the key is (now) locked. Shared by login and registration throttles. */
export async function reserveAttempt(db: Db, key: string, policy: { max: number; windowMs: number; lockMs: number }, now: Date): Promise<Date | null> {
  const windowFloor = new Date(now.getTime() - policy.windowMs);
  const lockUntil = new Date(now.getTime() + policy.lockMs);
  const rows = await db.$queryRaw<Row[]>`
    INSERT INTO "AuthThrottle" ("key", "attempts", "windowStart", "lockedUntil", "updatedAt")
    VALUES (${key}, 1, ${now}, NULL, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "attempts" = CASE
        WHEN "AuthThrottle"."lockedUntil" IS NOT NULL AND "AuthThrottle"."lockedUntil" > ${now} THEN "AuthThrottle"."attempts"
        WHEN "AuthThrottle"."windowStart" < ${windowFloor} OR "AuthThrottle"."lockedUntil" IS NOT NULL THEN 1
        ELSE "AuthThrottle"."attempts" + 1 END,
      "windowStart" = CASE
        WHEN "AuthThrottle"."lockedUntil" IS NOT NULL AND "AuthThrottle"."lockedUntil" > ${now} THEN "AuthThrottle"."windowStart"
        WHEN "AuthThrottle"."windowStart" < ${windowFloor} OR "AuthThrottle"."lockedUntil" IS NOT NULL THEN ${now}
        ELSE "AuthThrottle"."windowStart" END,
      "lockedUntil" = CASE
        WHEN "AuthThrottle"."lockedUntil" IS NOT NULL AND "AuthThrottle"."lockedUntil" > ${now} THEN "AuthThrottle"."lockedUntil"
        ELSE NULL END,
      "updatedAt" = ${now}
    RETURNING "attempts", "lockedUntil"`;
  const row = rows[0];
  if (row.lockedUntil && row.lockedUntil > now) return row.lockedUntil;
  if (row.attempts > policy.max) {
    await db.$executeRaw`UPDATE "AuthThrottle" SET "lockedUntil" = ${lockUntil} WHERE "key" = ${key}`;
    return lockUntil;
  }
  return null;
}

export interface GuardDecision {
  allowed: boolean;
  /** when blocked: minutes until the next attempt is allowed */
  retryAfterMinutes?: number;
  reason?: "account" | "ip";
}

/**
 * Call once per login attempt, BEFORE verifying the password. `identifier` is what was typed
 * (e-mail or mobile); `userId` (when the identifier belongs to a user) adds a per-user counter so
 * alternating between a user's e-mail and mobile number cannot double the allowed attempts.
 */
export async function beginLoginAttempt(db: Db, identifier: string, clientIp: string | null, now = new Date(), userId?: string | null): Promise<GuardDecision> {
  const idUntil = await reserveAttempt(db, accountKey(identifier), LOGIN_POLICY.account, now);
  const userUntil = userId ? await reserveAttempt(db, userKey(userId), LOGIN_POLICY.account, now) : null;
  const until = [idUntil, userUntil].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const ipUntil = clientIp ? await reserveAttempt(db, ipKey(clientIp), LOGIN_POLICY.ip, now) : null;
  const blocked = [until && { at: until, reason: "account" as const }, ipUntil && { at: ipUntil, reason: "ip" as const }].filter(Boolean) as { at: Date; reason: "account" | "ip" }[];
  if (blocked.length === 0) return { allowed: true };
  const worst = blocked.sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  return { allowed: false, reason: worst.reason, retryAfterMinutes: Math.max(1, Math.ceil((worst.at.getTime() - now.getTime()) / 60_000)) };
}

/** After a successful login: the account's counters (all its identifiers) start again from zero. */
export async function loginSucceeded(db: Db, identifiers: (string | null | undefined)[], userId?: string) {
  const keys = identifiers.filter((x): x is string => !!x).map(accountKey);
  if (userId) keys.push(userKey(userId));
  await db.authThrottle.deleteMany({ where: { key: { in: keys } } });
}

/** Housekeeping: drop expired throttle rows. */
export async function purgeLoginThrottle(db: Db, now = new Date()) {
  const floor = new Date(now.getTime() - Math.max(LOGIN_POLICY.account.windowMs, LOGIN_POLICY.ip.windowMs));
  return db.authThrottle.deleteMany({ where: { windowStart: { lt: floor }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] } });
}
