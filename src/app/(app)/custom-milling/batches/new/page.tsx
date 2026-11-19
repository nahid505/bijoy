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
  const role = resolveMillRole(ctx, sp.role);
  const settings = await getRiceMillSettings();

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
