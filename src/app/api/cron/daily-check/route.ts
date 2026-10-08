import { NextResponse } from "next/server";
import { cronDenied } from "@/server/cron-auth";
import { runDailyChecksForAll } from "@/server/services/notifications";

export const dynamic = "force-dynamic";

/**
 * Optional trigger for an external scheduler (host cron, cPanel cron, Kubernetes CronJob …):
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your.domain/api/cron/daily-check
 * Disabled unless CRON_SECRET is set. Safe to call repeatedly — each business is checked once a day
 * (expiry / stock / dues alerts, subscription reminders and expiry).
 */
export async function POST(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  const log: string[] = [];
  await runDailyChecksForAll((m) => log.push(m));
  return NextResponse.json({ ok: true, log });
}
