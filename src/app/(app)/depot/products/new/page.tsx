import type { Metadata } from "next";
import { ProductEditPage } from "@/server/product-pages";

export const metadata: Metadata = { title: "নতুন ডিপো পণ্য" };

export default function Page() {
  return <ProductEditPage id={null} kind="DEPOT" />;
}
