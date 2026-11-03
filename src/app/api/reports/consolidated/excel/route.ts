import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/server/auth";
import {
  getConsolidatedFinancials,
  exportConsolidatedFinancialsToXlsx,
  assertConsolidatedAccess,
} from "@/server/services/consolidatedFinancials";
import type { BookFilter } from "@/lib/book";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    assertConsolidatedAccess(ctx);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "forbidden" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const asOfParam = searchParams.get("asOf");
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const bookParam = (searchParams.get("book") || "GENERAL") as BookFilter;

  const asOf = asOfParam ? new Date(asOfParam) : new Date();
  const from = fromParam ? new Date(fromParam) : undefined;
  const to = toParam ? new Date(toParam) : undefined;

  try {
    const report = await getConsolidatedFinancials(ctx.business.id, {
      asOf,
      from,
      to,
      book: bookParam,
    });

    const xlsxBuffer = await exportConsolidatedFinancialsToXlsx(report, ctx.business.currencySymbol);
    const dateStr = asOf.toISOString().slice(0, 10);
    const filename = `consolidated-financials-${dateStr}.xlsx`;

    return new NextResponse(new Uint8Array(xlsxBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("Error generating consolidated excel:", err);
    return NextResponse.json({ error: err?.message || "Failed to generate report" }, { status: 500 });
  }
}
