import type { Metadata } from "next";
import type { SearchParams } from "@/server/params";
import { DepotVoucherNewPage } from "../../depot-vouchers";

export const metadata: Metadata = { title: "নতুন মার্কেট কালেকশন" };

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <DepotVoucherNewPage kind="collections" searchParams={searchParams} />;
}
