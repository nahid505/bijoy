import type { Metadata } from "next";
import { PartyListPage } from "@/server/party-pages";
import type { SearchParams } from "@/server/params";

export const metadata: Metadata = { title: "ডিলার" };

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <PartyListPage kind="DEALER" searchParams={searchParams} />;
}
