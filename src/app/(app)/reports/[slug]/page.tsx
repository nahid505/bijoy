import type { Metadata } from "next";
import { ReportPage } from "@/components/report-page";
import { findReport } from "@/server/reports/registry";
import { readParams, type SearchParams } from "@/server/params";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: findReport(slug)?.title ?? "রিপোর্ট" };
}

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SearchParams }) {
  const { slug } = await params;
  return <ReportPage slug={slug} params={await readParams(searchParams)} />;
}
