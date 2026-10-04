import type { Metadata } from "next";
import { ProductListPage } from "@/server/product-pages";
import type { SearchParams } from "@/server/params";

export const metadata: Metadata = { title: "সকল পণ্য" };

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <ProductListPage searchParams={searchParams} />;
}
