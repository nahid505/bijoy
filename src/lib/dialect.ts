// Database dialect layer: the same code runs on PostgreSQL (Docker / VPS) and MySQL 8 / MariaDB
// (cPanel shared hosting). The provider is taken from DATABASE_URL (postgresql://… or mysql://…);
// the matching Prisma Client is generated from prisma/schema.prisma or prisma/mysql/schema.prisma.
//
//   ci(text)               case-insensitive "contains" (PostgreSQL: mode insensitive; MySQL: _ci collation)
//   ciEquals(text)         case-insensitive equality
//   listHas(value)         "list contains" on a String[] (PostgreSQL) / JSON array (MySQL) column
//   strList / intList      read a list column (array on PostgreSQL, JSON on MySQL) as a typed array
//   sql`…` + rawRows / rawExec  raw SQL written once in PostgreSQL style, translated for MySQL
//   lockKey(tx, key)       transaction-scoped named lock (advisory lock / AppLock row)
import { Prisma } from "@prisma/client";

export type DbProvider = "postgresql" | "mysql";
export function dbProvider(url = process.env.DATABASE_URL ?? ""): DbProvider {
  return /^mysql:/i.test(url) ? "mysql" : "postgresql";
}
export const isMySql = () => dbProvider() === "mysql";

// ───────────────────────── Prisma filters ─────────────────────────

/** Case-insensitive substring filter for a String column. */
export function ci(value: string): { contains: string } {
  return (isMySql() ? { contains: value } : { contains: value, mode: "insensitive" }) as { contains: string };
}

/** Case-insensitive equality filter for a String column. */
export function ciEquals(value: string): { equals: string } {
  return (isMySql() ? { equals: value } : { equals: value, mode: "insensitive" }) as { equals: string };
}

/** Filter: the list column contains `value`. */
export function listHas(value: string): never {
  return (isMySql() ? { array_contains: [value] } : { has: value }) as never;
}

/** Filter on a key of a JSON object column (e.g. AuditLog.details.event). */
export function jsonKey(key: string, filter: { equals: Prisma.InputJsonValue }): never {
  return (isMySql() ? { path: `$.${key}`, ...filter } : { path: [key], ...filter }) as never;
}

/** A list column as strings (String[] on PostgreSQL, JSON array on MySQL). */
export function strList(value: unknown, fallback: readonly string[] = []): string[] {
  const v = typeof value === "string" ? safeParse(value) : value;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [...fallback];
}

/** A list column as integers. */
export function intList(value: unknown, fallback: readonly number[] = []): number[] {
  const v = typeof value === "string" ? safeParse(value) : value;
  return Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n)) : [...fallback];
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ───────────────────────── raw SQL ─────────────────────────

const translated = new WeakMap<TemplateStringsArray, string[]>();

/** PostgreSQL-style SQL → MySQL: "Ident" → `Ident`, ::casts dropped, date_trunc('month'), regexp_replace flags. */
export function toMySqlText(text: string): string {
  return text
    .replace(/"([A-Za-z_][A-Za-z0-9_]*)"/g, "`$1`")
    .replace(/::(text|int|integer|bigint|numeric|date)\b/g, "")
    .replace(/date_trunc\('month',\s*([^)]+)\)/g, "CAST(DATE_FORMAT($1, '%Y-%m-01') AS DATETIME)")
    .replace(/,\s*'g'\)/g, ")"); // regexp_replace(…, 'g'): MySQL replaces every match by default
}

/**
 * Raw SQL written in PostgreSQL style (double-quoted identifiers, ::text casts). On MySQL the static
 * parts are translated; values stay bound parameters on both databases.
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): Prisma.Sql {
  if (!isMySql()) return Prisma.sql(strings, ...values);
  let parts = translated.get(strings);
  if (!parts) {
    parts = strings.map(toMySqlText);
    translated.set(strings, parts);
  }
  return Prisma.sql(parts, ...(values as Prisma.Sql["values"]));
}

type RawDb = { $queryRaw: <T = unknown>(query: Prisma.Sql) => Prisma.PrismaPromise<T>; $executeRaw: (query: Prisma.Sql) => Prisma.PrismaPromise<number> };

/**
 * Runs a SELECT. On MySQL, DECIMAL results come back as strings and COUNT(*) as numbers — the same
 * shapes the PostgreSQL queries produce with their ::text / ::int casts.
 */
export async function rawRows<T>(db: RawDb, query: Prisma.Sql): Promise<T[]> {
  const result = await db.$queryRaw<T[]>(query);
  if (!isMySql()) return result;
  return result.map((r) => normalizeRow(r as Record<string, unknown>) as T);
}

export function rawExec(db: RawDb, query: Prisma.Sql): Promise<number> {
  return db.$executeRaw(query);
}

function normalizeRow(r: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === "bigint") out[k] = Number(v);
    else if (v instanceof Prisma.Decimal) out[k] = v.toString();
    else out[k] = v;
  }
  return out;
}

/**
 * Transaction-scoped named lock (released at commit / rollback). PostgreSQL: advisory lock.
 * MySQL: the row of `key` in AppLock, locked FOR UPDATE.
 */
export async function lockKey(tx: RawDb, key: string): Promise<void> {
  if (!isMySql()) {
    await tx.$executeRaw(Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${key}))`);
    return;
  }
  // ON DUPLICATE KEY UPDATE: exclusive lock immediately (INSERT IGNORE + FOR UPDATE can deadlock)
  await tx.$executeRaw(Prisma.sql`INSERT INTO \`AppLock\` (\`key\`) VALUES (${key}) ON DUPLICATE KEY UPDATE \`key\` = \`key\``);
  await tx.$queryRaw(Prisma.sql`SELECT \`key\` FROM \`AppLock\` WHERE \`key\` = ${key} FOR UPDATE`);
}
