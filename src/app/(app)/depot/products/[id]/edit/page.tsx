import type { Metadata } from "next";
import { ProductEditPage } from "@/server/product-pages";

export const metadata: Metadata = { title: "ডিপো পণ্য সম্পাদনা" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ProductEditPage id={(await params).id} kind="DEPOT" />;
}
