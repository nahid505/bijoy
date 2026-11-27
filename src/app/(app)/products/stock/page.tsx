import type { Metadata } from "next";
import Link from "next/link";
import { ReportPage } from "@/components/report-page";
import { WarehousePanel } from "@/server/catalog-pages";
import { readParams, type SearchParams } from "@/server/params";

import { requireContext } from "@/server/auth";
import { prisma } from "@/lib/db";
import { toBnDigits } from "@/lib/format";

export const metadata: Metadata = { title: "স্টক" };

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const p = await readParams(searchParams);
  const negCount = await prisma.product.count({
    where: { businessId: ctx.business.id, stock: { lt: 0 }, isDepotProduct: false },
  });

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
          {negCount > 0 && (
            <Link
              prefetch={false}
              href={p.negative ? "/products/stock" : "/products/stock?negative=true"}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold shadow-2xs transition ${
                p.negative
                  ? "border-red-600 bg-red-600 text-white hover:bg-red-700"
                  : "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
              }`}
              title="নেগেটিভ স্টক আইটেম ফিল্টার"
            >
              <span>⚠️</span>
              <span>নেগেটিভ স্টক ({toBnDigits(negCount)})</span>
            </Link>
          )}
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
