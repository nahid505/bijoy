import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { registrationPolicy } from "@/server/services/registration";
import { otpAvailable } from "@/server/sms/otp";
import { AuthShell } from "./auth-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "লগইন" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { next } = await searchParams;

  return (
    <AuthShell
      title="লগইন করুন"
      subtitle="আপনার ব্যবসার হিসাবে প্রবেশ করুন"
      footer={
        registrationPolicy().enabled && (
          <>
            নতুন ব্যবসা শুরু করছেন?{" "}
            <Link prefetch={false} href="/register" className="font-semibold text-brand-700 hover:underline">
              নতুন অ্যাকাউন্ট তৈরি করুন
            </Link>
          </>
        )
      }
    >
      <LoginForm next={next ?? "/dashboard"} resetAvailable={otpAvailable()} />
    </AuthShell>
  );
}
