// Bearer check for the cron endpoints (/api/cron/*). Disabled unless CRON_SECRET (min 16 chars) is set.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/** Returns an error response, or null when the request carries the right secret. */
export function cronDenied(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return NextResponse.json({ error: "disabled" }, { status: 404 });
  const given = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}
