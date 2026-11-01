import { redirect } from "next/navigation";
import { readParams, type SearchParams } from "@/server/params";

export default async function VouchersUnverifiedRedirect({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const p = await readParams(searchParams);
  const qStr = new URLSearchParams(p as Record<string, string>).toString();
  redirect(`/audit/unverified${qStr ? `?${qStr}` : ""}`);
}
