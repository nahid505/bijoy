import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { AuthShell } from "../login/auth-shell";
import { ForgotPasswordForm } from "./forgot-form";

export const metadata: Metadata = { title: "পাসওয়ার্ড রিসেট" };
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <AuthShell
      title="পাসওয়ার্ড রিসেট"
      subtitle="নিবন্ধিত মোবাইল নম্বর বা ইমেইলে ওটিপি কোড পাঠিয়ে নতুন পাসওয়ার্ড দিন"
      footer={<Link prefetch={false} href="/login" className="font-semibold text-brand-700 hover:underline">লগইনে ফিরে যান</Link>}
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
