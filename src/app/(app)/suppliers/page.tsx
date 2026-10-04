import type { Metadata } from "next";
import { PartyListPage } from "@/server/party-pages";
import type { SearchParams } from "@/server/params";

export const metadata: Metadata = { title: "সরবরাহকারী" };

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <PartyListPage kind="SUPPLIER" searchParams={searchParams} />;
}
