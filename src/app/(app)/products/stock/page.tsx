import type { Metadata } from "next";
import Link from "next/link";
import { ReportPage } from "@/components/report-page";
import { WarehousePanel } from "@/server/catalog-pages";
import { readParams, type SearchParams } from "@/server/params";

export const metadata: Metadata = { title: "স্টক" };

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const p = await readParams(searchParams);
  return (
    <ReportPage
      slug="stock"
      params={p}
      basePath="/products/stock"
      title="স্টক"
      description="গুদামভিত্তিক মজুদ, আগমন-নির্গমন ও মজুদ মূল্য"
      crumbs={[{ label: "পণ্য", href: "/products" }, { label: "স্টক" }]}
      extraActions={
        <div className="flex items-center gap-2">
          <Link prefetch={false} href="/products/stock-transfer" className="btn-primary">
            ⇄ গুদাম মাল হস্তান্তর
          </Link>
          <Link prefetch={false} href="/vouchers/stock-journal/new" className="btn-secondary">
            স্টক জার্নাল
          </Link>
        </div>
      }
      before={<WarehousePanel editId={p.edit} />}
    />
  );
}
