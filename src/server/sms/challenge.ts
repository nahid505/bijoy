// Short-lived signed token that carries "password already verified for user X" between the two
// login steps, so the password never has to be re-sent and the code step cannot be skipped.
import { SignJWT, jwtVerify } from "jose";

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "");

export async function createLoginChallenge(userId: string): Promise<string> {
  return new SignJWT({ purpose: "login-otp" }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("10m").sign(secret());
}

export async function readLoginChallenge(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return payload.purpose === "login-otp" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
