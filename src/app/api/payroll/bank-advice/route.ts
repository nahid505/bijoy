import { NextResponse, type NextRequest } from "next/server";
import { hasPermission } from "@/lib/permissions";
import { getContext } from "@/server/auth";
import {
  getBankSalaryAdviceData,
  generateBankAdviceXlsx,
  generateBankAdviceCsv,
  generateDbblBankAdviceXlsx,
  generateDbblBankAdviceCsv,
} from "@/server/payroll-bank-advice";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasPermission(ctx.permissions, "payroll:view")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const now = new Date();
  const year = Number(searchParams.get("year")) || now.getFullYear();
  const month = Number(searchParams.get("month")) || now.getMonth() + 1;
  const bankAccountId = searchParams.get("accountId") || undefined;
  const format = searchParams.get("format") || "xlsx";
  const template = searchParams.get("template") || "standard";

  const data = await getBankSalaryAdviceData(ctx.business.id, {
    year,
    month,
    bankAccountId,
  });

  const isDbbl = template === "dbbl" || format === "dbbl-xlsx" || format === "dbbl-csv";
  const isCsv = format === "csv" || format === "dbbl-csv";
  const filename = isDbbl
    ? `dbbl-rocket-advice-${data.periodLabelEn}`
    : `salary-advice-${data.periodLabelEn}`;

  if (isCsv) {
    const csvContent = isDbbl ? generateDbblBankAdviceCsv(data) : generateBankAdviceCsv(data);
    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const xlsxBuffer = isDbbl ? await generateDbblBankAdviceXlsx(data) : await generateBankAdviceXlsx(data);
  return new NextResponse(new Uint8Array(xlsxBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
