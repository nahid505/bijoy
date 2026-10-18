import type { Metadata } from "next";
import type { SearchParams } from "@/server/params";
import { DepotVoucherListPage } from "../depot-vouchers";

export const metadata: Metadata = { title: "মার্কেট কালেকশন" };

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <DepotVoucherListPage kind="collections" searchParams={searchParams} />;
}
