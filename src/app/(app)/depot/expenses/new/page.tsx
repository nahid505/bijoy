import type { Metadata } from "next";
import { DepotExpenseEntryPage } from "../entry-page";

export const metadata: Metadata = { title: "নতুন ডিপো খরচ" };

export default function Page() {
  return <DepotExpenseEntryPage />;
}
