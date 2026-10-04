import type { Metadata } from "next";
import { CatalogPage } from "@/server/catalog-pages";
import { readParams, type SearchParams } from "@/server/params";

export const metadata: Metadata = { title: "ব্র্যান্ড" };

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const { edit } = await readParams(searchParams);
  return <CatalogPage kind="brand" editId={edit} />;
}
