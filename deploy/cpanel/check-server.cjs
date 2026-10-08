// Server readiness check — run in the cPanel Terminal from the application root:
//   node check-server.cjs
// Checks Node.js, OpenSSL / Prisma engine, memory, the database (PostgreSQL version, migrations,
// plans), and the production configuration. Prints no secret values.
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.chdir(__dirname);
process.env.NODE_ENV = "production";
if (fs.existsSync(".env")) process.loadEnvFile(".env");

const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => { console.log(`  ✖ ${m}`); process.exitCode = 1; };
const warn = (m) => console.log(`  ! ${m}`);

(async () => {
  console.log("Node.js");
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 22) ok(`Node ${process.versions.node}`);
  else bad(`Node ${process.versions.node} — select Node.js 22 in cPanel`);
  console.log(`  OpenSSL ${process.versions.openssl} · ${os.platform()} ${os.release()} · RAM ${(os.totalmem() / 2 ** 30).toFixed(1)} GB (free ${(os.freemem() / 2 ** 30).toFixed(1)} GB)`);
  const engines = fs.readdirSync(path.join("node_modules", ".prisma", "client")).filter((f) => f.endsWith(".so.node"));
  if (engines.length) ok(`Prisma engines: ${engines.map((f) => f.replace(/^libquery_engine-|\.so\.node$/g, "")).join(", ")}`);
  else bad("no Linux Prisma engine in node_modules/.prisma/client");

  console.log("Configuration");
  const url = process.env.DATABASE_URL || "";
  const mysql = /^mysql:/i.test(url);
  if (!url) bad("DATABASE_URL is not set");
  else if (!/^(postgres(ql)?|mysql):\/\//.test(url)) bad("DATABASE_URL must start with mysql:// (or postgresql://)");
  else ok(`DATABASE_URL → ${mysql ? "MySQL/MariaDB" : "PostgreSQL"} ${new URL(url).hostname}:${new URL(url).port || (mysql ? 3306 : 5432)}`);
  const clientProvider = (fs.readFileSync(path.join("node_modules", ".prisma", "client", "schema.prisma"), "utf8").match(/provider\s*=\s*"(mysql|postgresql)"/) || [])[1];
  if (clientProvider && url && clientProvider !== (mysql ? "mysql" : "postgresql")) bad(`this package was built for ${clientProvider}, but DATABASE_URL is ${mysql ? "mysql" : "postgresql"}`);
  const need = { AUTH_SECRET: 32, CRON_SECRET: 16, BILLING_WEBHOOK_SECRET: 32 };
  for (const [k, n] of Object.entries(need)) {
    if ((process.env[k] || "").length >= n) ok(`${k} set`);
    else (k === "AUTH_SECRET" ? bad : warn)(`${k} missing or shorter than ${n}`);
  }
  if (process.env.COOKIE_SECURE === "true") ok("COOKIE_SECURE=true");
  else warn("COOKIE_SECURE is not true");
  if ((process.env.APP_URL || "").startsWith("https://")) ok(`APP_URL ${process.env.APP_URL}`);
  else warn("APP_URL should be https://…");
  if (process.env.BILLING_MOCK === "true") bad("BILLING_MOCK=true — must be false in production");
  else ok("mock payment gateway off");

  if (!/^(postgres(ql)?|mysql):\/\//.test(url)) return;
  console.log("Database");
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient();
  try {
    const [{ version }] = await db.$queryRawUnsafe("SELECT VERSION() AS version");
    if (mysql) {
      // needs JSON column defaults + CHECK (MySQL 8.0.16+) and SKIP LOCKED (MariaDB 10.6+)
      const v = String(version);
      const [maj, min, pat] = (v.match(/^(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
      const maria = /mariadb/i.test(v);
      const good = maria ? maj > 10 || (maj === 10 && min >= 6) : maj > 8 || (maj === 8 && (min > 0 || pat >= 16));
      if (good) ok(`${maria ? "MariaDB" : "MySQL"} ${v}`);
      else bad(`${maria ? "MariaDB" : "MySQL"} ${v} is too old — needs MySQL 8.0.16+ or MariaDB 10.6+ (ask RecoHost support)`);
    } else ok(String(version).split(",")[0]);
    const applied = await db.$queryRawUnsafe(mysql ? "SELECT COUNT(*) AS n FROM `_prisma_migrations` WHERE finished_at IS NOT NULL" : `SELECT COUNT(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`).catch(() => null);
    const total = fs.readdirSync(path.join("prisma", "migrations")).filter((d) => /^\d/.test(d)).length;
    if (!applied) warn("migrations not applied yet — run: sh migrate.sh");
    else if (Number(applied[0].n) >= total) ok(`migrations ${Number(applied[0].n)}/${total}`);
    else warn(`migrations ${Number(applied[0].n)}/${total} — run: sh migrate.sh`);
    if (applied) {
      const plans = await db.plan.count({ where: { isActive: true } });
      if (plans) ok(`${plans} active subscription plans`);
      else warn("no plans — migrations incomplete?");
      const supers = await db.user.count({ where: { isSuperAdmin: true } });
      if (supers) ok(`${supers} super admin(s)`);
      else warn("no super admin yet — register, then: node super-admin.cjs grant <email|mobile>");
    }
  } catch (e) {
    bad(`cannot connect: ${String(e.message).split("\n").filter(Boolean).slice(-1)[0]}`);
  } finally {
    await db.$disconnect();
  }
})();
