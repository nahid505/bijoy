import type { Metadata } from "next";
import Link from "next/link";
import { ReportPage } from "@/components/report-page";
import { readParams, type SearchParams } from "@/server/params";
import { can, requireContext } from "@/server/auth";

export const metadata: Metadata = { title: "খরচ" };

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  if (!can(ctx, ["expense:view", "reports:view"])) {
    return (
      <div className="card mx-auto mt-16 max-w-lg p-10 text-center">
        <p className="text-5xl">💸</p>
        <p className="mt-3 font-mono text-sm font-bold tracking-wide text-credit">403 — Forbidden</p>
        <h1 className="mt-4 text-xl font-bold text-slate-800">প্রবেশাধিকার নেই</h1>
        <p className="mt-2 text-sm text-slate-500">এই খরচ এন্ট্রি বা দেখার আপনার অনুমতি নেই</p>
        <div className="mt-6 flex justify-center gap-2">
          <Link prefetch={false} href="/dashboard" className="btn-primary">ড্যাশবোর্ডে ফিরুন</Link>
        </div>
      </div>
    );
  }

  return (
    <ReportPage
      slug="expenses"
      params={await readParams(searchParams)}
      basePath="/expenses"
      title="খরচ"
      description="দোকান ভাড়া, বেতন, বিল সহ সব পরিচালন খরচ — খাতভিত্তিক"
      crumbs={[{ label: "খরচ" }]}
      extraActions={can(ctx, ["expense:create", "vouchers:create"]) ? <Link prefetch={false} href="/vouchers/payment/new?mode=expense" className="btn-primary">+ নতুন খরচ</Link> : null}
    />
  );
}

