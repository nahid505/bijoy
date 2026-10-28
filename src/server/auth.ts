import "server-only";
import { cache } from "react";
import { blockedPermissions, FEATURE_KEYS } from "@/lib/features";
import { featureAccess } from "./features";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma, num } from "@/lib/db";
import { normalizeThresholds } from "@/lib/expiry";
import { hasPermission, type Permission } from "@/lib/permissions";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, createSessionToken, verifySessionToken } from "@/lib/session";
import { clientIpFrom, trustedProxyHops } from "@/lib/client-ip";
import { activeSessionUser, createSession, revokeSession } from "./services/sessions";
import { strList } from "@/lib/dialect";
import { loadPartyScope, restrictionsOf, type PartyScope } from "./party-scope";

export const BUSINESS_COOKIE = "bl_business";

export interface CurrentUser {
  id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  /** platform operator (Super Admin panel) — set only by scripts/grant-super-admin.ts */
  isSuperAdmin: boolean;
}

export interface BusinessSummary {
  id: string;
  name: string;
  roleName: string;
}

export interface AppContext {
  user: CurrentUser;
  business: {
    id: string;
    name: string;
    logo: string | null;
    address: string | null;
    mobile: string | null;
    email: string | null;
    binNumber: string | null;
    tinNumber: string | null;
    currencySymbol: string;
    fiscalYearStartMonth: number;
    booksStartDate: Date;
    invoicePrefix: string;
    defaultVatPercent: number;
    invoiceFooter: string | null;
    invoiceTerms: string | null;
    expiryWarningDays: number[];
    allowExpiredSale: boolean;
    /** the primary type, e.g. "DEPOT" (depot management dashboard, menus and reports) */
    businessType: string | null;
    /** every type chosen in settings — decides the modules the sidebar shows (businessModules in src/lib/business-types.ts) */
    businessTypes: string[];
  };
  roleName: string;
  /** role permissions, plus "!key" blocks for permissions of switched-off features */
  permissions: string[];
  /** features switched on for this business (src/lib/features.ts) */
  features: string[];
  /** the member holds the business's system Owner role */
  isOwner: boolean;
  /** features the subscription plan allows (before the company's own on/off choice) */
  entitled: string[];
  /** subscription summary for banners / billing redirects (null: no subscription row) */
  subscription: { status: string; blocked: boolean; daysLeft: number | null; inGrace: boolean; accessUntil: Date | null } | null;
  businesses: BusinessSummary[];
  /** "শুধু নির্ধারিত কাস্টমার / সরবরাহকারী": the party accounts this member may see (null = all) — src/server/party-scope.ts */
  partyScope: PartyScope;
  /** shape expected by services */
  svc: { businessId: string; userId: string };
}

/** Signed-in user, re-validated against the DB on every request (memoised per request). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const store = await cookies();
  const token = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!token) return null;
  // the session row decides: revoked (logout, password change/reset) or expired → signed out
  const user = await activeSessionUser(prisma, token.sid, token.sub);
  return user ? { id: user.id, name: user.name, email: user.email, mobile: user.mobile, isSuperAdmin: user.isSuperAdmin } : null;
});

/** Id of the session behind the current request (for logout / "keep this device signed in"). */
export async function currentSessionId(): Promise<string | null> {
  const store = await cookies();
  return (await verifySessionToken(store.get(SESSION_COOKIE)?.value))?.sid ?? null;
}

/**
 * User + selected business + permissions. The business comes from a cookie but is
 * ALWAYS checked against the user's active memberships — a user can never act on a
 * business they don't belong to.
 */
