import type { Metadata } from "next";
import { PartyEditPage } from "@/server/party-pages";

export const metadata: Metadata = { title: "নতুন কাস্টমার" };

export default function Page() {
  return <PartyEditPage kind="CUSTOMER" id={null} />;
}
