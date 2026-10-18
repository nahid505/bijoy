import { describe, expect, it } from "vitest";
import { DEPOT_PERMISSIONS, hasPermission, isPermission, PERMISSION_GROUPS } from "@/lib/permissions";
import { DEPOT_ACCESS, DEPOT_ROLE } from "@/lib/depot";
import { NAV } from "@/lib/nav";
import { depotVoucherPermissions, voucherAccess } from "@/server/voucher-permissions";

const depotOnly = [...DEPOT_ROLE.permissions];
// what the app layout does for the sidebar
const sidebar = (granted: string[], businessType: string) =>
  NAV.flatMap((e) => {
    if (e.businessTypes && !e.businessTypes.includes(businessType)) return [];
    if (e.children) {
      const c = e.children.filter((x) => hasPermission(granted, x.permission));
      return c.length ? [{ key: e.key, children: c.map((x) => x.href) }] : [];
    }
    return !e.permission || hasPermission(granted, e.permission) ? [{ key: e.key, children: [] as string[] }] : [];
  });

describe("depot permissions (ডিপো ব্যবস্থাপনা)", () => {
  it("a depot group with the six keys", () => {
    const g = PERMISSION_GROUPS.find((x) => x.label === "ডিপো ব্যবস্থাপনা")!;
    expect(g.permissions.map((p) => p.key)).toEqual(["depot:view", "depot:delivery_manage", "depot:stock_in", "depot:collection_create", "depot:reports_view", "depot:scheme_manage"]);
    expect(DEPOT_PERMISSIONS).toEqual(g.permissions.map((p) => p.key));
    expect(depotOnly.every(isPermission)).toBe(true);
    expect(depotOnly).toEqual(DEPOT_PERMISSIONS);
  });

  it("a list means any of; a blocked key stays blocked", () => {
    expect(hasPermission(["depot:view"], ["depot:view", "sales:view"])).toBe(true);
    expect(hasPermission(["sales:view"], DEPOT_ACCESS.view)).toBe(true); // existing roles keep working
    expect(hasPermission(["accounts:view"], DEPOT_ACCESS.view)).toBe(false);
    expect(hasPermission(["*", "!depot:view", "!sales:view", "!depot:delivery_manage"], DEPOT_ACCESS.view)).toBe(false);
    expect(hasPermission([], [])).toBe(false);
  });

  it("a depot-only role: no general accounting permission at all", () => {
    for (const p of ["dashboard:view", "accounts:view", "vouchers:view", "vouchers:create", "sales:view", "purchases:view", "reports:view", "business:manage", "roles:manage", "users:manage", "inventory:view"] as const)
      expect(hasPermission(depotOnly, p), p).toBe(false);
    for (const k of Object.keys(DEPOT_ACCESS) as (keyof typeof DEPOT_ACCESS)[]) expect(hasPermission(depotOnly, DEPOT_ACCESS[k]), k).toBe(true);
  });

  it("sidebar of a depot-only role: dashboard, the depot menu and the own-profile page — nothing else", () => {
    const s = sidebar(depotOnly, "DEPOT");
    expect(s.map((e) => e.key)).toEqual(["dashboard", "depot", "account"]); // account = own profile / password only
    expect(s[1].children).toEqual([
      "/depot/deliveries", "/depot/deliveries/new", "/depot/dealers", "/depot/stock-in", "/depot/collections", "/depot/payments", "/depot/commission",
      "/reports/depot-market-dues", "/reports/depot-commission", "/reports/depot-deliveries", "/reports/depot-free", "/reports/depot-profit-loss", "/reports/depot-cash-book",
    ]);
    // only some depot keys → only those items
    expect(sidebar(["depot:view", "depot:scheme_manage"], "DEPOT")[1].children).toEqual(["/depot/deliveries", "/depot/dealers", "/depot/commission", "/reports/depot-deliveries", "/reports/depot-free"]);
    // the same keys outside a depot business open no menu but the dashboard link
    expect(sidebar(depotOnly, "RETAIL").map((e) => e.key)).toEqual(["dashboard", "account"]);
  });

  it("voucher access: depot keys open depot-book vouchers only (stock in, collection, company payment, challans)", () => {
    expect(voucherAccess("PURCHASE", "create", "DEPOT", "DEPOT")).toEqual(["purchases:create", "depot:stock_in"]);
    // a GENERAL purchase / receipt is never opened by a depot key — not even in a depot business
    expect(voucherAccess("PURCHASE", "create", "DEPOT")).toEqual(["purchases:create"]);
    expect(voucherAccess("RECEIPT", "view", "DEPOT", "GENERAL")).toEqual(["vouchers:view"]);
    expect(voucherAccess("PURCHASE", "create", "RETAIL", "DEPOT")).toEqual(["purchases:create"]);
    expect(voucherAccess("RECEIPT", "view", "DEPOT", "DEPOT")).toEqual(["vouchers:view", "depot:collection_create"]);
    expect(voucherAccess("PAYMENT", "create", "DEPOT", "DEPOT")).toEqual(["vouchers:create", "depot:stock_in"]);
    expect(voucherAccess("DEPOT_DELIVERY", "view", "DEPOT")).toEqual(["sales:view", "depot:view", "depot:delivery_manage"]);
    // a depot-book sale is a market-sale challan
    expect(depotVoucherPermissions("SALES", "view")).toEqual(["depot:view", "depot:delivery_manage"]);
    expect(depotVoucherPermissions("SALES", "edit")).toEqual(["depot:delivery_manage"]);
    // never: edit / delete of stock in, collections and payments; journals, sales returns, stock journals, openings
    expect(depotVoucherPermissions("PURCHASE", "edit")).toEqual([]);
    expect(depotVoucherPermissions("RECEIPT", "delete")).toEqual([]);
    expect(depotVoucherPermissions("PAYMENT", "edit")).toEqual([]);
    for (const t of ["JOURNAL", "SALES_RETURN", "STOCK_JOURNAL", "OPENING"] as const)
      for (const a of ["view", "create", "edit", "delete"] as const) expect(depotVoucherPermissions(t, a), `${t} ${a}`).toEqual([]);
    expect(hasPermission(depotOnly, voucherAccess("JOURNAL", "view", "DEPOT", "DEPOT"))).toBe(false);
    expect(hasPermission(depotOnly, voucherAccess("PURCHASE", "create", "DEPOT", "DEPOT"))).toBe(true);
    expect(hasPermission(depotOnly, voucherAccess("PURCHASE", "create", "DEPOT", "GENERAL"))).toBe(false);
    expect(hasPermission(depotOnly, voucherAccess("PURCHASE", "create", "RETAIL", "DEPOT"))).toBe(false);
  });
});
