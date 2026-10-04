import type { Metadata } from "next";
import Link from "next/link";
import { ReportPage } from "@/components/report-page";
import { readParams, type SearchParams } from "@/server/params";

export const metadata: Metadata = { title: "কাস্টমার বাকি" };

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <ReportPage
      slug="customer-dues"
      params={await readParams(searchParams)}
      basePath="/dues/customers"
      title="কাস্টমার বাকি"
      description="কার কাছে কত বাকি, কতদিনের পুরনো ও কতটা মেয়াদোত্তীর্ণ — বাকি আদায়ের তালিকা"
      crumbs={[{ label: "কাস্টমার বাকি" }]}
      extraActions={<Link prefetch={false} href="/vouchers/receipt/new" className="btn-primary">+ টাকা আদায়</Link>}
    />
  );
}
