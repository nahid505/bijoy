import type { Metadata } from "next";
import { ProductEditPage } from "@/server/product-pages";

export const metadata: Metadata = { title: "পণ্য সম্পাদনা" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductEditPage id={id} />;
}
