import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { registrationPolicy } from "@/server/services/registration";
import { otpAvailable } from "@/server/sms/otp";
import { AuthShell } from "../login/auth-shell";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "নতুন অ্যাকাউন্ট" };
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  const enabled = registrationPolicy().enabled;
  return (
    <AuthShell
      wide
      title="নতুন অ্যাকাউন্ট তৈরি করুন"
      subtitle="আপনার ব্যবসার হিসাব শুরু করুন — কয়েক সেকেন্ডেই প্রস্তুত"
      footer={
        <>
          আগে থেকেই অ্যাকাউন্ট আছে?{" "}
          <Link prefetch={false} href="/login" className="font-semibold text-brand-700 hover:underline">
            লগইন করুন
          </Link>
        </>
      }
    >
      {enabled ? <RegisterForm otpRequired={otpAvailable() && process.env.REGISTRATION_OTP !== "false"} /> : <p className="text-sm text-slate-600">এই মুহূর্তে নতুন অ্যাকাউন্ট খোলা বন্ধ আছে। প্রশাসকের সাথে যোগাযোগ করুন।</p>}
    </AuthShell>
  );
}
