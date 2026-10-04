import { toDateInput } from "@/lib/format";
import type { Cell, CellFormat, ReportResult } from "./types";

// Export adapters: every report can be exported as CSV or a real Excel workbook (XLSX).
// PDF is produced by the browser from the A4 print layout (keeps Bangla shaping correct).

function plain(value: Cell, format?: CellFormat): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return toDateInput(value);
  if (typeof value === "number") {
    if (format === "drcr") return `${Math.abs(value).toFixed(2)} ${value >= 0 ? "Dr" : "Cr"}`;
    if (format === "qty") return String(value);
    return value.toFixed(2);
  }
  return value;
}

function csvCell(s: string): string {
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s; // formula-injection guard
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(report: ReportResult): string {
  const lines: string[] = [csvCell(report.title)];
  if (report.subtitle) lines.push(csvCell(report.subtitle));
  lines.push("");
  lines.push(report.columns.map((c) => csvCell(c.label)).join(","));
  for (const r of report.rows) {
    lines.push(report.columns.map((c, i) => csvCell((i === 0 && r.indent ? "  ".repeat(r.indent) : "") + plain(r.cells[c.key], c.format))).join(","));
  }
  return `﻿${lines.join("\r\n")}`;
}

/** Excel workbook: real numeric/date cells with number formats, bold group/total rows, frozen header. */
export async function toXlsx(report: ReportResult, businessName: string): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Bijoy Lenden";
  const ws = wb.addWorksheet(report.title.replace(/[\\/*?:[\]]/g, " ").slice(0, 31) || "Report");
  ws.addRow([businessName]).font = { bold: true, size: 14 };
  ws.addRow([report.title]).font = { bold: true, size: 12 };
  if (report.subtitle) ws.addRow([report.subtitle]);
  ws.addRow([]);
  const header = ws.addRow(report.columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3E9F1" } };
    cell.border = { bottom: { style: "thin" } };
  });
  ws.views = [{ state: "frozen", ySplit: header.number }];
  for (const r of report.rows) {
    const row = ws.addRow(
      report.columns.map((c, i) => {
        const v = r.cells[c.key];
        if (v === null || v === undefined) return null;
        if (v instanceof Date || typeof v === "number") return v;
        return (i === 0 && r.indent ? "  ".repeat(r.indent) : "") + v;
      }),
    );
    if (r.kind === "group" || r.kind === "subtotal" || r.kind === "total") row.font = { bold: true };
    if (r.kind === "total") row.eachCell((cell) => (cell.border = { top: { style: "double" } }));
  }
  report.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.format && c.format !== "text" ? 16 : Math.max(14, c.label.length + 4);
    if (c.format === "money" || c.format === "drcr") col.numFmt = "#,##0.00;[Red]-#,##0.00";
    if (c.format === "qty") col.numFmt = "#,##0.###";
    if (c.format === "date") col.numFmt = "dd-mm-yyyy";
  });
  ws.getColumn(1).width = 34;
  if (report.columns.some((c) => c.format === "drcr")) ws.addRow(["Balance column: positive = Debit, negative = Credit"]).font = { italic: true, size: 9 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
