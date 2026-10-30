import type { Metadata } from "next";
import { readParams, type SearchParams } from "@/server/params";
import { PartyLedgerList } from "../party-ledger-list";

export const metadata: Metadata = { title: "দেনাদার" };

export default async function DebtorsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await readParams(searchParams);
  return (
    <PartyLedgerList
      kind="CUSTOMER"
      searchParams={params}
      basePath="/accounts/debtors"
      title="দেনাদার (কাস্টমার পাওনা)"
      description="কাস্টমারদের কাছে ব্যবসার পাওনা — প্রতিটি কাস্টমারের নিজস্ব খতিয়ান থেকে"
      crumbs={[{ label: "হিসাব", href: "/accounts" }, { label: "দেনাদার" }]}
    />
  );
}

