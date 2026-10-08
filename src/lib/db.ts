import "server-only";
import { Prisma, PrismaClient } from "@prisma/client";
import { dbProvider } from "./dialect";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Adds safe pool defaults unless the URL already sets them. A bounded, reused pool
 * avoids connection bursts (pages run many queries in parallel), which some
 * port proxies — e.g. Docker Desktop on Windows — intermittently refuse (P1001).
 */
export function withPoolDefaults(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    const defaults: Record<string, string> = { connection_limit: "10", pool_timeout: "30", connect_timeout: "30" };
    for (const [k, v] of Object.entries(defaults)) if (!u.searchParams.has(k)) u.searchParams.set(k, v);
    return u.toString();
  } catch {
    return url;
  }
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: withPoolDefaults(process.env.DATABASE_URL),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    // MySQL / MariaDB default to REPEATABLE READ (gap locks → more deadlocks); use PostgreSQL's default
    ...(dbProvider(process.env.DATABASE_URL) === "mysql" ? { transactionOptions: { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted } } : {}),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Prisma Decimal | number | null -> number */
export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}
