import type { Metadata } from "next";
import { DepotExpenseEntryPage } from "../../entry-page";

export const metadata: Metadata = { title: "ডিপো খরচ সম্পাদনা" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <DepotExpenseEntryPage id={(await params).id} />;
}
