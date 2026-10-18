import type { Metadata } from "next";
import { PartyEditPage } from "@/server/party-pages";

export const metadata: Metadata = { title: "নতুন ডিলার" };

export default function Page() {
  return <PartyEditPage kind="DEALER" id={null} />;
}
