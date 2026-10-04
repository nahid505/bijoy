import { describe, expect, it } from "vitest";
import { clientIpFrom, trustedProxyHops } from "@/lib/client-ip";

describe("client address resolution", () => {
  it("ignores X-Forwarded-For entirely unless a trusted proxy is configured", () => {
    expect(clientIpFrom("203.0.113.9", 0)).toBeNull();
    expect(clientIpFrom("1.2.3.4, 5.6.7.8", 0)).toBeNull();
    expect(trustedProxyHops({})).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "abc" })).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "-1" })).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "1" })).toBe(1);
  });

  it("behind one trusted proxy uses the address that proxy appended (rightmost), never client-supplied entries", () => {
    // attacker sends "X-Forwarded-For: 6.6.6.6"; the proxy appends the real peer 198.51.100.7
    expect(clientIpFrom("6.6.6.6, 198.51.100.7", 1)).toBe("198.51.100.7");
    expect(clientIpFrom("1.1.1.1, 2.2.2.2, 3.3.3.3, 198.51.100.7", 1)).toBe("198.51.100.7");
    expect(clientIpFrom("198.51.100.7", 1)).toBe("198.51.100.7");
  });

  it("supports a chain of trusted proxies", () => {
    // client → CDN (appends client) → Caddy (appends CDN) → app : 2 trusted hops
    expect(clientIpFrom("6.6.6.6, 198.51.100.7, 10.0.0.2", 2)).toBe("198.51.100.7");
  });

  it("returns null for short chains or garbage instead of guessing", () => {
    expect(clientIpFrom("198.51.100.7", 2)).toBeNull();
    expect(clientIpFrom("", 1)).toBeNull();
    expect(clientIpFrom(null, 1)).toBeNull();
    expect(clientIpFrom("not-an-ip", 1)).toBeNull();
    expect(clientIpFrom("1.2.3.4, <script>", 1)).toBeNull();
  });

  it("normalises IPv6 and IPv4-mapped forms", () => {
    expect(clientIpFrom("2001:db8::1", 1)).toBe("2001:db8::1");
    expect(clientIpFrom("[2001:db8::1]", 1)).toBe("2001:db8::1");
    expect(clientIpFrom("::ffff:198.51.100.7", 1)).toBe("198.51.100.7");
  });
});
