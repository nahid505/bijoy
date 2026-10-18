import type { Metadata } from "next";
import type { SearchParams } from "@/server/params";
import { DepotVoucherListPage } from "../depot-vouchers";

export const metadata: Metadata = { title: "স্টক ইন" };

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <DepotVoucherListPage kind="stock-in" searchParams={searchParams} />;
}