export const getContext = cache(async (): Promise<AppContext | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id, isActive: true, business: { isActive: true } },
    include: { business: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) return null;
  const store = await cookies();
  const wanted = store.get(BUSINESS_COOKIE)?.value;
  const m = memberships.find((x) => x.businessId === wanted) ?? memberships[0];
  const b = m.business;
  // switched-off features: their own permissions are blocked; without Multi User only the Owner may act
  const access = await featureAccess(b.id);
  const on = access.on;
  const off = FEATURE_KEYS.filter((k) => !on.has(k));
  const isOwner = m.role.isSystem;
  const eff = access.effective;
  // a suspended subscription leaves only the billing pages (to pay / contact the platform)
  const billingOnly = strList(m.role.permissions).filter((p) => p === "*" || p === "billing:view" || p === "billing:manage").map((p) => (p === "*" ? ["billing:view", "billing:manage"] : [p])).flat();
  const partyScope = await loadPartyScope(b.id, user.id, restrictionsOf(m.role.permissions, isOwner));
  const permissions = eff?.blocked ? billingOnly : !on.has("MULTI_USER") && !isOwner ? [] : [...strList(m.role.permissions), ...blockedPermissions(off).map((x) => `!${x}`)];
  return {
    user,
    business: {
      id: b.id,
      name: b.name,
      logo: b.logo,
      address: b.address,
      mobile: b.mobile,
      email: b.email,
      binNumber: b.binNumber,
      tinNumber: b.tinNumber,
      currencySymbol: b.currencySymbol,
      fiscalYearStartMonth: b.fiscalYearStartMonth,
      booksStartDate: b.booksStartDate,
      invoicePrefix: b.invoicePrefix,
      defaultVatPercent: num(b.defaultVatPercent),
      invoiceFooter: b.invoiceFooter,
      invoiceTerms: b.invoiceTerms,
      expiryWarningDays: normalizeThresholds(b.expiryWarningDays),
      allowExpiredSale: b.allowExpiredSale,
      businessType: b.businessType,
      businessTypes: strList(b.businessTypes),
    },
    roleName: m.role.name,
    permissions,
    features: [...on],
    isOwner,
    entitled: [...access.entitled],
    subscription: eff ? { status: eff.status, blocked: eff.blocked, daysLeft: eff.daysLeft, inGrace: eff.inGrace, accessUntil: eff.accessUntil } : null,
    businesses: memberships.map((x) => ({ id: x.businessId, name: x.business.name, roleName: x.role.name })),
    partyScope,
    svc: { businessId: b.id, userId: user.id },
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages inside a business. No business yet → onboarding. */
export async function requireContext(): Promise<AppContext> {
  await requireUser();
  const ctx = await getContext();
  if (!ctx) redirect("/onboarding");
  return ctx;
}

export class ForbiddenError extends Error {
  constructor(message = "এই কাজের অনুমতি আপনার নেই") {
    super(message);
  }
}

export async function requirePermission(permission: Permission | readonly Permission[]): Promise<AppContext> {
  const ctx = await requireContext();
  if (!hasPermission(ctx.permissions, permission)) redirect("/forbidden");
  return ctx;
}

/** For server actions / API routes: throws instead of redirecting. */
export async function assertPermission(permission: Permission | readonly Permission[]): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx || !hasPermission(ctx.permissions, permission)) throw new ForbiddenError();
  return ctx;
}

/** A list means "any of these". */
export function can(ctx: AppContext, permission: Permission | readonly Permission[]): boolean {
  return hasPermission(ctx.permissions, permission);
}

const cookieBase = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.COOKIE_SECURE === "true",
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
});

/** Starts a new server-side session for the user and sets its cookie. */
export async function setSessionCookie(userId: string) {
  const h = await headers();
  const session = await createSession(prisma, userId, { ipAddress: await getClientIp(), userAgent: h.get("user-agent") });
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(userId, session.id), cookieBase());
  return session.id;
}

export async function setBusinessCookie(businessId: string) {
  const store = await cookies();
  store.set(BUSINESS_COOKIE, businessId, { ...cookieBase(), maxAge: 60 * 60 * 24 * 365 });
}

/** Revokes the current session on the server and removes its cookie. */
export async function clearSessionCookie() {
  const sid = await currentSessionId();
  if (sid) await revokeSession(prisma, sid);
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * Client address for audit logs and rate limiting. Forwarded headers are client-controlled, so
 * they are only used when TRUSTED_PROXY_HOPS declares the reverse proxies in front of the app;
 * otherwise the address is unknown (null) and must not be used as a security key.
 */
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  return clientIpFrom(h.get("x-forwarded-for"), trustedProxyHops());
}
