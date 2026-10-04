import type { Metadata } from "next";
import Link from "next/link";
import { ReportPage } from "@/components/report-page";
import { readParams, type SearchParams } from "@/server/params";

export const metadata: Metadata = { title: "সরবরাহকারী দেনা" };

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <ReportPage
      slug="supplier-dues"
      params={await readParams(searchParams)}
      basePath="/dues/suppliers"
      title="সরবরাহকারী দেনা"
      description="কোন সরবরাহকারীকে কত দেনা ও কতদিনের পুরনো"
      crumbs={[{ label: "সরবরাহকারী দেনা" }]}
      extraActions={<Link prefetch={false} href="/vouchers/payment/new" className="btn-primary">+ পরিশোধ</Link>}
    />
  );
}
