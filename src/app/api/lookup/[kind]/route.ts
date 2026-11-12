import { NextResponse } from "next/server";
import { hasPermission, type Permission } from "@/lib/permissions";
import { DEPOT_ACCESS } from "@/lib/depot";
import { getContext } from "@/server/auth";
import { accountScopeWhere } from "@/server/party-scope";
import { ACCOUNT_SCOPES, searchAccounts, searchEmployees, searchParties, searchProducts, type AccountScope } from "@/server/lookup";
import { withTenantContext } from "@/lib/tenant-isolation";

export const dynamic = "force-dynamic";

// Who may search what: anyone who can view the list, or who needs it to record a voucher (depot keys: the
// depot forms' dealer / company / product / cash pickers; they are granted only in a depot business).
const ACCESS: Record<string, Permission[]> = {
  customers: ["customers:view", "sales:view", "sales:create", "vouchers:create", "reports:view", "users:manage", "depot:delivery_manage", "depot:collection_create", "depot:reports_view", "auto_rice_mill.sales:create", "auto_rice_mill.sales:view"],
  suppliers: ["suppliers:view", "purchases:view", "purchases:create", "vouchers:create", "reports:view", "users:manage", "depot:delivery_manage", "depot:stock_in", "depot:collection_create", "depot:reports_view", "auto_rice_mill.procurement:create", "auto_rice_mill.procurement:view", "auto_rice_mill:bag_return:create", "auto_rice_mill:bag_return:view"],
  parties: [
    "customers:view",
    "suppliers:view",
    "sales:view",
    "purchases:view",
    "sales:create",
    "purchases:create",
    "vouchers:create",
    "vouchers:view",
    "reports:view",
    "users:manage",
    "depot:delivery_manage",
    "depot:stock_in",
    "depot:collection_create",
    "depot:reports_view",
    "auto_rice_mill.sales:create",
    "auto_rice_mill.sales:view",
    "auto_rice_mill.procurement:create",
    "auto_rice_mill.procurement:view",
    "auto_rice_mill:bag_return:create",
    "auto_rice_mill:bag_return:view",
  ],
  products: ["inventory:view", "sales:create", "purchases:create", "stock:adjust", "production:manage", "depot:delivery_manage", "depot:stock_in", "depot:scheme_manage", "depot:stock_adjust", "depot:products_manage", "auto_rice_mill.sales:create", "auto_rice_mill.milling:create", "auto_rice_mill.procurement:create"],
  employees: ["payroll:view", "payroll:attendance"],
  accounts: ["accounts:view", "expense:view", "expense:create", "users:manage", "vouchers:create", "vouchers:view", "reports:view", "sales:create", "purchases:create", "production:manage", "depot:delivery_manage", "depot:stock_in", "depot:collection_create", "depot:expense_manage", "auto_rice_mill.sales:create", "auto_rice_mill.milling:create", "auto_rice_mill.procurement:create", "reports.ledger:view"],
};
// Who may use the picker's "create new" (the same permission the create action checks).
const CREATE: Record<string, Permission> = { customers: "customers:manage", suppliers: "suppliers:manage", parties: "customers:manage", products: "inventory:manage", accounts: "accounts:manage", employees: "payroll:manage" };

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

  return withTenantContext(ctx.business.id, async () => {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").slice(0, 100);
    const ids = url.searchParams.get("ids")?.split(",").filter(Boolean).slice(0, 50);
    const includeAll = url.searchParams.get("includeAll") === "1" || url.searchParams.get("includeAll") === "true";
    const pk = url.searchParams.get("partyKind");
    const preferredKind = pk === "CUSTOMER" || pk === "SUPPLIER" ? pk : undefined;
    // ?book=depot: the depot forms — dealers (not general customers), depot ledgers and depot-book balances
    const depot = url.searchParams.get("book") === "depot";
    // a depot picker creates depot products (depot:products_manage or inventory:manage)
    const canCreate =
      kind === "products" && depot
        ? hasPermission(ctx.permissions, DEPOT_ACCESS.products)
        : kind === "parties"
          ? preferredKind === "SUPPLIER"
            ? hasPermission(ctx.permissions, "suppliers:manage")
            : preferredKind === "CUSTOMER"
              ? hasPermission(ctx.permissions, depot ? DEPOT_ACCESS.dealerQuickCreate : "customers:manage")
              : hasPermission(ctx.permissions, ["customers:manage", "suppliers:manage"])
          : hasPermission(ctx.permissions, CREATE[kind]);
    if (kind === "accounts") {
      // ?scope=all|cash|expense  &offset=N (pages of 30)
      const scope = (ACCOUNT_SCOPES as string[]).includes(url.searchParams.get("scope") ?? "") ? (url.searchParams.get("scope") as AccountScope) : "all";
      const offset = Math.min(Number(url.searchParams.get("offset")) || 0, 10_000);
      const r = await searchAccounts(ctx.business.id, q, { scope, ids, offset, where: accountScopeWhere(ctx), book: depot ? "DEPOT" : "GENERAL" });
      return NextResponse.json({ ...r, canCreate }, { headers: { "cache-control": "no-store" } });
    }
    if (kind === "employees") {
      // the picker never creates employees (that needs the full form)
      const items = await searchEmployees(ctx.business.id, q, { ids, activeOnly: url.searchParams.get("active") === "1" });
      return NextResponse.json({ items, canCreate: false }, { headers: { "cache-control": "no-store" } });
    }
    const items =
      kind === "products"
        ? await searchProducts(ctx.business.id, q, { ids, batchOnly: url.searchParams.get("batchOnly") === "1", book: depot ? "DEPOT" : "GENERAL" })
        : kind === "parties" || includeAll
          ? await searchParties(ctx.business.id, "ALL", q, {
              accountIds: ids,
              customerAllowed: ctx.partyScope.customers,
              supplierAllowed: ctx.partyScope.suppliers,
              ownerScopeWhere: accountScopeWhere(ctx),
              dealer: depot,
              book: depot ? "DEPOT" : "GENERAL",
              includeAll: true,
              preferredKind,
            })
          : await searchParties(ctx.business.id, kind === "customers" ? "CUSTOMER" : "SUPPLIER", q, {
              accountIds: ids,
              allowed: kind === "customers" ? ctx.partyScope.customers : ctx.partyScope.suppliers,
              dealer: kind === "customers" && depot,
              book: depot ? "DEPOT" : "GENERAL",
            });
    return NextResponse.json({ items, canCreate }, { headers: { "cache-control": "no-store" } });
  });
}
