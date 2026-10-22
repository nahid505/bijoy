import type { Metadata } from "next";
import { ProductDetailPage } from "@/server/product-pages";

export const metadata: Metadata = { title: "ডিপো পণ্য" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ProductDetailPage id={(await params).id} kind="DEPOT" />;
}
