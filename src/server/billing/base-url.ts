import "server-only";
import { headers } from "next/headers";

/**
 * Public base URL for gateway callbacks. APP_URL (e.g. https://app.bijoylenden.com) is used when set —
 * recommended in production; otherwise the request's own origin (Host header; the forwarded protocol
 * is honoured only behind a trusted proxy).
 */
export async function appBaseUrl(): Promise<string> {
  const fixed = process.env.APP_URL?.replace(/\/+$/, "");
  if (fixed) return fixed;
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = process.env.TRUSTED_PROXY_HOPS && Number(process.env.TRUSTED_PROXY_HOPS) > 0 ? h.get("x-forwarded-proto") ?? "http" : process.env.COOKIE_SECURE === "true" ? "https" : "http";
  return `${proto}://${host}`;
}
