import { describe, expect, it } from "vitest";
import { DEPOT_PERMISSIONS, hasPermission, isPermission, PERMISSION_GROUPS } from "@/lib/permissions";
import { DEPOT_ACCESS, DEPOT_PERMISSION_UPGRADE, DEPOT_ROLE } from "@/lib/depot";
import { NAV } from "@/lib/nav";
import { depotVoucherPermissions, voucherAccess } from "@/server/voucher-permissions";

const depotOnly = [...DEPOT_ROLE.permissions];
const ALL13 = [
  "depot:view", "depot:delivery_manage", "depot:dealers_manage", "depot:stock_in", "depot:stock_adjust", "depot:collection_create", "depot:company_payment",
  "depot:reports_view", "depot:register_view", "depot:scheme_manage", "depot:company_ledger", "depot:profit_loss", "depot:cashbook",
];
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
const depotMenu = (granted: string[]) => sidebar(granted, "DEPOT").find((e) => e.key === "depot")?.children ?? [];

describe("depot permissions (ডিপো ব্যবস্থাপনা)", () => {
  it("the depot card holds the full set of 13 keys, in order; the depot role holds all of them", () => {
    const g = PERMISSION_GROUPS.find((x) => x.label === "ডিপো ব্যবস্থাপনা")!;
    expect(g.permissions.map((p) => p.key)).toEqual(ALL13);
    expect(g.permissions.find((p) => p.key === "depot:stock_adjust")?.label).toBe("স্টক সমন্বয় (ডিপো)");
    expect(DEPOT_PERMISSIONS).toEqual(ALL13);
    expect(depotOnly.every(isPermission)).toBe(true);
    expect(depotOnly).toEqual(ALL13);
  });

  it("a list means any of; a blocked key stays blocked", () => {
    expect(hasPermission(["depot:view"], ["depot:view", "sales:view"])).toBe(true);
    expect(hasPermission(["sales:view"], DEPOT_ACCESS.view)).toBe(true); // existing roles keep working
    expect(hasPermission(["accounts:view"], DEPOT_ACCESS.view)).toBe(false);
    expect(hasPermission(["*", "!depot:view", "!sales:view", "!depot:delivery_manage"], DEPOT_ACCESS.view)).toBe(false);
    expect(hasPermission([], [])).toBe(false);
  });

  it("a depot-only role: no general accounting permission at all", () => {
    for (const p of ["dashboard:view", "accounts:view", "vouchers:view", "vouchers:create", "sales:view", "purchases:view", "reports:view", "business:manage", "roles:manage", "users:manage", "inventory:view", "stock:adjust"] as const)
      expect(hasPermission(depotOnly, p), p).toBe(false);
    for (const k of Object.keys(DEPOT_ACCESS) as (keyof typeof DEPOT_ACCESS)[]) expect(hasPermission(depotOnly, DEPOT_ACCESS[k]), k).toBe(true);
  });

  it("sidebar: each depot item needs its own key; the full role sees the whole depot menu", () => {
    const s = sidebar(depotOnly, "DEPOT");
    expect(s.map((e) => e.key)).toEqual(["dashboard", "depot", "account"]); // account = own profile / password only
    expect(s[1].children).toEqual([
      "/depot/deliveries", "/depot/deliveries/new", "/depot/dealers", "/depot/stock-in", "/depot/collections", "/depot/payments", "/depot/stock-adjust", "/depot/commission",
      "/reports/depot-market-dues", "/reports/depot-commission", "/reports/depot-deliveries", "/reports/depot-free", "/reports/depot-company-ledger", "/reports/depot-profit-loss", "/reports/depot-cash-book",
    ]);
    // stock adjustment: only with depot:stock_adjust — a stock-in or general stock key does not open it
    expect(depotMenu(["depot:stock_in"])).not.toContain("/depot/stock-adjust");
    expect(depotMenu(["stock:adjust", "inventory:view"])).not.toContain("/depot/stock-adjust");
    expect(depotMenu(["depot:stock_adjust"])).toEqual(["/depot/stock-adjust"]);
    // one key, one item
    expect(depotMenu(["depot:company_payment"])).toEqual(["/depot/payments"]);
    expect(depotMenu(["depot:dealers_manage"])).toEqual(["/depot/dealers"]);
    expect(depotMenu(["depot:register_view"])).toEqual(["/reports/depot-deliveries"]);
    expect(depotMenu(["depot:company_ledger"])).toEqual(["/reports/depot-company-ledger"]);
    expect(depotMenu(["depot:profit_loss"])).toEqual(["/reports/depot-profit-loss"]);
    expect(depotMenu(["depot:cashbook"])).toEqual(["/reports/depot-cash-book"]);
    expect(depotMenu(["depot:view", "depot:scheme_manage"])).toEqual(["/depot/deliveries", "/depot/commission", "/reports/depot-free"]);
    // the same keys outside a depot business open no menu but the dashboard link
    expect(sidebar(depotOnly, "RETAIL").map((e) => e.key)).toEqual(["dashboard", "account"]);
  });

  it("voucher access: depot keys open depot-book vouchers only, each with its own key", () => {
    expect(voucherAccess("PURCHASE", "create", "DEPOT", "DEPOT")).toEqual(["purchases:create", "depot:stock_in"]);
    // a GENERAL purchase / receipt is never opened by a depot key — not even in a depot business
    expect(voucherAccess("PURCHASE", "create", "DEPOT")).toEqual(["purchases:create"]);
    expect(voucherAccess("RECEIPT", "view", "DEPOT", "GENERAL")).toEqual(["vouchers:view"]);
    expect(voucherAccess("PURCHASE", "create", "RETAIL", "DEPOT")).toEqual(["purchases:create"]);
    expect(voucherAccess("RECEIPT", "view", "DEPOT", "DEPOT")).toEqual(["vouchers:view", "depot:collection_create"]);
    expect(voucherAccess("PAYMENT", "create", "DEPOT", "DEPOT")).toEqual(["vouchers:create", "depot:company_payment"]);
    expect(voucherAccess("STOCK_JOURNAL", "create", "DEPOT", "DEPOT")).toEqual(["stock:adjust", "depot:stock_adjust"]);
    expect(voucherAccess("DEPOT_DELIVERY", "view", "DEPOT")).toEqual(["sales:view", "depot:view", "depot:delivery_manage"]);
    expect(depotVoucherPermissions("SALES", "view")).toEqual(["depot:view", "depot:delivery_manage"]);
    expect(depotVoucherPermissions("SALES", "edit")).toEqual(["depot:delivery_manage"]);
    for (const [t, a] of [["PURCHASE", "edit"], ["RECEIPT", "delete"], ["PAYMENT", "edit"], ["STOCK_JOURNAL", "edit"]] as const) expect(depotVoucherPermissions(t, a), `${t} ${a}`).toEqual([]);
    for (const t of ["JOURNAL", "SALES_RETURN", "OPENING"] as const)
      for (const a of ["view", "create", "edit", "delete"] as const) expect(depotVoucherPermissions(t, a), `${t} ${a}`).toEqual([]);
    expect(hasPermission(["depot:stock_in"], voucherAccess("STOCK_JOURNAL", "create", "DEPOT", "DEPOT"))).toBe(false);
    expect(hasPermission(depotOnly, voucherAccess("PURCHASE", "create", "DEPOT", "GENERAL"))).toBe(false);
  });

  it("upgrade of roles made with the first set: every old key brings the screens it used to open", () => {
    const old = ["depot:view", "depot:delivery_manage", "depot:stock_in", "depot:collection_create", "depot:reports_view", "depot:scheme_manage"];
    const upgraded = [...new Set([...old, ...old.flatMap((k) => DEPOT_PERMISSION_UPGRADE[k] ?? [])])].sort();
    expect(upgraded).toEqual([...ALL13].sort());
    for (const k of Object.values(DEPOT_PERMISSION_UPGRADE).flat()) expect(isPermission(k), k).toBe(true);
  });
});
