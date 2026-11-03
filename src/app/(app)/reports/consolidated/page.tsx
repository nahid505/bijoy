import React from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireContext } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import {
  getConsolidatedFinancials,
  assertConsolidatedAccess,
} from "@/server/services/consolidatedFinancials";
import type { BookFilter } from "@/lib/book";
import { ConsolidatedReportClient } from "./consolidated-client";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "সম্মিলিত গ্রুপ রিপোর্ট ও এলিমিনেশন (Consolidated Group Financials)",
  };
}

export default async function ConsolidatedFinancialsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const ctx = await requireContext();

  try {
    assertConsolidatedAccess(ctx);
  } catch (err) {
    redirect("/forbidden");
  }

  const p = await readParams(searchParams);
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const asOfStr = p.asOf || p.date || todayStr;
  const toStr = p.to || asOfStr;

  // Default 'from' to start of current year
  const firstDayOfYear = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
  const fromStr = p.from || firstDayOfYear;
  const book = (p.book || "GENERAL") as BookFilter;

  const asOfDate = new Date(asOfStr);
  const fromDate = fromStr ? new Date(fromStr) : undefined;
  const toDate = toStr ? new Date(toStr) : undefined;

  const report = await getConsolidatedFinancials(ctx.business.id, {
    asOf: asOfDate,
    from: fromDate,
    to: toDate,
    book,
  });

  return (
    <div className="space-y-6">
      <div className="no-print">
        <PageHeader
          title="সম্মিলিত গ্রুপ ফাইন্যান্সিয়াল রিপোর্ট ও ইন্টার-কোম্পানি এলিমিনেশন"
          description={
            report.group
              ? `"${report.group.name}" এর সকল সিস্টার কনসার্নের আর্থিক অবস্থান এবং অভ্যন্তরীণ কেনাবেচা ও বাকি সমন্বয়ের অডিট রিপোর্ট`
              : "গ্রুপের আওতাধীন সকল সিস্টার কনসার্নের সমন্বিত ব্যালেন্স শীট, লাভ-ক্ষতি ও রেওয়ামিল"
          }
          crumbs={[
            { label: "ড্যাশবোর্ড", href: "/dashboard" },
            { label: "রিপোর্ট", href: "/reports" },
            { label: "সম্মিলিত গ্রুপ রিপোর্ট", href: "/reports/consolidated" },
          ]}
        />
      </div>

      <ConsolidatedReportClient
        report={report}
        currency={ctx.business.currencySymbol}
        asOfDateStr={asOfStr}
        fromDateStr={fromStr}
        toDateStr={toStr}
        book={book}
      />
    </div>
  );
}
