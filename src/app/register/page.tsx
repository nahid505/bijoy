import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/server/auth";
import { platformSettings } from "@/server/services/subscriptions";
import { registrationPolicy } from "@/server/services/registration";
import { otpAvailable } from "@/server/sms/otp";
import { AuthShell } from "../login/auth-shell";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "নতুন অ্যাকাউন্ট" };
export const dynamic = "force-dynamic";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const enabled = registrationPolicy().enabled;
  // ?plan=CODE from the pricing page: only an active, public plan is honoured
  const code = String((await searchParams).plan ?? "").toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 30);
  const [chosen, settings] = await Promise.all([code ? prisma.plan.findFirst({ where: { code, isActive: true, isPublic: true }, select: { code: true, nameBn: true } }) : null, platformSettings()]);
  const trial = settings.trialDays > 0 ? `${settings.trialDays} দিনের ফ্রি ট্রায়াল — কার্ড লাগবে না` : "আপনার ব্যবসার হিসাব শুরু করুন — কয়েক সেকেন্ডেই প্রস্তুত";
  return (
    <AuthShell
      wide
      title="নতুন অ্যাকাউন্ট তৈরি করুন"
      subtitle={trial}
      footer={
        <>
          আগে থেকেই অ্যাকাউন্ট আছে?{" "}
          <Link prefetch={false} href="/login" className="font-semibold text-brand-700 hover:underline">
            লগইন করুন
          </Link>
        </>
      }
    >
      {enabled ? <RegisterForm otpRequired={otpAvailable() && process.env.REGISTRATION_OTP !== "false"} plan={chosen ? { code: chosen.code, label: chosen.nameBn } : null} /> : <p className="text-sm text-slate-600">এই মুহূর্তে নতুন অ্যাকাউন্ট খোলা বন্ধ আছে। প্রশাসকের সাথে যোগাযোগ করুন।</p>}
    </AuthShell>
  );
}
