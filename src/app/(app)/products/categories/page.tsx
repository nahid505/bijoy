import type { Metadata } from "next";
import { CatalogPage } from "@/server/catalog-pages";
import { readParams, type SearchParams } from "@/server/params";

export const metadata: Metadata = { title: "ক্যাটাগরি" };

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const { edit } = await readParams(searchParams);
  return <CatalogPage kind="category" editId={edit} />;
}
