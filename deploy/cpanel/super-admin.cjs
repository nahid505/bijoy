// Grant / revoke platform Super Admin on the server (there is deliberately no web UI for this).
//   node super-admin.cjs grant  you@example.com      (or a mobile number)
//   node super-admin.cjs revoke you@example.com
//   node super-admin.cjs list
// The account must exist first (register on the website). Every change is written to the audit log.
"use strict";
const fs = require("node:fs");
process.chdir(__dirname);
if (fs.existsSync(".env")) process.loadEnvFile(".env");
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

(async () => {
  const [cmd, who] = process.argv.slice(2);
  if (cmd === "list") {
    const rows = await db.user.findMany({ where: { isSuperAdmin: true }, select: { name: true, email: true, mobile: true, isActive: true } });
    if (!rows.length) console.log("No super admins.");
    for (const u of rows) console.log(`${u.name}  ${u.email ?? "-"}  ${u.mobile ?? "-"}${u.isActive ? "" : "  (inactive)"}`);
    return;
  }
  if ((cmd !== "grant" && cmd !== "revoke") || !who) {
    console.error("Usage: node super-admin.cjs grant|revoke <email|mobile>   |   node super-admin.cjs list");
    process.exitCode = 1;
    return;
  }
  const key = who.trim();
  const user = await db.user.findFirst({ where: key.includes("@") ? { email: /^mysql:/i.test(process.env.DATABASE_URL || "") ? { equals: key.toLowerCase() } : { equals: key.toLowerCase(), mode: "insensitive" } } : { mobile: key } });
  if (!user) {
    console.error(`No user with ${key.includes("@") ? "email" : "mobile"} "${key}". Register on the website first.`);
    process.exitCode = 1;
    return;
  }
  const on = cmd === "grant";
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { isSuperAdmin: on } }),
    db.auditLog.create({ data: { userId: user.id, action: "UPDATE", entity: "SuperAdmin", entityId: user.id, details: { event: on ? "granted" : "revoked", via: "cli" } } }),
  ]);
  console.log(`${on ? "Granted" : "Revoked"} Super Admin: ${user.name} (${user.email ?? user.mobile})`);
})()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
