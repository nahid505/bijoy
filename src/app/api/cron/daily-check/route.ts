import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runDailyChecksForAll } from "@/server/services/notifications";

export const dynamic = "force-dynamic";

/**
 * Optional trigger for an external scheduler (host cron, Kubernetes CronJob …):
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://app:3000/api/cron/daily-check
 * Disabled unless CRON_SECRET is set. Safe to call repeatedly — each business is checked once a day.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return NextResponse.json({ error: "disabled" }, { status: 404 });
  const given = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const log: string[] = [];
  await runDailyChecksForAll((m) => log.push(m));
  return NextResponse.json({ ok: true, log });
}
