import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { AuthShell } from "../login/auth-shell";
import { ResetPasswordForm } from "./reset-form";

export const metadata: Metadata = { title: "পাসওয়ার্ড রিসেট" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ identifier?: string; mobile?: string }> }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const params = await searchParams;
  const identifier = params.identifier || params.mobile || "";

  return (
    <AuthShell
      title="পাসওয়ার্ড রিসেট"
      subtitle="ওটিপি কোড ও নতুন পাসওয়ার্ড দিয়ে পরিবর্তন করুন"
      footer={<Link prefetch={false} href="/login" className="font-semibold text-brand-700 hover:underline">লগইনে ফিরে যান</Link>}
    >
      <ResetPasswordForm identifier={identifier} />
    </AuthShell>
  );
}
