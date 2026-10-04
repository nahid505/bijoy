// Login brute-force protection and session revocation, exercised through the real server actions
// (Next's request headers / cookies are replaced by an in-memory stand-in).
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

const req = vi.hoisted(() => ({ headers: new Headers(), cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  headers: async () => req.headers,
  cookies: async () => ({
    get: (name: string) => (req.cookies.has(name) ? { name, value: req.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void req.cookies.set(name, value),
    delete: (name: string) => void req.cookies.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { prisma } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/session";
import { changePasswordAction, loginAction, logoutAction } from "@/server/actions/auth";
import { getCurrentUser } from "@/server/auth";
import { beginLoginAttempt, LOGIN_POLICY } from "@/server/services/login-guard";
import { createSession, activeSessionUser, revokeAllSessions } from "@/server/services/sessions";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const LOCKED = "অনেকবার ব্যর্থ চেষ্টা";
const WRONG = "মোবাইল/ইমেইল বা পাসওয়ার্ড সঠিক নয়";
const PASSWORD = "Correct-Horse-9";

let seq = 0;
const randomIp = () => `${(seq % 200) + 1}.${(seq * 7) % 250}.${(seq * 13) % 250}.${++seq % 250}`;

async function newUser(tag: string) {
  const email = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@sec.test`;
  const user = await prisma.user.create({ data: { name: tag, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  return { ...user, email };
}

async function attempt(email: string, password: string, xff?: string) {
  req.headers = new Headers(xff ? { "x-forwarded-for": xff, "user-agent": "vitest" } : { "user-agent": "vitest" });
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  fd.set("next", "/dashboard");
  try {
    const r = await loginAction(null, fd);
    return { ok: false, message: r?.message ?? "" };
  } catch (e) {
    if ((e as Error).message === "NEXT_REDIRECT") return { ok: true, message: "" };
    throw e;
  }
}

run("login brute-force protection & session revocation", () => {
  beforeAll(() => {
    process.env.AUTH_SECRET ??= "test-secret-for-vitest-only-0123456789abcdef";
  });
  beforeEach(() => {
    req.cookies.clear();
    delete process.env.TRUSTED_PROXY_HOPS;
  });

  it("locks the ACCOUNT after 5 attempts even when every attempt sends a different X-Forwarded-For", async () => {
    const u = await newUser("spoof");
    for (let i = 0; i < LOGIN_POLICY.account.max; i++) expect((await attempt(u.email, `wrong-${i}`, randomIp())).message).toBe(WRONG);
    const blocked = await attempt(u.email, "wrong-again", randomIp());
    expect(blocked.message).toContain(LOCKED);
    // even the correct password is refused while locked, whatever header is sent
    const right = await attempt(u.email, PASSWORD, randomIp());
    expect(right.ok).toBe(false);
    expect(right.message).toContain(LOCKED);
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
  });

  it("also holds behind a trusted proxy: rotating client addresses cannot reset the account counter", async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    const u = await newUser("proxy");
    for (let i = 0; i < LOGIN_POLICY.account.max; i++) await attempt(u.email, `wrong-${i}`, `${randomIp()}, ${randomIp()}`);
    expect((await attempt(u.email, PASSWORD, `${randomIp()}, ${randomIp()}`)).message).toContain(LOCKED);
  });

  it("counts attempts per account for unknown e-mail addresses too (no enumeration shortcut)", async () => {
    const email = `ghost-${Date.now()}@sec.test`;
    for (let i = 0; i < LOGIN_POLICY.account.max; i++) expect((await attempt(email, "x", randomIp())).message).toBe(WRONG);
    expect((await attempt(email, "x", randomIp())).message).toContain(LOCKED);
  });

  it("limits a single client address behind a trusted proxy across many accounts (password spraying)", async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    const attacker = "203.0.113.200";
    const spoofed = (i: number) => `10.9.${i % 250}.1, ${attacker}`; // left part is attacker-controlled, rightmost is from the proxy
    for (let i = 0; i < LOGIN_POLICY.ip.max; i++) await attempt(`spray-${Date.now()}-${i}@sec.test`, "x", spoofed(i));
    expect((await attempt(`spray-${Date.now()}-new@sec.test`, "x", spoofed(999))).message).toContain(LOCKED);
    // a different real client behind the proxy is not affected
    expect((await attempt(`other-${Date.now()}@sec.test`, "x", "6.6.6.6, 198.51.100.44")).message).toBe(WRONG);
  });

  it("is race-safe: 20 parallel attempts on one account let at most 5 through", async () => {
    const email = `race-${Date.now()}@sec.test`;
    const decisions = await Promise.all(Array.from({ length: 20 }, () => beginLoginAttempt(prisma, email, null)));
    expect(decisions.filter((d) => d.allowed).length).toBe(LOGIN_POLICY.account.max);
  });

  it("unlocks after the lock period and a successful login resets the counter", async () => {
    const email = `expiry-${Date.now()}@sec.test`;
    const t0 = new Date();
    for (let i = 0; i <= LOGIN_POLICY.account.max; i++) await beginLoginAttempt(prisma, email, null, t0);
    expect((await beginLoginAttempt(prisma, email, null, new Date(t0.getTime() + 60_000))).allowed).toBe(false);
    expect((await beginLoginAttempt(prisma, email, null, new Date(t0.getTime() + LOGIN_POLICY.account.lockMs + 60_000))).allowed).toBe(true);

    const u = await newUser("reset");
    for (let i = 0; i < LOGIN_POLICY.account.max - 1; i++) await attempt(u.email, "wrong", randomIp());
    expect((await attempt(u.email, PASSWORD)).ok).toBe(true);
    req.cookies.clear();
    for (let i = 0; i < LOGIN_POLICY.account.max - 1; i++) expect((await attempt(u.email, "wrong")).message).toBe(WRONG); // counter started over
  });

  it("revokes every existing session immediately when the password is changed", async () => {
    const u = await newUser("pwchange");
    expect((await attempt(u.email, PASSWORD)).ok).toBe(true);
    const deviceA = req.cookies.get(SESSION_COOKIE)!;
    req.cookies.clear();
    expect((await attempt(u.email, PASSWORD)).ok).toBe(true);
    const deviceB = req.cookies.get(SESSION_COOKIE)!;
    expect(deviceA).not.toBe(deviceB);

    req.cookies.set(SESSION_COOKIE, deviceB);
    expect((await getCurrentUser())?.id).toBe(u.id);

    // change the password from device A
    req.cookies.set(SESSION_COOKIE, deviceA);
    const fd = new FormData();
    fd.set("currentPassword", PASSWORD);
    fd.set("newPassword", "Brand-New-Pass-42");
    fd.set("confirmPassword", "Brand-New-Pass-42");
    const r = await changePasswordAction(null, fd);
    expect(r?.ok).toBe(true);
    const deviceAfresh = req.cookies.get(SESSION_COOKIE)!;
    expect(deviceAfresh).not.toBe(deviceA);

    for (const stale of [deviceA, deviceB]) {
      req.cookies.set(SESSION_COOKIE, stale);
      expect(await getCurrentUser()).toBeNull(); // old tokens are dead, although still correctly signed and unexpired
    }
    req.cookies.set(SESSION_COOKIE, deviceAfresh);
    expect((await getCurrentUser())?.id).toBe(u.id); // the device that changed the password stays signed in
    expect(await prisma.session.count({ where: { userId: u.id, revokedAt: null } })).toBe(1);
  });

  it("logout revokes the session on the server, not just the cookie", async () => {
    const u = await newUser("logout");
    expect((await attempt(u.email, PASSWORD)).ok).toBe(true);
    const token = req.cookies.get(SESSION_COOKIE)!;
    await expect(logoutAction()).rejects.toThrow("NEXT_REDIRECT");
    req.cookies.set(SESSION_COOKIE, token); // attacker replays the copied cookie
    expect(await getCurrentUser()).toBeNull();
  });

  it("rejects expired sessions, sessions of deactivated users, and admin-revoked sessions", async () => {
    const u = await newUser("misc");
    const s = await createSession(prisma, u.id);
    expect(await activeSessionUser(prisma, s.id, u.id)).not.toBeNull();
    expect(await activeSessionUser(prisma, s.id, "someone-else")).toBeNull();
    await prisma.session.update({ where: { id: s.id }, data: { expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 2000) } });
    expect(await activeSessionUser(prisma, s.id, u.id)).toBeNull();
    const s2 = await createSession(prisma, u.id);
    await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    expect(await activeSessionUser(prisma, s2.id, u.id)).toBeNull();
    await prisma.user.update({ where: { id: u.id }, data: { isActive: true } });
    expect(await revokeAllSessions(prisma, u.id)).toBe(2); // the expired one is marked revoked as well
    expect(await activeSessionUser(prisma, s2.id, u.id)).toBeNull();
  });
});
