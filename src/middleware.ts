import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

const PUBLIC_PATHS = ["/login", "/register", "/forgot-password", "/pricing", "/api/health", "/api/cron", "/api/sms/dlr", "/api/billing/callback", "/api/billing/webhook"]; // /api/cron and /api/sms/dlr authenticate with their own secrets

/**
 * Per-request Content-Security-Policy. Scripts must carry this request's nonce (Next.js adds it
 * to its own scripts automatically); 'strict-dynamic' lets those load the app's chunks. Inline
 * style attributes are allowed (layout widths/colours); nothing else may be inlined or framed.
 */
function contentSecurityPolicy(nonce: string, https: boolean) {
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

function withSecurityHeaders(res: NextResponse, csp: string, https: boolean) {
  res.headers.set("Content-Security-Policy", csp);
  // HSTS only makes sense (and is only honoured) on HTTPS deployments
  if (https) res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return res;
}

// First line of defence: redirect unauthenticated requests. Fine-grained permission checks and
// the server-side session check (revocation) happen in every page, server action and API route.
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const https = process.env.COOKIE_SECURE === "true";
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, https);

  // "/" is the public landing page; /screenshots holds its images
  const isPublic = pathname === "/" || pathname.startsWith("/screenshots/") || PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname + search)}` : "";
    return withSecurityHeaders(NextResponse.redirect(url), csp, https);
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-pathname", pathname); // the app layout refuses pages of switched-off features
  requestHeaders.set("content-security-policy", csp); // Next.js reads the nonce from here
  return withSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), csp, https);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
