// Grant or revoke platform Super Admin access (the /admin panel). There is deliberately no web UI for
// this: only someone with shell + database access can create a platform administrator.
//
//   npm run super-admin -- grant  <email|mobile>
//   npm run super-admin -- revoke <email|mobile>
//   npm run super-admin -- list
import { prisma } from "../src/lib/db";
import { ciEquals } from "../src/lib/dialect";

async function main() {
  const [cmd, who] = process.argv.slice(2);
  if (cmd === "list") {
    const rows = await prisma.user.findMany({ where: { isSuperAdmin: true }, select: { name: true, email: true, mobile: true, isActive: true } });
    if (!rows.length) console.log("No super admins.");
    for (const u of rows) console.log(`${u.name}  ${u.email ?? "-"}  ${u.mobile ?? "-"}${u.isActive ? "" : "  (inactive)"}`);
    return;
  }
  if ((cmd !== "grant" && cmd !== "revoke") || !who) {
    console.error("Usage: npm run super-admin -- grant|revoke <email|mobile>   |   npm run super-admin -- list");
    process.exitCode = 1;
    return;
  }
  const key = who.trim();
  const user = await prisma.user.findFirst({ where: key.includes("@") ? { email: ciEquals(key.toLowerCase()) } : { mobile: key } });
  if (!user) {
    console.error(`No user with ${key.includes("@") ? "email" : "mobile"} "${key}".`);
    process.exitCode = 1;
    return;
  }
  const on = cmd === "grant";
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { isSuperAdmin: on } }),
    prisma.auditLog.create({ data: { userId: user.id, action: "UPDATE", entity: "SuperAdmin", entityId: user.id, details: { event: on ? "granted" : "revoked", via: "cli" } } }),
  ]);
  console.log(`${on ? "Granted" : "Revoked"} Super Admin: ${user.name} (${user.email ?? user.mobile})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
