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
      crumbs={[{ label: "হিসাব", href: "/accounts" }, { label: "দেনাদার" }]}
    />
  );
}

