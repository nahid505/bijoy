import type { Metadata } from "next";
import { ReportPage } from "@/components/report-page";
import { readParams, type SearchParams } from "@/server/params";
import { BalanceStrip } from "../balance-strip";

export const metadata: Metadata = { title: "ক্যাশ বুক" };

export default async function CashPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <ReportPage
      slug="cash-book"
      params={await readParams(searchParams)}
      basePath="/accounts/cash"
      crumbs={[{ label: "হিসাব" }, { label: "ক্যাশ" }]}
      before={<BalanceStrip kind="CASH" />}
    />
  );
}
