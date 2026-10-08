// SMS queue. Every SMS is a SmsMessage row (= queue item AND permanent log).
//
//   enqueue  → QUEUED   (dedupeKey unique: the same event can never be queued twice)
//   worker   → SENDING  (claimed with FOR UPDATE SKIP LOCKED: safe with several app instances)
//            → SENT / DELIVERED, or
//            → QUEUED again with a back-off (temporary failure, attempts left), or
//            → FAILED (permanent failure / attempts exhausted)
//
// Callers enqueue AFTER their business transaction has committed and never await delivery, so
// an SMS problem can never roll back or slow down a sale, purchase or payment.
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, SmsMessage } from "@prisma/client";
import { normalizeBdMobile } from "@/lib/mobile";
import { MAX_SMS_PARTS, smsSegments } from "@/lib/sms-text";
import { createProvider, platformConfig, SmsProviderError, type ProviderConfig } from "./providers";
import { decryptSecret } from "./secret";
import { isMySql, rawExec, rawRows, sql } from "@/lib/dialect";

type Db = PrismaClient | Prisma.TransactionClient;

/** minutes to wait before attempt n+1 */
const BACKOFF_MINUTES = [1, 5, 15, 60, 180];

export interface EnqueueInput {
  businessId: string | null;
  event: string;
  recipient: string | null | undefined;
  body: string;
  dedupeKey?: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  voucherId?: string | null;
  voucherNo?: string | null;
  userId?: string | null;
  createdById?: string | null;
  batchId?: string | null;
  priority?: number;
  maxAttempts?: number;
}

export type EnqueueResult = { status: "queued"; id: string } | { status: "duplicate" } | { status: "skipped"; reason: string };

export async function enqueueSms(db: Db, input: EnqueueInput): Promise<EnqueueResult> {
  const to = normalizeBdMobile(input.recipient ?? null);
  if (!to) return { status: "skipped", reason: "সঠিক মোবাইল নম্বর নেই" };
  const text = input.body.trim();
  if (!text) return { status: "skipped", reason: "বার্তা খালি" };
  const seg = smsSegments(text);
  if (seg.parts > MAX_SMS_PARTS) return { status: "skipped", reason: `বার্তা খুব বড় (${seg.parts} পার্ট)` };
  const data = {
    businessId: input.businessId, event: input.event, recipient: to, body: text, encoding: seg.encoding, parts: seg.parts,
    dedupeKey: input.dedupeKey ?? null, customerId: input.customerId ?? null, supplierId: input.supplierId ?? null,
    voucherId: input.voucherId ?? null, voucherNo: input.voucherNo ?? null, userId: input.userId ?? null,
    createdById: input.createdById ?? null, batchId: input.batchId ?? null, priority: input.priority ?? 0, maxAttempts: input.maxAttempts ?? 5,
  };
  if (!data.dedupeKey) return { status: "queued", id: (await db.smsMessage.create({ data, select: { id: true } })).id };
  // insert-or-ignore on the unique dedupe key (no error noise, race-safe)
  const id = randomUUID();
  const inserted = await db.smsMessage.createMany({ data: [{ ...data, id }], skipDuplicates: true });
  return inserted.count === 1 ? { status: "queued", id } : { status: "duplicate" };
}

/** Provider credentials for a business (or the platform for security codes). */
export async function providerConfigFor(db: Db, businessId: string | null): Promise<{ cfg: ProviderConfig | null; enabled: boolean; reason?: string }> {
  if (!businessId) {
    const cfg = platformConfig();
    return cfg ? { cfg, enabled: true } : { cfg: null, enabled: false, reason: "সার্ভারে এসএমএস প্রোভাইডার কনফিগার করা নেই" };
  }
  const s = await db.smsSettings.findUnique({ where: { businessId } });
  if (!s?.enabled) return { cfg: null, enabled: false, reason: "এই ব্যবসার এসএমএস বন্ধ আছে" };
  if (s.provider === "platform") {
    const cfg = platformConfig();
    return cfg ? { cfg: { ...cfg, senderId: s.senderId || cfg.senderId }, enabled: true } : { cfg: null, enabled: false, reason: "সার্ভারে প্ল্যাটফর্ম প্রোভাইডার কনফিগার করা নেই" };
  }
  return { cfg: { provider: s.provider, apiKey: decryptSecret(s.apiKeyEnc), senderId: s.senderId }, enabled: true };
}

async function finish(db: Db, id: string, data: Prisma.SmsMessageUpdateInput) {
  await db.smsMessage.update({ where: { id }, data });
}

