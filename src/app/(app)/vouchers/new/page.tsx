import { redirect } from "next/navigation";
import { readParams, type SearchParams } from "@/server/params";

/** Shorthand redirect for /vouchers/new?type=... */
export default async function NewVoucherRedirectPage({ searchParams }: { searchParams: SearchParams }) {
  const p = await readParams(searchParams);
  const type = p.type ? String(p.type).toLowerCase() : "receipt";
  redirect(`/vouchers/${type}/new`);
}
