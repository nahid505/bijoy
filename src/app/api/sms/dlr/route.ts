import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { applyDeliveryReport } from "@/server/sms/queue";

export const dynamic = "force-dynamic";

/**
 * Delivery reports (DLR) from the SMS gateway:
 *   POST /api/sms/dlr?token=<SMS_WEBHOOK_SECRET>&provider=<id>   JSON or form: { message_id | request_id, status }
 *   GET  /api/sms/dlr?token=…&message_id=…&status=…  (gateways that call back with GET)
 * Disabled unless SMS_WEBHOOK_SECRET is set. Only moves SENT → DELIVERED / FAILED.
 */
async function handle(req: Request) {
  const secret = process.env.SMS_WEBHOOK_SECRET;
  if (!secret || secret.length < 16) return NextResponse.json({ error: "disabled" }, { status: 404 });
  const url = new URL(req.url);
  const given = Buffer.from(url.searchParams.get("token") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown> = Object.fromEntries(url.searchParams);
  if (req.method === "POST") {
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("json")) body = { ...body, ...((await req.json().catch(() => ({}))) as Record<string, unknown>) };
    else body = { ...body, ...Object.fromEntries(await req.formData().catch(() => new FormData())) };
  }
  const requestId = String(body.message_id ?? body.request_id ?? body.id ?? "").slice(0, 200);
  const raw = String(body.status ?? "").toUpperCase();
  const status = /^(DELIVERED|DELIVRD|SUCCESS)$/.test(raw) ? "DELIVERED" : /^(FAILED|UNDELIV|UNDELIVERED|REJECTED|EXPIRED)$/.test(raw) ? "FAILED" : null;
  if (!requestId || !status) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const updated = await applyDeliveryReport(prisma, requestId, status, new Date(), url.searchParams.get("provider"));
  return NextResponse.json({ ok: true, updated });
}

export const GET = handle;
export const POST = handle;