async function deliver(db: Db, m: SmsMessage, now: Date) {
  const { cfg, enabled, reason } = await providerConfigFor(db, m.businessId);
  if (!enabled || !cfg) {
    await finish(db, m.id, { status: "FAILED", lastError: reason ?? "এসএমএস বন্ধ", failedAt: now });
    return "FAILED" as const;
  }
  try {
    const provider = createProvider(cfg);
    const r = await provider.send({ to: m.recipient, text: m.body, encoding: m.encoding as "GSM7" | "UCS2", senderId: cfg.senderId });
    await finish(db, m.id, {
      status: r.status, provider: provider.id, requestId: r.requestId, cost: r.cost ?? null, lastError: null,
      sentAt: now, ...(r.status === "DELIVERED" ? { deliveredAt: now } : {}),
    });
    return r.status;
  } catch (e) {
    const err = e instanceof SmsProviderError ? e : new SmsProviderError((e as Error).message ?? "অজানা ত্রুটি", true);
    const retry = err.temporary && m.attempts < m.maxAttempts;
    const wait = BACKOFF_MINUTES[Math.min(m.attempts - 1, BACKOFF_MINUTES.length - 1)] * 60_000;
    await finish(db, m.id, retry
      ? { status: "QUEUED", provider: cfg.provider, lastError: `${err.message} — পুনরায় চেষ্টা হবে`, nextAttemptAt: new Date(now.getTime() + wait) }
      : { status: "FAILED", provider: cfg.provider, lastError: err.message, failedAt: now });
    return retry ? ("RETRY" as const) : ("FAILED" as const);
  }
}

/**
 * Sends due messages. Rows are claimed atomically (FOR UPDATE SKIP LOCKED), so several app
 * instances or overlapping ticks never send the same SMS twice.
 */
