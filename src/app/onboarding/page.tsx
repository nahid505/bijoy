import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getContext, requireUser } from "@/server/auth";
import { NewBusinessForm } from "@/components/new-business-form";

export const metadata: Metadata = { title: "নতুন ব্যবসা" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUser();
  if (await getContext()) redirect("/dashboard");
  if ((await requireUser()).isSuperAdmin) redirect("/admin");
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-lg">
        <h1 className="text-xl font-bold text-ink-900">স্বাগতম, {user.name}</h1>
        <p className="mb-5 mt-1 text-sm text-slate-500">শুরু করতে আপনার ব্যবসার তথ্য দিন। হিসাবের খাত (চার্ট অব অ্যাকাউন্টস), ইউনিট, গুদাম ও রোল স্বয়ংক্রিয়ভাবে তৈরি হবে।</p>
        <div className="panel p-6"><NewBusinessForm /></div>
      </div>
    </main>
  );
}
