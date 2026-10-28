import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { productionConfigIssues } from "@/server/config-check";
import { rawRows, sql } from "@/lib/dialect";

export const dynamic = "force-dynamic";

/** The running build's id (.next/BUILD_ID) — after a deploy it must change, or the old build is still running. */
function buildId(): string | null {
  try {
    return readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Liveness / readiness for uptime monitors and deploy scripts. 200 = database reachable and no
 * configuration errors. Details of configuration problems are only in the server log (never here).
 * build / migration: which build is running and the newest applied migration (deploy checks; not secret).
 */
export async function GET() {
  const issues = productionConfigIssues();
  const config = issues.some((i) => i.level === "error") ? "error" : issues.length ? "warning" : "ok";
  let database = "ok";
  let migration: string | null = null;
  try {
    await rawRows<unknown>(prisma, sql`SELECT 1`);
    try {
      const rows = await rawRows<{ name: string }>(prisma, sql`SELECT "migration_name" AS name FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL ORDER BY "migration_name" DESC LIMIT 1`);
      migration = rows[0]?.name ?? null;
    } catch {
      migration = null; // no migration table (not migrated yet)
    }
  } catch {
    database = "unreachable";
  }
  const ok = database === "ok" && config !== "error";
  return NextResponse.json({ status: ok ? "ok" : "error", database, config, build: buildId(), migration }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
