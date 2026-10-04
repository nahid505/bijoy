// Server-side sessions. The cookie is a signed JWT that only names the session row; whether it
// is still valid is decided here on every request, so revocation is immediate.
import type { Prisma, PrismaClient } from "@prisma/client";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/session";

type Db = PrismaClient | Prisma.TransactionClient;

export async function createSession(db: Db, userId: string, meta: { ipAddress?: string | null; userAgent?: string | null } = {}) {
  return db.session.create({
    data: {
      userId,
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    },
  });
}

/** The active user behind a session, or null if the session is unknown, revoked or expired. */
export async function activeSessionUser(db: Db, sessionId: string, userId: string) {
  const s = await db.session.findUnique({
    where: { id: sessionId },
    select: { userId: true, revokedAt: true, expiresAt: true, user: { select: { id: true, name: true, email: true, mobile: true, isActive: true } } },
  });
  if (!s || s.userId !== userId || s.revokedAt || s.expiresAt <= new Date() || !s.user.isActive) return null;
  return s.user;
}

export async function revokeSession(db: Db, sessionId: string) {
  await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Ends every session of a user (password change / reset, deactivation). */
export async function revokeAllSessions(db: Db, userId: string) {
  const r = await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return r.count;
}

/** Housekeeping: forget sessions that ended more than a day ago. */
export async function purgeSessions(db: Db) {
  const dayAgo = new Date(Date.now() - 86_400_000);
  return db.session.deleteMany({ where: { OR: [{ expiresAt: { lt: dayAgo } }, { revokedAt: { lt: dayAgo } }] } });
}
