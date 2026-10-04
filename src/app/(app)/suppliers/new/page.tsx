import type { Metadata } from "next";
import { PartyEditPage } from "@/server/party-pages";

export const metadata: Metadata = { title: "নতুন সরবরাহকারী" };

export default function Page() {
  return <PartyEditPage kind="SUPPLIER" id={null} />;
}
