// In-process scheduler for the daily expiry / stock / dues check.
//
// Started once per Node.js server process from src/instrumentation.ts, so it runs wherever the
// app runs (Docker container, `node server.js`, `next start`). It ticks every
// SCHEDULER_INTERVAL_MINUTES (default 60) and runs each business's check at most once per
// Asia/Dhaka day; several replicas are safe because runs are serialised per business with an
// advisory lock and alerts are de-duplicated by key. Set DISABLE_SCHEDULER=true to turn it off
// (e.g. when an external cron calls /api/cron/daily-check instead).
import { prisma } from "@/lib/db";
import { runDailyChecksForAll } from "./services/notifications";
import { purgeLoginThrottle } from "./services/login-guard";
import { purgeSessions } from "./services/sessions";
import { processSmsQueue, refreshDeliveryStatus } from "./sms/queue";

const g = globalThis as unknown as { __blScheduler?: NodeJS.Timeout; __blSmsWorker?: NodeJS.Timeout };

/** SMS worker: sends queued messages every SMS_QUEUE_INTERVAL_SECONDS (default 15) and polls
 *  delivery reports every 5 minutes. Safe with several instances (rows are claimed with SKIP LOCKED). */
function startSmsWorker() {
  if (g.__blSmsWorker) return;
  const seconds = Math.max(5, Number(process.env.SMS_QUEUE_INTERVAL_SECONDS ?? 15) || 15);
  let busy = false;
  let lastDlr = 0;
  g.__blSmsWorker = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await processSmsQueue(prisma);
      if (Date.now() - lastDlr > 5 * 60_000) {
        lastDlr = Date.now();
        await refreshDeliveryStatus(prisma);
      }
    } catch (e) {
      console.error("[sms] worker tick failed:", e instanceof Error ? e.message : e);
    } finally {
      busy = false;
    }
  }, seconds * 1000);
  g.__blSmsWorker.unref();
}

export function startScheduler() {
  if (g.__blScheduler || process.env.DISABLE_SCHEDULER === "true") return;
  startSmsWorker();
  const minutes = Math.max(1, Number(process.env.SCHEDULER_INTERVAL_MINUTES ?? 60) || 60);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDailyChecksForAll((m) => console.log(m));
      await purgeSessions(prisma); // housekeeping: ended sessions
      await purgeLoginThrottle(prisma); // housekeeping: stale login counters
    } catch (e) {
      console.error("[daily-check] scheduler tick failed:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 20_000).unref(); // first run shortly after start-up
  g.__blScheduler = setInterval(tick, minutes * 60_000);
  g.__blScheduler.unref();
  console.log(`[daily-check] scheduler started (every ${minutes} min)`);
}
