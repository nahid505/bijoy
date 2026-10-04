"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { changePasswordSchema, loginSchema, mobileSchema, profileSchema, registrationSchema, resetPasswordSchema } from "@/lib/validation";
import { clearSessionCookie, getClientIp, getCurrentUser, setBusinessCookie, setSessionCookie } from "../auth";
import { flash } from "../flash";
import { registerAccount } from "../services/registration";
import { audit } from "../audit";
import { formToObject, guard, parseForm, UserError, type ActionState } from "../action-utils";
import { formatDate, formatDateTime, toBnDigits } from "@/lib/format";
import { beginLoginAttempt, loginSucceeded, reserveAttempt } from "../services/login-guard";
import { revokeAllSessions } from "../services/sessions";
import { createLoginChallenge, readLoginChallenge } from "../sms/challenge";
import { issueOtp, otpAvailable, verifyOtp } from "../sms/otp";
import { enqueueSms, kickSmsQueue } from "../sms/queue";
import { renderTemplate, SMS_EVENT } from "@/lib/sms-text";

// Always run one bcrypt compare so response time does not reveal whether an email exists.
let dummyHash: string | null = null;
function getDummyHash() {
  dummyHash ??= bcrypt.hashSync("bijoy-lenden-dummy-password", 12);
  return dummyHash;
}

/** Signs the user in: creates the server session, and sends the optional new-login SMS alert. */
async function completeLogin(user: { id: string; email: string | null; mobile: string | null; loginAlertEnabled: boolean }, typed: string) {
  await loginSucceeded(prisma, [user.email, user.mobile, typed], user.id);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const sessionId = await setSessionCookie(user.id);
  await audit({ userId: user.id, action: "LOGIN", entity: "Auth", entityId: user.id });
  if (user.loginAlertEnabled && user.mobile && otpAvailable()) {
    try {
      const now = new Date();
      const r = await enqueueSms(prisma, {
        businessId: null, event: "NEW_LOGIN_ALERT", recipient: user.mobile, userId: user.id, priority: 5, dedupeKey: `login:${sessionId}`,
        body: renderTemplate(SMS_EVENT.NEW_LOGIN_ALERT.defaultBody, { date: formatDate(now), time: formatDateTime(now).split(" ").slice(-1)[0] }),
      });
      if (r.status === "queued") kickSmsQueue(prisma);
    } catch (e) {
      console.error("[sms] login alert skipped:", e instanceof Error ? e.message : e); // never blocks the login
    }
  }
}

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const nextUrl = String(fd.get("next") || "/dashboard");
  const challenge = String(fd.get("challenge") ?? "");
  let otpStep: Record<string, string> | null = null;
  const result = await guard(async () => {
    // ── step 2: SMS code after a verified password
    if (challenge) {
      const userId = await readLoginChallenge(challenge);
      const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
      if (!user || !user.isActive || !user.mobile) throw new UserError("লগইনের সময় শেষ — আবার শুরু করুন");
      if (!(await verifyOtp(prisma, "LOGIN", user.mobile, String(fd.get("otp") ?? "")))) {
        otpStep = { step: "otp", challenge, mobile: maskMobile(user.mobile) };
        await audit({ userId: user.id, action: "LOGIN_FAILED", entity: "Auth", details: { reason: "otp" } });
        throw new UserError("কোডটি সঠিক নয় বা মেয়াদ শেষ হয়ে গেছে", { otp: ["কোডটি সঠিক নয় বা মেয়াদ শেষ হয়ে গেছে"] });
      }
      await completeLogin(user, user.mobile);
      return;
    }

    // ── step 1: password
    const { email: login, password } = parseForm(loginSchema, fd);
    const user = await prisma.user.findUnique({ where: login.kind === "email" ? { email: login.value } : { mobile: login.value } });
    // Attempts are counted per ACCOUNT (typed identifier + the user it belongs to; per client
    // address only behind a trusted proxy) before the password is checked — a spoofed
    // X-Forwarded-For or switching between e-mail and mobile cannot reset the count.
    const decision = await beginLoginAttempt(prisma, login.value, await getClientIp(), new Date(), user?.id);
    if (!decision.allowed) {
      await audit({ userId: null, action: "LOGIN_FAILED", entity: "Auth", details: { login: login.value, blocked: decision.reason ?? "account" } });
      throw new UserError(`অনেকবার ব্যর্থ চেষ্টা হয়েছে। ${toBnDigits(decision.retryAfterMinutes ?? 15)} মিনিট পর আবার চেষ্টা করুন।`);
    }
    const valid = await bcrypt.compare(password, user?.passwordHash ?? getDummyHash());
    if (!user || !valid || !user.isActive) {
      await audit({ userId: user?.id ?? null, action: "LOGIN_FAILED", entity: "Auth", details: { login: login.value } });
      throw new UserError(user && valid && !user.isActive ? "অ্যাকাউন্টটি নিষ্ক্রিয় করা হয়েছে" : "মোবাইল/ইমেইল বা পাসওয়ার্ড সঠিক নয়");
    }
    if (user.loginOtpEnabled && user.mobile && otpAvailable()) {
      await issueOtp(prisma, "LOGIN", user.mobile, { clientIp: await getClientIp(), userId: user.id });
      otpStep = { step: "otp", challenge: await createLoginChallenge(user.id), mobile: maskMobile(user.mobile) };
      return;
    }
    await completeLogin(user, login.value);
  });
  if (otpStep) return { ok: false, message: result.ok ? `${(otpStep as Record<string, string>).mobile} নম্বরে পাঠানো ৬ অঙ্কের কোড দিন` : result.message, errors: result.ok ? undefined : result.errors, data: otpStep };
  if (!result.ok) return { ok: false, message: result.message, errors: result.errors };
  redirect(nextUrl.startsWith("/") && !nextUrl.startsWith("//") ? nextUrl : "/dashboard");
}

