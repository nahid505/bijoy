import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { cronDenied } from "@/server/cron-auth";
import { processSmsQueue, refreshDeliveryStatus } from "@/server/sms/queue";

export const dynamic = "force-dynamic";

/**
 * Sends queued SMS and refreshes delivery reports — for hosts where the in-process worker cannot be
 * relied on (cPanel / Passenger stops idle apps). Safe to call often and in parallel with the worker:
 * rows are claimed with SKIP LOCKED.
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your.domain/api/cron/sms-queue
 */
export async function POST(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  await processSmsQueue(prisma);
  await refreshDeliveryStatus(prisma);
  return NextResponse.json({ ok: true });
}
