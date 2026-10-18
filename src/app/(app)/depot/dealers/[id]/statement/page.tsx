import type { Metadata } from "next";
import { PartyStatementPrint } from "@/server/party-pages";
import type { SearchParams } from "@/server/params";

export const metadata: Metadata = { title: "হিসাব বিবরণী" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  return <PartyStatementPrint kind="DEALER" id={id} searchParams={searchParams} />;
}