const maskMobile = (m: string) => `${m.slice(0, 3)}•••••${m.slice(-3)}`;

/**
 * Self-service sign-up. Validates everything on the server, refuses bots (honeypot) and floods
 * (database-backed throttles), creates the owner + an isolated, fully configured business in one
 * transaction, then signs the new owner in and opens the dashboard.
 */
export async function registerAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    // hidden field that humans never fill in: bots get a generic refusal and nothing is created
    if (String(fd.get("website") ?? "").trim() !== "") throw new UserError("অনুরোধটি গ্রহণ করা যায়নি");
    const input = registrationSchema.parse(formToObject(fd));
    if (registrationOtpRequired() && !(await verifyOtp(prisma, "REGISTRATION", input.mobile, String(fd.get("otp") ?? "")))) {
      throw new UserError("মোবাইলে পাঠানো কোডটি সঠিক নয় বা মেয়াদ শেষ", { otp: ["মোবাইলে পাঠানো কোডটি সঠিক নয় বা মেয়াদ শেষ"] });
    }
    const created = await registerAccount(prisma, input, { clientIp: await getClientIp() });
    await setSessionCookie(created.user.id);
    await setBusinessCookie(created.business.id);
    await audit({ businessId: created.business.id, userId: created.user.id, action: "LOGIN", entity: "Auth", entityId: created.user.id, details: { via: "registration" } });
    return created;
  });
  if (!result.ok) return toLoginResult(result);
  await flash(`স্বাগতম! "${result.data.business.name}" এর হিসাব প্রস্তুত — হিসাবের খাত, ইউনিট ও গুদাম তৈরি হয়েছে।`);
  redirect("/dashboard");
}

/** Registration needs a verified mobile whenever the server can send SMS (REGISTRATION_OTP=false turns it off). */
function registrationOtpRequired() {
  return otpAvailable() && process.env.REGISTRATION_OTP !== "false";
}

export async function requestRegistrationOtpAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const mobile = mobileSchema.parse(String(fd.get("mobile") ?? ""));
    if (await prisma.user.findUnique({ where: { mobile }, select: { id: true } })) {
      throw new UserError("এই মোবাইল নম্বর দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে — লগইন করুন", { mobile: ["এই মোবাইল নম্বর দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে"] });
    }
    await issueOtp(prisma, "REGISTRATION", mobile, { clientIp: await getClientIp() });
  });
  return result.ok ? { ok: true, message: "আপনার মোবাইলে ৬ অঙ্কের কোড পাঠানো হয়েছে (৫ মিনিট বৈধ)" } : toLoginResult(result);
}

const RESET_SENT = "এই নম্বরে কোনো অ্যাকাউন্ট থাকলে ৬ অঙ্কের কোড পাঠানো হয়েছে (৫ মিনিট বৈধ)।";

/** Step 1 of password reset. The answer never reveals whether the number has an account. */
export async function requestPasswordResetAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const mobile = mobileSchema.parse(String(fd.get("mobile") ?? ""));
    if (!otpAvailable()) throw new UserError("এই মুহূর্তে এসএমএস দিয়ে পাসওয়ার্ড রিসেট সম্ভব নয় — প্রশাসকের সাথে যোগাযোগ করুন");
    const user = await prisma.user.findUnique({ where: { mobile }, select: { id: true, isActive: true } });
    if (user?.isActive) {
      try {
        await issueOtp(prisma, "PASSWORD_RESET", mobile, { clientIp: await getClientIp(), userId: user.id });
      } catch (e) {
        if (e instanceof UserError && /অনেকবার|অপেক্ষা/.test(e.message ?? "")) throw e;
        console.error("[sms] password reset code not sent:", e instanceof Error ? e.message : e);
      }
    } else if (await reserveAttempt(prisma, `otp:PASSWORD_RESET:${mobile}`, { max: 3, windowMs: 15 * 60_000, lockMs: 15 * 60_000 }, new Date())) {
      // the same limit applies to unknown numbers, so limits do not reveal which numbers exist
      throw new UserError("অনেকবার কোড চাওয়া হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।");
    }
    return mobile;
  });
  return result.ok ? { ok: true, message: RESET_SENT, data: { step: "code", mobile: result.data } } : toLoginResult(result);
}

