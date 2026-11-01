import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { buildQuery } from "@/components/ui";
import { readParams, type SearchParams } from "@/server/params";

export const metadata: Metadata = { title: "সরবরাহকারী লেজার" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const p = await readParams(searchParams);
  const q = buildQuery({ ...p, tab: "statement" });
  redirect(`/suppliers/${id}${q}`);
}
