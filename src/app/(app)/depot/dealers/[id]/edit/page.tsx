import type { Metadata } from "next";
import { PartyEditPage } from "@/server/party-pages";

export const metadata: Metadata = { title: "ডিলার সম্পাদনা" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PartyEditPage kind="DEALER" id={id} />;
}
