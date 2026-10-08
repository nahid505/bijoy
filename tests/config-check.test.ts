import { describe, expect, it } from "vitest";
import { productionConfigIssues } from "@/server/config-check";

const good = {
  NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@db:5432/x", AUTH_SECRET: "a".repeat(48), COOKIE_SECURE: "true",
  APP_URL: "https://erp.example.com", BILLING_WEBHOOK_SECRET: "b".repeat(40), CRON_SECRET: "c".repeat(24), BILLING_MOCK: "false",
} as NodeJS.ProcessEnv;

describe("production configuration check", () => {
  it("a complete production configuration has no issues; development is never checked", () => {
    expect(productionConfigIssues(good)).toEqual([]);
    expect(productionConfigIssues({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("errors: missing / weak secrets, non-PostgreSQL database, mock gateway allowed in production", () => {
    const errors = (env: NodeJS.ProcessEnv) => productionConfigIssues(env).filter((i) => i.level === "error").map((i) => i.message);
    expect(errors({ ...good, AUTH_SECRET: "short" })).toEqual([expect.stringMatching(/AUTH_SECRET/)]);
    expect(errors({ ...good, AUTH_SECRET: "replace-with-a-long-random-secret-at-least-32-chars" })).toEqual([expect.stringMatching(/example value/)]);
    expect(errors({ ...good, DATABASE_URL: "mysql://u:p@h/db" })).toEqual([]); // MySQL / MariaDB build (cPanel)
    expect(errors({ ...good, DATABASE_URL: "sqlserver://h" })).toEqual([expect.stringMatching(/PostgreSQL .* MySQL/)]);
    expect(errors({ ...good, BILLING_MOCK: "true", BILLING_MOCK_ALLOW_PRODUCTION: "true" })).toEqual([expect.stringMatching(/MOCK/)]);
    expect(errors({ ...good, BILLING_WEBHOOK_SECRET: "x" })).toEqual([expect.stringMatching(/BILLING_WEBHOOK_SECRET/)]);
  });

  it("warnings: insecure cookies, http APP_URL, cron disabled; messages never contain secret values", () => {
    const issues = productionConfigIssues({ ...good, COOKIE_SECURE: "false", APP_URL: "http://x", CRON_SECRET: "" });
    expect(issues.map((i) => i.level)).toEqual(["warning", "warning", "warning"]);
    expect(JSON.stringify(productionConfigIssues({ ...good, AUTH_SECRET: "s3cr3t" }))).not.toContain("s3cr3t");
  });
});
