// Runs the whole test suite against a MySQL 8 / MariaDB test database:
//   TEST_MYSQL_URL="mysql://user:pass@127.0.0.1:3307/bijoy_mysql_test" npm run test:mysql [-- vitest args]
// Generates the MySQL Prisma Client, runs vitest, then restores the PostgreSQL client (always).
// The database must be a dedicated, disposable test database.
import { spawnSync } from "node:child_process";

const url = process.env.TEST_MYSQL_URL;
if (!url || !/^mysql:/i.test(url)) {
  console.error("Set TEST_MYSQL_URL=mysql://… (a disposable test database)");
  process.exit(1);
}
const run = (cmd, args, env = {}) => spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });
let status = 1;
try {
  if (run("npx", ["prisma", "generate", "--schema", "prisma/mysql/schema.prisma"], { DATABASE_URL: url }).status !== 0) throw new Error("prisma generate (MySQL) failed");
  status = run("npx", ["vitest", "run", ...process.argv.slice(2)], { TEST_DATABASE_URL: url, DATABASE_URL: url }).status ?? 1;
} catch (e) {
  console.error(e.message);
} finally {
  run("npx", ["prisma", "generate"], { DATABASE_URL: "postgresql://restore@localhost/restore" });
}
process.exit(status);
