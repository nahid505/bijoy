import type { Metadata } from "next";
import { ReportPage } from "@/components/report-page";
import { readParams, type SearchParams } from "@/server/params";

export const metadata: Metadata = { title: "দেনাদার" };

export default async function DebtorsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <ReportPage
      slug="customers"
      params={await readParams(searchParams)}
      basePath="/accounts/debtors"
      title="দেনাদার (কাস্টমার পাওনা)"
      description="কাস্টমারদের কাছে ব্যবসার পাওনা — প্রতিটি কাস্টমারের নিজস্ব লেজার থেকে"
      crumbs={[{ label: "হিসাব" }, { label: "দেনাদার" }]}
    />
  );
}