/** Step 2: code + new password. Every existing session of the user is ended. */
export async function resetPasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const input = resetPasswordSchema.parse(formToObject(fd));
    const user = await prisma.user.findUnique({ where: { mobile: input.mobile } });
    if (!user?.isActive || !(await verifyOtp(prisma, "PASSWORD_RESET", input.mobile, input.otp))) {
      throw new UserError("কোডটি সঠিক নয় বা মেয়াদ শেষ হয়ে গেছে", { otp: ["কোডটি সঠিক নয় বা মেয়াদ শেষ হয়ে গেছে"] });
    }
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(input.newPassword, 12) } });
    const revoked = await revokeAllSessions(prisma, user.id);
    await loginSucceeded(prisma, [user.email, user.mobile], user.id); // a locked-out owner can sign in with the new password
    await audit({ userId: user.id, action: "UPDATE", entity: "User", entityId: user.id, details: { field: "password", via: "sms-reset", sessionsRevoked: revoked } });
  });
  if (!result.ok) return { ok: false, message: result.message, errors: result.errors, data: { step: "code", mobile: String(fd.get("mobile") ?? "") } };
  await flash("পাসওয়ার্ড পরিবর্তন হয়েছে — নতুন পাসওয়ার্ড দিয়ে লগইন করুন");
  redirect("/login");
}

/** Login code (second step) and new-login SMS alert, per user. */
export async function updateSecurityPrefsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const current = await getCurrentUser();
    if (!current) throw new UserError("আবার লগইন করুন");
    const loginOtpEnabled = fd.get("loginOtpEnabled") === "on";
    const loginAlertEnabled = fd.get("loginAlertEnabled") === "on";
    if ((loginOtpEnabled || loginAlertEnabled) && !current.mobile) throw new UserError("আগে প্রোফাইলে আপনার মোবাইল নম্বর যোগ করুন");
    if (loginOtpEnabled && !otpAvailable()) throw new UserError("সার্ভারে এসএমএস কনফিগার করা নেই — লগইন কোড চালু করা যাবে না");
    await prisma.user.update({ where: { id: current.id }, data: { loginOtpEnabled, loginAlertEnabled } });
    await audit({ userId: current.id, action: "UPDATE", entity: "User", entityId: current.id, details: { loginOtpEnabled, loginAlertEnabled } });
  });
  return result.ok ? { ok: true, message: "নিরাপত্তা সেটিং সংরক্ষণ হয়েছে" } : toLoginResult(result);
}

function toLoginResult(r: { ok: false; message: string; errors?: Record<string, string[]> }): ActionState {
  return { ok: false, message: r.message, errors: r.errors };
}

export async function logoutAction() {
  const user = await getCurrentUser();
  if (user) await audit({ userId: user.id, action: "LOGOUT", entity: "Auth", entityId: user.id });
  await clearSessionCookie();
  redirect("/login");
}

export async function changePasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const current = await getCurrentUser();
    if (!current) throw new UserError("আবার লগইন করুন");
    const input = parseForm(changePasswordSchema, fd);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: current.id } });
    if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) throw new UserError("বর্তমান পাসওয়ার্ড সঠিক নয়");
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(input.newPassword, 12) } });
    // every existing session (other devices, stolen cookies) ends now; this device gets a new one
    const revoked = await revokeAllSessions(prisma, user.id);
    await setSessionCookie(user.id);
    await audit({ userId: user.id, action: "UPDATE", entity: "User", entityId: user.id, details: { field: "password", sessionsRevoked: revoked } });
  });
  return result.ok ? { ok: true, message: "পাসওয়ার্ড পরিবর্তন হয়েছে" } : { ok: false, message: result.message, errors: result.errors };
}

export async function updateProfileAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const current = await getCurrentUser();
    if (!current) throw new UserError("আবার লগইন করুন");
    const input = parseForm(profileSchema, fd);
    if (input.mobile && input.mobile !== current.mobile && (await prisma.user.findUnique({ where: { mobile: input.mobile }, select: { id: true } }))) {
      throw new UserError("এই মোবাইল নম্বর অন্য অ্যাকাউন্টে ব্যবহার হচ্ছে", { mobile: ["এই মোবাইল নম্বর অন্য অ্যাকাউন্টে ব্যবহার হচ্ছে"] });
    }
    if (!input.mobile && !current.email) throw new UserError("ইমেইল না থাকায় মোবাইল নম্বর মুছে ফেলা যাবে না", { mobile: ["মোবাইল নম্বর আবশ্যক"] });
    await prisma.user.update({ where: { id: current.id }, data: { name: input.name, mobile: input.mobile, ...(input.mobile ? {} : { loginOtpEnabled: false }) } });
  });
  revalidatePath("/", "layout");
  return result.ok ? { ok: true, message: "প্রোফাইল হালনাগাদ হয়েছে" } : { ok: false, message: result.message, errors: result.errors };
}