export async function processSmsQueue(db: PrismaClient, opts: { limit?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  // a crash while SENDING leaves rows stuck: give them back to the queue after 10 minutes
  await rawExec(db, sql`UPDATE "SmsMessage" SET "status" = 'QUEUED', "updatedAt" = ${now}
    WHERE "status" = 'SENDING' AND "updatedAt" < ${new Date(now.getTime() - 10 * 60_000)}`);
  const claimed = isMySql() ? await claimDueMySql(db, now, opts.limit ?? 50) : await rawRows<SmsMessage>(db, sql`
    UPDATE "SmsMessage" SET "status" = 'SENDING', "attempts" = "attempts" + 1, "updatedAt" = ${now}
    WHERE "id" IN (
      SELECT "id" FROM "SmsMessage"
      WHERE "status" = 'QUEUED' AND "nextAttemptAt" <= ${now}
      ORDER BY "priority" DESC, "nextAttemptAt" ASC
      LIMIT ${opts.limit ?? 50}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`);
  const result = { sent: 0, delivered: 0, retry: 0, failed: 0 };
  for (const m of claimed) {
    const r = await deliver(db, m, now);
    if (r === "SENT") result.sent++;
    else if (r === "DELIVERED") result.delivered++;
    else if (r === "RETRY") result.retry++;
    else result.failed++;
  }
  return { claimed: claimed.length, ...result };
}

/** MySQL / MariaDB: claim due rows (SKIP LOCKED), mark them SENDING and read them back — no UPDATE … RETURNING. */
async function claimDueMySql(db: PrismaClient, now: Date, limit: number): Promise<SmsMessage[]> {
  return db.$transaction(async (tx) => {
    const ids = (await rawRows<{ id: string }>(tx, sql`
      SELECT "id" FROM "SmsMessage"
      WHERE "status" = 'QUEUED' AND "nextAttemptAt" <= ${now}
      ORDER BY "priority" DESC, "nextAttemptAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`)).map((r) => r.id);
    if (!ids.length) return [];
    await tx.smsMessage.updateMany({ where: { id: { in: ids }, status: "QUEUED" }, data: { status: "SENDING", attempts: { increment: 1 }, updatedAt: now } });
    return tx.smsMessage.findMany({ where: { id: { in: ids }, status: "SENDING" } });
  });
}

/** Sends one specific queued message now (e.g. the admin's test SMS), regardless of any backlog. */
export async function processSmsMessage(db: PrismaClient, id: string, now = new Date()) {
  if (isMySql()) {
    const moved = await db.smsMessage.updateMany({ where: { id, status: "QUEUED" }, data: { status: "SENDING", attempts: { increment: 1 }, updatedAt: now } });
    const m = moved.count ? await db.smsMessage.findUnique({ where: { id } }) : null;
    return m ? deliver(db, m, now) : null;
  }
  const claimed = await rawRows<SmsMessage>(db, sql`
    UPDATE "SmsMessage" SET "status" = 'SENDING', "attempts" = "attempts" + 1, "updatedAt" = ${now}
    WHERE "id" = ${id} AND "status" = 'QUEUED'
    RETURNING *`);
  return claimed[0] ? deliver(db, claimed[0], now) : null;
}

let running: Promise<unknown> | null = null;
/** Fire-and-forget: start the worker now (e.g. right after enqueueing) without blocking the request. */
export function kickSmsQueue(db: PrismaClient) {
  if (running) return;
  running = processSmsQueue(db)
    .catch((e) => console.error("[sms] queue run failed:", e instanceof Error ? e.message : e))
    .finally(() => {
      running = null;
    });
}

/** Resolves when a background run started by kickSmsQueue has finished (tests, graceful shutdown). */
export async function smsQueueIdle() {
  while (running) await running;
}

/**
 * Delivery reports for gateways without callbacks: polls SENT messages of the last 2 days in
 * round-robin order (least recently checked first; every checked row is touched), so messages a
 * gateway never confirms cannot starve newer ones.
 */
export async function refreshDeliveryStatus(db: PrismaClient, now = new Date()) {
  const pending = await db.smsMessage.findMany({
    where: { status: "SENT", requestId: { not: null }, sentAt: { gte: new Date(now.getTime() - 2 * 86_400_000) } },
    take: 200,
    orderBy: { updatedAt: "asc" },
  });
  let updated = 0;
  const cache = new Map<string, Awaited<ReturnType<typeof providerConfigFor>>>();
  for (const m of pending) {
    const key = m.businessId ?? "";
    if (!cache.has(key)) cache.set(key, await providerConfigFor(db, m.businessId));
    const { cfg } = cache.get(key)!;
    if (!cfg) continue;
    try {
      const provider = createProvider(cfg);
      const st = provider.status ? await provider.status(m.requestId!) : null;
      if (st === "DELIVERED") await finish(db, m.id, { status: "DELIVERED", deliveredAt: now });
      else if (st === "FAILED") await finish(db, m.id, { status: "FAILED", failedAt: now, lastError: "গেটওয়ে জানিয়েছে: পৌঁছানো যায়নি" });
      if (st === "DELIVERED" || st === "FAILED") updated++;
      else await finish(db, m.id, { updatedAt: now }); // checked: move to the back of the line
    } catch {
      await finish(db, m.id, { updatedAt: now }).catch(() => null); /* try again next round */
    }
  }
  return updated;
}

/**
 * Delivery callback from a gateway (webhook). Only moves forward: SENT → DELIVERED / FAILED, only
 * for messages sent in the last 7 days, optionally limited to one provider (ids may repeat).
 */
export async function applyDeliveryReport(db: PrismaClient, requestId: string, status: "DELIVERED" | "FAILED", now = new Date(), provider?: string | null) {
  const r = await db.smsMessage.updateMany({
    where: { requestId, status: "SENT", sentAt: { gte: new Date(now.getTime() - 7 * 86_400_000) }, ...(provider ? { provider } : {}) },
    data: status === "DELIVERED" ? { status, deliveredAt: now } : { status, failedAt: now, lastError: "গেটওয়ে জানিয়েছে: পৌঁছানো যায়নি" },
  });
  return r.count;
}

/** Reads the gateway balance; records a low-balance alert (once a day) below the threshold. */
export async function checkSmsBalance(db: PrismaClient, businessId: string, now = new Date()) {
  const { cfg, enabled, reason } = await providerConfigFor(db, businessId);
  if (!enabled || !cfg) return { ok: false as const, message: reason ?? "এসএমএস বন্ধ" };
  try {
    const provider = createProvider(cfg);
    const balance = provider.balance ? await provider.balance() : null;
    const s = await db.smsSettings.update({ where: { businessId }, data: { balance, balanceCheckedAt: now } });
    if (balance !== null && balance < Number(s.lowBalanceThreshold)) {
      const day = now.toISOString().slice(0, 10);
      await db.notification.upsert({
        where: { businessId_dedupeKey: { businessId, dedupeKey: `smsbalance:${day}` } },
        create: { businessId, kind: "SMS_BALANCE_LOW", severity: "WARNING", dedupeKey: `smsbalance:${day}`, title: "এসএমএস ব্যালেন্স কম", message: `এসএমএস ব্যালেন্স ${balance} — সতর্কতার সীমা ${Number(s.lowBalanceThreshold)}। এসএমএস বন্ধ হওয়ার আগে রিচার্জ করুন।`, link: "/sms/settings", amount: balance },
        update: { amount: balance },
      });
    } else {
      await db.notification.updateMany({ where: { businessId, kind: "SMS_BALANCE_LOW", resolvedAt: null }, data: { resolvedAt: now } });
    }
    return { ok: true as const, balance };
  } catch (e) {
    return { ok: false as const, message: e instanceof Error ? e.message : "ব্যালেন্স জানা যায়নি" };
  }
}
