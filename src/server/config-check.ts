// Production configuration check: logged at start-up (instrumentation) and summarised (without
// details or values) by /api/health. Never prints secret values.
export interface ConfigIssue {
  level: "error" | "warning";
  message: string;
}

export function productionConfigIssues(env: NodeJS.ProcessEnv = process.env): ConfigIssue[] {
  if (env.NODE_ENV !== "production") return [];
  const out: ConfigIssue[] = [];
  const err = (message: string) => out.push({ level: "error", message });
  const warn = (message: string) => out.push({ level: "warning", message });

  if (!env.DATABASE_URL) err("DATABASE_URL is not set");
  else if (!/^(postgres(ql)?|mysql):\/\//.test(env.DATABASE_URL)) err("DATABASE_URL must be a PostgreSQL (postgresql://…) or MySQL / MariaDB (mysql://…) connection string");
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) err("AUTH_SECRET must be at least 32 characters");
  else if (/replace-with|change-me/i.test(env.AUTH_SECRET)) err("AUTH_SECRET still has the example value");
  if (env.COOKIE_SECURE !== "true") warn("COOKIE_SECURE is not \"true\" — cookies are sent without the Secure flag (set it when served over HTTPS)");
  if (!env.APP_URL) warn("APP_URL is not set — payment callback URLs use the request host");
  else if (!env.APP_URL.startsWith("https://")) warn("APP_URL should start with https://");
  if (env.BILLING_MOCK === "true") {
    if (env.BILLING_MOCK_ALLOW_PRODUCTION === "true") err("the MOCK payment gateway is enabled in production (BILLING_MOCK_ALLOW_PRODUCTION=true) — test servers only");
    else warn("BILLING_MOCK=true is ignored in production — set it to false");
  }
  if (env.BILLING_WEBHOOK_SECRET && env.BILLING_WEBHOOK_SECRET.length < 32) err("BILLING_WEBHOOK_SECRET must be at least 32 characters");
  if (env.CRON_SECRET && env.CRON_SECRET.length < 16) warn("CRON_SECRET is shorter than 16 characters — the cron endpoints stay disabled");
  if (!env.CRON_SECRET) warn("CRON_SECRET is not set — /api/cron/* is disabled (needed on hosts that stop idle apps, e.g. cPanel)");
  return out;
}

export function logConfigIssues() {
  for (const i of productionConfigIssues()) console[i.level === "error" ? "error" : "warn"](`[config] ${i.level.toUpperCase()}: ${i.message}`);
}
