import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { otpAvailable } from "@/server/sms/otp";
import { AuthShell } from "../login/auth-shell";
import { ResetPasswordForm } from "./reset-form";

export const metadata: Metadata = { title: "পাসওয়ার্ড রিসেট" };
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <AuthShell
      title="পাসওয়ার্ড রিসেট"
      subtitle="নিবন্ধিত মোবাইল নম্বরে এসএমএস কোড পাঠিয়ে নতুন পাসওয়ার্ড দিন"
      footer={<Link prefetch={false} href="/login" className="font-semibold text-brand-700 hover:underline">লগইনে ফিরে যান</Link>}
    >
      {otpAvailable() ? <ResetPasswordForm /> : <p className="text-sm text-slate-600">এই মুহূর্তে এসএমএস দিয়ে পাসওয়ার্ড রিসেট চালু নেই। ব্যবসার অ্যাডমিনকে পাসওয়ার্ড রিসেট করতে বলুন।</p>}
    </AuthShell>
  );
}
