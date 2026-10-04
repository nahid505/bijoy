import type { Metadata } from "next";
import { ReportPage } from "@/components/report-page";
import { readParams, type SearchParams } from "@/server/params";

export const metadata: Metadata = { title: "পাওনাদার" };

export default async function CreditorsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <ReportPage
      slug="suppliers"
      params={await readParams(searchParams)}
      basePath="/accounts/creditors"
      title="পাওনাদার (সরবরাহকারী দেনা)"
      description="সরবরাহকারীদের কাছে ব্যবসার দেনা — প্রতিটি সরবরাহকারীর নিজস্ব লেজার থেকে"
      crumbs={[{ label: "হিসাব" }, { label: "পাওনাদার" }]}
    />
  );
}
