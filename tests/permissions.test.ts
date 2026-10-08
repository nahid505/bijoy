import { describe, expect, it } from "vitest";
import defaults from "@/lib/business-defaults.json";
import { ALL_PERMISSIONS, hasPermission, isPermission } from "@/lib/permissions";
import { MOBILE_TABS, NAV } from "@/lib/nav";
import { voucherPermission } from "@/server/voucher-permissions";

describe("hasPermission", () => {
  it("wildcard grants everything", () => expect(hasPermission(["*"], "business:manage")).toBe(true));
  it("checks explicit keys", () => {
    expect(hasPermission(["sales:view"], "sales:view")).toBe(true);
    expect(hasPermission(["sales:view"], "sales:delete")).toBe(false);
  });
});

describe("catalogue consistency", () => {
  it("permission keys are unique", () => expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length));

  it("default roles reference only known permissions", () => {
    for (const r of defaults.roles) for (const p of r.permissions) if (p !== "*") expect(isPermission(p), `${r.name}: ${p}`).toBe(true);
  });

  it("ships the ten default roles (owner, admin, manager, accountant, sales, purchase, viewer, HR, cashier, inventory) with exactly one immutable owner", () => {
    expect(defaults.roles).toHaveLength(10);
    const owners = defaults.roles.filter((r) => "system" in r && r.system);
    expect(owners).toHaveLength(1);
    expect(owners[0].permissions).toEqual(["*"]);
  });

  it("viewer role is read-only", () => {
    const viewer = defaults.roles.find((r) => r.name.includes("Viewer"))!;
    expect(viewer.permissions.every((p) => p.endsWith(":view"))).toBe(true);
  });

  it("every navigation item is guarded by a known permission", () => {
    for (const e of NAV) {
      if (e.permission) expect(isPermission(e.permission)).toBe(true);
      for (const c of e.children ?? []) expect(isPermission(c.permission)).toBe(true);
    }
    for (const t of MOBILE_TABS) expect(isPermission(t.permission)).toBe(true);
  });

  it("voucher permissions map to real keys", () => {
    expect(voucherPermission("SALES", "edit")).toBe("sales:edit");
    expect(voucherPermission("PURCHASE_RETURN", "create")).toBe("purchases:create");
    expect(voucherPermission("RECEIPT", "delete")).toBe("vouchers:delete");
    expect(voucherPermission("STOCK_JOURNAL", "create")).toBe("stock:adjust");
    expect(voucherPermission("STOCK_JOURNAL", "view")).toBe("inventory:view");
    for (const t of ["SALES", "PURCHASE", "SALES_RETURN", "PURCHASE_RETURN", "RECEIPT", "PAYMENT", "JOURNAL", "STOCK_JOURNAL"] as const)
      for (const a of ["view", "create", "edit", "delete"] as const) expect(isPermission(voucherPermission(t, a))).toBe(true);
  });

  it("chart of accounts defines every system account the engine needs", () => {
    const keys = defaults.accounts.map((a) => a.key);
    for (const k of ["CASH", "INVENTORY", "VAT_PAYABLE", "OPENING_EQUITY", "SALES", "SALES_RETURN", "COGS", "DISCOUNT_ALLOWED", "STOCK_ADJUSTMENT"]) expect(keys).toContain(k);
    const groups = new Set(defaults.groups.map((g) => g.key));
    for (const a of defaults.accounts) expect(groups.has(a.group), a.key).toBe(true);
    for (const n of ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]) expect(defaults.groups.some((g) => g.nature === n)).toBe(true);
  });
});
