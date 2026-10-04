import { describe, expect, it } from "vitest";
import { normalizeBdMobile } from "@/lib/mobile";
import { fieldErrors, loginSchema, passwordSchema, registrationSchema } from "@/lib/validation";

const valid = { businessName: "রহিম স্টোর", ownerName: "আব্দুর রহিম", mobile: "01712345678", email: "", password: "Shop-2026x", confirmPassword: "Shop-2026x" };
const errorsOf = (input: Record<string, string>) => {
  const r = registrationSchema.safeParse(input);
  return r.success ? {} : fieldErrors(r.error);
};

describe("Bangladeshi mobile numbers", () => {
  it.each([
    ["01712345678", "01712345678"],
    ["+8801712345678", "01712345678"],
    ["8801712345678", "01712345678"],
    ["008801712345678", "01712345678"],
    ["017-1234 5678", "01712345678"],
    ["০১৭১২৩৪৫৬৭৮", "01712345678"],
    ["01312345678", "01312345678"],
  ])("normalises %s", (input, out) => expect(normalizeBdMobile(input)).toBe(out));

  it.each(["", "0171234567", "017123456789", "01212345678", "02712345678", "+1 555 123 4567", "01712abc678", "01712345678'; DROP TABLE"])("rejects %s", (input) => {
    expect(normalizeBdMobile(input)).toBeNull();
  });
});

describe("registration validation (server-side)", () => {
  it("accepts a valid sign-up and normalises mobile / e-mail", () => {
    const r = registrationSchema.parse({ ...valid, mobile: "+880 1712-345678", email: " Owner@Example.COM " });
    expect(r.mobile).toBe("01712345678");
    expect(r.email).toBe("owner@example.com");
    expect(r.businessName).toBe("রহিম স্টোর");
  });

  it("requires the mobile number and rejects invalid ones", () => {
    expect(errorsOf({ ...valid, mobile: "" }).mobile?.[0]).toBe("মোবাইল নম্বর আবশ্যক");
    expect(errorsOf({ ...valid, mobile: "12345" }).mobile?.[0]).toContain("সঠিক মোবাইল নম্বর");
  });

  it("requires business and owner names and refuses markup", () => {
    expect(errorsOf({ ...valid, businessName: "  " }).businessName?.[0]).toContain("আবশ্যক");
    expect(errorsOf({ ...valid, ownerName: "" }).ownerName?.[0]).toContain("আবশ্যক");
    expect(errorsOf({ ...valid, businessName: "<script>alert(1)</script>" }).businessName?.[0]).toContain("<");
  });

  it("rejects weak passwords", () => {
    expect(errorsOf({ ...valid, password: "Ab1", confirmPassword: "Ab1" }).password?.[0]).toContain("৮ অক্ষর");
    expect(errorsOf({ ...valid, password: "onlyletters", confirmPassword: "onlyletters" }).password?.[0]).toContain("সংখ্যা");
    expect(errorsOf({ ...valid, password: "12345678", confirmPassword: "12345678" }).password?.[0]).toContain("অক্ষর");
    expect(errorsOf({ ...valid, password: "password123", confirmPassword: "password123" }).password?.[0]).toContain("সহজ");
    expect(errorsOf({ ...valid, password: "x01712345678", confirmPassword: "x01712345678" }).password?.[0]).toContain("মোবাইল");
    expect(passwordSchema.safeParse("x".repeat(129) + "1").success).toBe(false);
    expect(passwordSchema.safeParse("বিজয়লেনদেন২০২৬").success).toBe(true); // Bangla letters and digits count
  });

  it("requires the confirmation to match", () => {
    expect(errorsOf({ ...valid, confirmPassword: "Shop-2026y" }).confirmPassword?.[0]).toBe("পাসওয়ার্ড দুটি মিলছে না");
  });

  it("rejects an invalid optional e-mail but allows it to be empty", () => {
    expect(errorsOf({ ...valid, email: "not-an-email" }).email?.[0]).toContain("ইমেইল");
    expect(registrationSchema.parse({ ...valid, email: "" }).email).toBeNull();
  });
});

describe("login identifier", () => {
  it("accepts a mobile number in any common format, or an e-mail", () => {
    expect(loginSchema.parse({ email: "+8801712345678", password: "x" }).email).toEqual({ kind: "mobile", value: "01712345678" });
    expect(loginSchema.parse({ email: "Admin@Example.com", password: "x" }).email).toEqual({ kind: "email", value: "admin@example.com" });
    expect(loginSchema.safeParse({ email: "hello", password: "x" }).success).toBe(false);
  });
});
