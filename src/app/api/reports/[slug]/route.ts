import { NextResponse, type NextRequest } from "next/server";
import { hasPermission } from "@/lib/permissions";
import { featureForPath } from "@/lib/features";
import { toDateInput } from "@/lib/format";
import { getContext } from "@/server/auth";
import { findReport } from "@/server/reports/registry";
import { toCsv, toXlsx } from "@/server/reports/export";

export const dynamic = "force-dynamic";

/** Export any registered report — same data as the screen. ?format=xlsx (Excel) or csv (default). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const def = findReport(slug);
  if (!def) return NextResponse.json({ error: "not found" }, { status: 404 });
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasPermission(ctx.permissions, def.permission)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const gate = featureForPath(`/reports/${slug}`);
  if (gate && !ctx.features.includes(gate)) return NextResponse.json({ error: "feature disabled", feature: gate }, { status: 403 });

  const query = Object.fromEntries(req.nextUrl.searchParams.entries());
  const report = await def.run(ctx, query);
  const name = `${slug}-${toDateInput()}`;
  if (query.format === "xlsx") {
    return new NextResponse(new Uint8Array(await toXlsx(report, ctx.business.name)), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return new NextResponse(toCsv(report), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" },
  });
}
