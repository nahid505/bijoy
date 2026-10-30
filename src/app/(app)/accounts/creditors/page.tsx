import type { Metadata } from "next";
import { readParams, type SearchParams } from "@/server/params";
import { PartyLedgerList } from "../party-ledger-list";

export const metadata: Metadata = { title: "পাওনাদার" };

export default async function CreditorsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await readParams(searchParams);
  return (
    <PartyLedgerList
      kind="SUPPLIER"
      searchParams={params}
      basePath="/accounts/creditors"
      title="পাওনাদার (সরবরাহকারী দেনা)"
      description="সরবরাহকারীদের কাছে ব্যবসার দেনা — প্রতিটি সরবরাহকারীর নিজস্ব খতিয়ান থেকে"
      crumbs={[{ label: "হিসাব", href: "/accounts" }, { label: "পাওনাদার" }]}
    />
  );
}

