import type { Metadata } from "next";
import Link from "next/link";
import { ReportPage } from "@/components/report-page";
import { readParams, type SearchParams } from "@/server/params";

export const metadata: Metadata = { title: "খরচ" };

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <ReportPage
      slug="expenses"
      params={await readParams(searchParams)}
      basePath="/expenses"
      title="খরচ"
      description="দোকান ভাড়া, বেতন, বিল সহ সব পরিচালন খরচ — খাতভিত্তিক"
      crumbs={[{ label: "খরচ" }]}
      extraActions={<Link prefetch={false} href="/vouchers/payment/new?mode=expense" className="btn-primary">+ নতুন খরচ</Link>}
    />
  );
}
