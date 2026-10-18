import type { Metadata } from "next";
import type { SearchParams } from "@/server/params";
import { DepotVoucherListPage } from "../depot-vouchers";

export const metadata: Metadata = { title: "কোম্পানিকে পেমেন্ট" };

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <DepotVoucherListPage kind="payments" searchParams={searchParams} />;
}
