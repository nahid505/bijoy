// Edge-safe session token helpers (used by middleware and server code).
// The token only proves "this is session <sid> of user <sub>"; the server checks the Session row
// (not revoked, not expired) on every request — see src/server/services/sessions.ts.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "bl_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

export interface SessionPayload {
  sub: string; // user id
  sid: string; // session id
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET env variable must be set (min 32 characters)");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(userId: string, sessionId: string): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return null; // pre-session tokens are no longer accepted
    return { sub: payload.sub, sid: payload.sid };
  } catch {
    return null;
  }
}
