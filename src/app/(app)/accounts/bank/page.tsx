import type { Metadata } from "next";
import { ReportPage } from "@/components/report-page";
import { readParams, type SearchParams } from "@/server/params";
import { BalanceStrip } from "../balance-strip";

export const metadata: Metadata = { title: "ব্যাংক বুক" };

export default async function BankPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <ReportPage
      slug="bank-book"
      params={await readParams(searchParams)}
      basePath="/accounts/bank"
      crumbs={[{ label: "হিসাব" }, { label: "ব্যাংক" }]}
      before={<BalanceStrip kind="BANK" />}
    />
  );
}
