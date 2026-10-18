import type { Metadata } from "next";
import type { SearchParams } from "@/server/params";
import { DepotVoucherNewPage } from "../../depot-vouchers";

export const metadata: Metadata = { title: "নতুন কোম্পানিকে পেমেন্ট" };

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <DepotVoucherNewPage kind="payments" searchParams={searchParams} />;
}
