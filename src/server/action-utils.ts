import "server-only";
import { Prisma } from "@prisma/client";
import { ZodError, type z, type ZodTypeAny } from "zod";
import { InvalidEntryError, UnbalancedVoucherError } from "@/lib/accounting";
import { UserError } from "@/lib/errors";
import { fieldErrors } from "@/lib/validation";
import { ForbiddenError } from "./auth";
import { normalizeNumericInput } from "@/lib/digits";

export { UserError };

export type ActionState = {
  ok: boolean;
  message?: string;
  errors?: Record<string, string[]>;
  /** extra values for multi-step forms (e.g. the login code step) */
  data?: Record<string, string>;
} | null;

export type GuardResult<T> = { ok: true; data: T } | { ok: false; message: string; errors?: Record<string, string[]> };

/**
 * Runs an action body and converts known failures into a form-friendly result.
 * NOTE: call redirect() AFTER guard(), never inside it.
 */
export async function guard<T>(fn: () => Promise<T>): Promise<GuardResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof ZodError) return { ok: false, message: "ফর্মের তথ্য সঠিক নয়", errors: fieldErrors(err) };
    if (err instanceof UserError) return { ok: false, message: err.message, ...(err.fields ? { errors: err.fields } : {}) };
    if (err instanceof ForbiddenError || err instanceof InvalidEntryError || err instanceof UnbalancedVoucherError) {
      return { ok: false, message: err.message };
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") return { ok: false, message: "এই তথ্য আগে থেকেই বিদ্যমান (ডুপ্লিকেট)" };
      if (err.code === "P2003") return { ok: false, message: "সংশ্লিষ্ট লেনদেন থাকায় এই কাজ করা যাবে না" };
      if (err.code === "P2025") return { ok: false, message: "রেকর্ড পাওয়া যায়নি" };
      if (err.code === "P2034") return { ok: false, message: "একই সময়ে অন্য লেনদেন চলছিল — আবার চেষ্টা করুন" };
    }
    console.error(err);
    return { ok: false, message: "অপ্রত্যাশিত ত্রুটি ঘটেছে, আবার চেষ্টা করুন" };
  }
}

/**
 * A value typed as a number in Bangla, English or mixed digits ("১২451৩৩", "১,২৫০.৫০") reaches validation as a plain
 * English number ("1245133", "1250.50"). Text that merely contains digits ("Miniket চাল ৫০kg") is kept as typed, and so
 * are passwords (they must match exactly what the user chose).
 */
export function normalizeNumericValue(key: string, value: string): string {
  return /password/i.test(key) ? value : normalizeNumericInput(value);
}

/** normalizeNumericValue through a JSON payload (voucher / challan editors send their lines as JSON). */
function normalizeNumericDeep(value: unknown, key = ""): unknown {
  if (typeof value === "string") return normalizeNumericValue(key, value);
  if (Array.isArray(value)) return value.map((v) => normalizeNumericDeep(v, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeNumericDeep(v, k)]));
  return value;
}

export function formToObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = normalizeNumericValue(k, v);
  return out;
}

export function parseForm<S extends ZodTypeAny>(schema: S, fd: FormData): z.output<S> {
  return schema.parse(formToObject(fd));
}

export function parseJsonPayload<S extends ZodTypeAny>(schema: S, fd: FormData): z.output<S> {
  const raw = fd.get("payload");
  if (typeof raw !== "string") throw new UserError("অবৈধ অনুরোধ");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new UserError("অবৈধ অনুরোধ");
  }
  return schema.parse(normalizeNumericDeep(data));
}

export function toResult<T>(r: GuardResult<T>): ActionState {
  return r.ok ? { ok: true } : { ok: false, message: r.message, errors: r.errors };
}

export function safeReturnPath(value: FormDataEntryValue | null, fallback: string): string {
  const s = typeof value === "string" ? value : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : fallback;
}
