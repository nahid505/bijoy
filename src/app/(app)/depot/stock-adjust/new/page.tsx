import type { Metadata } from "next";
import type { SearchParams } from "@/server/params";
import { DepotVoucherNewPage } from "../../depot-vouchers";

export const metadata: Metadata = { title: "নতুন ডিপো স্টক সমন্বয়" };

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <DepotVoucherNewPage kind="stock-adjust" searchParams={searchParams} />;
}
