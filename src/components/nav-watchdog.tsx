"use client";

import { useEffect } from "react";

const GRACE_MS = 3000;

/**
 * Guards against an intermittent App Router bug where a soft navigation
 * receives its complete RSC payload but React never commits it — the page
 * stays frozen and every later navigation queues behind it. We watch the
 * router's own requests (navigations, and server actions that redirect); if
 * the URL still has not changed a few seconds after the response finished,
 * we fall back to a normal full-page load of the target.
 */
export function NavWatchdog() {
  useEffect(() => {
    const original = window.fetch;
    let generation = 0;

    const targetOf = (input: RequestInfo | URL, init: RequestInit | undefined, res: Response): string | null => {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (headers.get("next-router-prefetch")) return null;
      if (headers.get("next-action")) {
        const redirect = res.headers.get("x-action-redirect");
        return redirect ? redirect.split(";")[0] : null;
      }
      if (!headers.get("rsc")) return null;
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      url.searchParams.delete("_rsc");
      return url.pathname + url.search;
    };

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const startedAt = location.href;
      const res = await original.call(this, input, init);
      try {
        const target = targetOf(input, init, res);
        if (!target || res.status >= 400) return res; // server-action redirects arrive as 303 + RSC body
        const absolute = new URL(target, location.href);
        if (absolute.href === startedAt.split("#")[0]) return res; // refresh of the current page
        const mine = ++generation;
        // Wait for the body to finish (the router consumes the original stream).
        res
          .clone()
          .arrayBuffer()
          .then(() => {
            setTimeout(() => {
              if (mine === generation && location.href === startedAt) window.location.assign(absolute.href);
            }, GRACE_MS);
          })
          .catch(() => {});
      } catch {
        // never interfere with the request itself
      }
      return res;
    };
    return () => {
      window.fetch = original;
    };
  }, []);
  return null;
}
