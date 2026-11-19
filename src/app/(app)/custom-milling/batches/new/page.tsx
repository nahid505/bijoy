import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { requireContext } from "@/server/auth";
import {
  getOrCreateOwnerParty,
  getRiceMillSettings,
  resolveMillRole,
} from "@/lib/custom-milling";
import { CustomMillingTabs } from "../../custom-milling-ui";
import { WeighbridgeForm } from "./weighbridge-form";

export const metadata: Metadata = {
  title: "নতুন ধান গ্রহণ ও ওজন স্কেল এন্ট্রি",
};

export default async function NewCustomMillingBatchPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const settings = await getRiceMillSettings();
  const role = resolveMillRole(ctx, sp.role, settings);

  // RBAC: Partner has Read-Only access
  if (role === "MILL_PARTNER") {
    return (
      <div className="space-y-6">
        <PageHeader title="নতুন ধান গ্রহণ ও ওজন স্কেল" description="প্রবেশাধিকার সংরক্ষিত" />
        <CustomMillingTabs role={role} />
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-8 text-center text-blue-900">
          <span className="text-4xl">👁️</span>
          <h2 className="mt-2 text-lg font-bold">শুধুমাত্র দেখার অনুমতি (Read-Only)</h2>
          <p className="mt-1 text-sm text-blue-700">
            মিল পার্টনার (৪০%) হিসেবে আপনার অ্যাকাউন্টে নতুন ধান এন্ট্রি করার অনুমতি নেই। আপনি ব্যাচ তালিকা ও প্রতিবেদন দেখতে পারবেন।
          </p>
          <div className="mt-4">
            <Link href="/custom-milling/batches" className="btn-primary text-xs">
              ব্যাচ তালিকা দেখুন →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Ensure owner self party exists
  await getOrCreateOwnerParty();

  const parties = await prisma.millParty.findMany({
    orderBy: [{ isOwnerSelfParty: "desc" }, { name: "asc" }],
    select: { id: true, name: true, phone: true, isOwnerSelfParty: true },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <PageHeader
          title="নতুন ধান গ্রহণ ও ওজন স্কেল (Weighbridge Intake)"
          description="গাড়ির ওজন, খালি ওজন ও ঢলতা বাদ দিয়ে ৭৫ কেজি স্ট্যান্ডার্ড বস্তা তৈরি"
        />
        <Link
          href="/custom-milling/batches"
          prefetch={false}
          className="btn-outline text-xs"
        >
          ← ব্যাচ তালিকা
        </Link>
      </div>

      <CustomMillingTabs role={role} />

      <section className="panel max-w-4xl">
        <div className="panel-head flex items-center justify-between">
          <h2 className="panel-title flex items-center gap-2">
            <span>⚖️</span>
            <span>ধানের ওজন স্লিপ এন্ট্রি ফর্ম</span>
          </h2>
          <span className="text-xs text-slate-500 font-mono">
            ১ স্ট্যান্ডার্ড বস্তা = {settings.bagStandardKg} কেজি
          </span>
        </div>

        <div className="p-4 sm:p-6">
          <WeighbridgeForm
            parties={parties}
            defaultDhaltaPerBag={settings.defaultDhaltaPerBag}
            bagStandardKg={settings.bagStandardKg}
            role={role}
          />
        </div>
      </section>
    </div>
  );
}
