import { execSync } from "node:child_process";

/** Applies migrations to the dedicated test database before integration tests run. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  if (/\/bijoy_lenden\?/.test(url)) throw new Error("TEST_DATABASE_URL must not point at the development database");
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}
