import "server-only";
import type { Permission } from "@/lib/permissions";
import { requirePermission, type AppContext } from "./auth";
import { ensurePayrollSetup } from "./services/payroll";

/**
 * Payroll pages: permission check, then make sure the business has payroll ledgers, settings and
 * components (existing businesses are upgraded on first use) — before the page queries them.
 */
export async function requirePayroll(permission: Permission): Promise<AppContext> {
  const ctx = await requirePermission(permission);
  await ensurePayrollSetup(ctx.business.id);
  return ctx;
}
