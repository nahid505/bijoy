import { NextResponse } from "next/server";
import { hasPermission, type Permission } from "@/lib/permissions";
import { getContext } from "@/server/auth";
import { ACCOUNT_SCOPES, searchAccounts, searchEmployees, searchParties, searchProducts, type AccountScope } from "@/server/lookup";

export const dynamic = "force-dynamic";

// Who may search what: anyone who can view the list, or who needs it to record a voucher.
const ACCESS: Record<string, Permission[]> = {
  customers: ["customers:view", "sales:view", "sales:create", "vouchers:create", "reports:view"],
  suppliers: ["suppliers:view", "purchases:view", "purchases:create", "vouchers:create", "reports:view"],
  products: ["inventory:view", "sales:create", "purchases:create", "stock:adjust", "production:manage"],
  employees: ["payroll:view", "payroll:attendance"],
  accounts: ["accounts:view", "vouchers:create", "vouchers:view", "reports:view", "sales:create", "purchases:create", "production:manage"],
};
// Who may use the picker's "create new" (the same permission the create action checks).
const CREATE: Record<string, Permission> = { customers: "customers:manage", suppliers: "suppliers:manage", products: "inventory:manage", accounts: "accounts:manage", employees: "payroll:manage" };

/**
 * GET /api/lookup/customers|suppliers|products|employees|accounts?q=…  (or ?ids=a,b for known items)
 * Searches name, code / SKU, mobile, barcode and id within the signed-in business only.
 */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const allowed = ACCESS[kind];
  if (!allowed) return NextResponse.json({ error: "not found" }, { status: 404 });
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!allowed.some((p) => hasPermission(ctx.permissions, p))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 100);
  const ids = url.searchParams.get("ids")?.split(",").filter(Boolean).slice(0, 50);
  const canCreate = hasPermission(ctx.permissions, CREATE[kind]);
  if (kind === "accounts") {
    // ?scope=all|cash|expense  &offset=N (pages of 30)
    const scope = (ACCOUNT_SCOPES as string[]).includes(url.searchParams.get("scope") ?? "") ? (url.searchParams.get("scope") as AccountScope) : "all";
    const offset = Math.min(Number(url.searchParams.get("offset")) || 0, 10_000);
    const r = await searchAccounts(ctx.business.id, q, { scope, ids, offset });
    return NextResponse.json({ ...r, canCreate }, { headers: { "cache-control": "no-store" } });
  }
  if (kind === "employees") {
    // the picker never creates employees (that needs the full form)
    const items = await searchEmployees(ctx.business.id, q, { ids, activeOnly: url.searchParams.get("active") === "1" });
    return NextResponse.json({ items, canCreate: false }, { headers: { "cache-control": "no-store" } });
  }
  const items =
    kind === "products"
      ? await searchProducts(ctx.business.id, q, { ids, batchOnly: url.searchParams.get("batchOnly") === "1" })
      : await searchParties(ctx.business.id, kind === "customers" ? "CUSTOMER" : "SUPPLIER", q, { accountIds: ids });
  return NextResponse.json({ items, canCreate }, { headers: { "cache-control": "no-store" } });
}
