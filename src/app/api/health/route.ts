import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { productionConfigIssues } from "@/server/config-check";
import { rawRows, sql } from "@/lib/dialect";

export const dynamic = "force-dynamic";

/**
 * Liveness / readiness for uptime monitors and deploy scripts. 200 = database reachable and no
 * configuration errors. Details of configuration problems are only in the server log (never here).
 */
export async function GET() {
  const issues = productionConfigIssues();
  const config = issues.some((i) => i.level === "error") ? "error" : issues.length ? "warning" : "ok";
  let database = "ok";
  try {
    await rawRows<unknown>(prisma, sql`SELECT 1`);
  } catch {
    database = "unreachable";
  }
  const ok = database === "ok" && config !== "error";
  return NextResponse.json({ status: ok ? "ok" : "error", database, config }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
