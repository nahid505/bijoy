import type { Metadata } from "next";
import { PartyListPage } from "@/server/party-pages";
import type { SearchParams } from "@/server/params";

export const metadata: Metadata = { title: "কাস্টমার" };

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <PartyListPage kind="CUSTOMER" searchParams={searchParams} />;
}
