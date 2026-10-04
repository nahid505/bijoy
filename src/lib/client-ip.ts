// Client address resolution. Forwarded headers are written by whoever sent the request, so
// they are ignored unless the deployment explicitly declares how many trusted reverse proxies
// sit in front of the app (TRUSTED_PROXY_HOPS). Each trusted proxy appends the address it
// received the request from, so the client is the N-th entry from the RIGHT of
// X-Forwarded-For — anything further left was supplied by the client and is not trusted.

const IP_RE = /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]+$/i;

export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt(env.TRUSTED_PROXY_HOPS ?? "0", 10);
  return Number.isFinite(n) && n > 0 && n <= 10 ? n : 0;
}

/**
 * @returns the client IP, or null when it cannot be known reliably (no trusted proxy, or the
 *          proxy chain is shorter than configured). Callers must not treat null as an address.
 */
export function clientIpFrom(forwardedFor: string | null | undefined, hops: number): string | null {
  if (hops <= 0 || !forwardedFor) return null;
  const chain = forwardedFor.split(",").map((s) => s.trim()).filter(Boolean);
  if (chain.length < hops) return null;
  const ip = chain[chain.length - hops].replace(/^\[|\]$/g, "").replace(/^::ffff:/, "");
  return IP_RE.test(ip) ? ip : null;
}
