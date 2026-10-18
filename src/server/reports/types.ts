import type { Permission } from "@/lib/permissions";
import type { AppContext } from "../auth";

export type CellFormat = "text" | "money" | "qty" | "date" | "drcr";
export type Cell = string | number | Date | null;

export interface ReportColumn {
  key: string;
  label: string;
  format?: CellFormat;
}

export interface ReportRow {
  cells: Record<string, Cell>;
  kind?: "normal" | "group" | "subtotal" | "total" | "detail";
  href?: string; // link for the first text cell
  indent?: number;
}

export interface ReportResult {
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  summary?: { label: string; value: string; tone?: "green" | "red" | "blue" | "slate" }[];
  notes?: string[];
  emptyMessage?: string;
}

export type FilterKey = "range" | "asOf" | "q" | "account" | "cashAccount" | "bankAccount" | "warehouse" | "voucherType" | "customer" | "supplier" | "dueStatus" | "period" | "department" | "employee";

export type ReportParams = Record<string, string | undefined>;

export interface ReportDef {
  slug: string;
  title: string;
  description: string;
  filters: FilterKey[];
  /** a list means "any of these" (depot reports: the depot permission or reports:view) */
  permission: Permission | readonly Permission[];
  run(ctx: AppContext, params: ReportParams): Promise<ReportResult>;
}
