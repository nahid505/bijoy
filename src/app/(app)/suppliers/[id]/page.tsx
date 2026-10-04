import type { Metadata } from "next";
import { PartyDetailPage } from "@/server/party-pages";
import type { SearchParams } from "@/server/params";

export const metadata: Metadata = { title: "সরবরাহকারী" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  return <PartyDetailPage kind="SUPPLIER" id={id} searchParams={searchParams} />;
}
