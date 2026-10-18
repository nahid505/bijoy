import type { Metadata } from "next";
import type { SearchParams } from "@/server/params";
import { DepotVoucherNewPage } from "../../depot-vouchers";

export const metadata: Metadata = { title: "নতুন স্টক ইন" };

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <DepotVoucherNewPage kind="stock-in" searchParams={searchParams} />;
}
