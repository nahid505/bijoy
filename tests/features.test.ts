// Feature registry and permission blocking (pure).
import { describe, expect, it } from "vitest";
import { blockedPermissions, FEATURE_ACTIONS, FEATURES, featureForPath, isFeatureKey, ownerFeature, type FeatureDef } from "@/lib/features";
import { ALL_PERMISSIONS, hasPermission, isPermission } from "@/lib/permissions";

const defs = FEATURES as readonly FeatureDef[];

describe("feature registry", () => {
  it("has the 20 requested modules (7 core + 13 optional) with unique keys and complete card data", () => {
    expect(defs.map((f) => f.key)).toEqual([
      "ACCOUNTING", "SALES", "PURCHASE", "INVENTORY", "POS", "CUSTOMER", "SUPPLIER",
      "MULTI_USER", "ADVANCED_REPORTING", "ADVANCED_INVENTORY", "ADVANCED_CUSTOMER", "HRM", "DAMAGE_STOCK", "PRODUCT_EXPIRY",
      "PRODUCTION", "MEMO_ENTRY", "SERVICE_ORDER", "SALES_PARTNER", "POINT_MANAGEMENT", "MULTI_WAREHOUSE",
    ]);
    for (const f of defs) {
      expect(f.nameBn && f.nameEn && f.descriptionBn && f.descriptionEn && f.icon).toBeTruthy();
      expect(["FREE", "PAID"]).toContain(f.tier);
      for (const a of Object.keys(f.permissions)) expect(FEATURE_ACTIONS).toContain(a);
    }
  });

  it("owned permissions are real permission keys, listed among the module permissions, owned by one module only", () => {
    const seen = new Set<string>();
    for (const f of defs) {
      const listed = new Set(Object.values(f.permissions).flat());
      for (const p of f.owns) {
        expect(isPermission(p)).toBe(true);
        expect(listed.has(p)).toBe(true);
        expect(seen.has(p)).toBe(false);
        seen.add(p);
      }
    }
  });

  it("modules that do not exist yet are coming soon, off by default and own nothing", () => {
    for (const f of defs.filter((x) => x.status === "COMING_SOON")) {
      expect(f.defaultEnabled).toBe(false);
      expect(f.owns).toEqual([]);
    }
    expect(defs.filter((f) => f.status === "AVAILABLE").every((f) => f.defaultEnabled)).toBe(true); // existing businesses keep working as before
  });

  it("maps pages and reports to their feature; core pages belong to none", () => {
    expect(featureForPath("/payroll")).toBe("HRM");
    expect(featureForPath("/payroll/employees/abc?x=1")).toBe("HRM");
    expect(featureForPath("/products/batches")).toBe("PRODUCT_EXPIRY");
    expect(featureForPath("/reports/expiry-value")).toBe("PRODUCT_EXPIRY");
    expect(featureForPath("/api/reports/cash-flow")).toBe("ADVANCED_REPORTING");
    expect(featureForPath("/reports/payroll-monthly")).toBe("HRM");
    expect(featureForPath("/users/new")).toBe("MULTI_USER");
    expect(featureForPath("/vouchers/stock-journal/new")).toBe("ADVANCED_INVENTORY");
    expect(featureForPath("/dues/customers")).toBe("ADVANCED_CUSTOMER");
    // core business modules are managed features too
    expect(featureForPath("/vouchers/sales/new")).toBe("SALES");
    expect(featureForPath("/vouchers/sales-return")).toBe("SALES");
    expect(featureForPath("/vouchers/purchase/new")).toBe("PURCHASE");
    expect(featureForPath("/vouchers/receipt/new")).toBe("ACCOUNTING");
    expect(featureForPath("/accounts/cash")).toBe("ACCOUNTING");
    expect(featureForPath("/pos")).toBe("POS");
    expect(featureForPath("/customers/abc")).toBe("CUSTOMER");
    expect(featureForPath("/dues/suppliers")).toBe("SUPPLIER");
    // the most specific route wins
    expect(featureForPath("/products")).toBe("INVENTORY");
    expect(featureForPath("/products/stock")).toBe("INVENTORY");
    expect(featureForPath("/products/batches/x")).toBe("PRODUCT_EXPIRY");
    expect(featureForPath("/products/categories")).toBe("ADVANCED_INVENTORY");
    expect(featureForPath("/production/new")).toBe("PRODUCTION");
    expect(featureForPath("/production/recipes/abc")).toBe("PRODUCTION");
    expect(ownerFeature("production:manage")).toBe("PRODUCTION");
    expect(blockedPermissions(["PRODUCTION"])).toEqual(["production:view", "production:manage", "auto_rice_mill.milling:view", "auto_rice_mill.milling:create"]); // the milling keys open the same screens
    expect(featureForPath("/productsx")).toBeNull();
    for (const core of ["/dashboard", "/reports/trial-balance", "/reports/ledger", "/account", "/billing", "/payrolls", null]) {
      expect(featureForPath(core)).toBeNull();
    }
  });

  it("blocked permissions of switched-off features; owner feature lookup", () => {
    expect(blockedPermissions(["HRM"])).toEqual(["payroll:view", "payroll:manage", "payroll:attendance", "payroll:process", "payroll:pay"]);
    expect(blockedPermissions(["ADVANCED_REPORTING", "PRODUCT_EXPIRY"])).toEqual([]);
    expect(ownerFeature("stock:adjust")).toBe("ADVANCED_INVENTORY");
    expect(ownerFeature("sales:view")).toBe("SALES");
    expect(ownerFeature("dashboard:view")).toBeNull();
    expect(ownerFeature("billing:manage")).toBeNull(); // billing can never be switched off
    expect(isFeatureKey("HRM")).toBe(true);
    expect(isFeatureKey("NOPE")).toBe(false);
  });
});

describe("permission blocking", () => {
  it("a !key entry refuses the permission even for the owner wildcard", () => {
    expect(hasPermission(["*"], "payroll:view")).toBe(true);
    expect(hasPermission(["*", "!payroll:view"], "payroll:view")).toBe(false);
    expect(hasPermission(["*", "!payroll:view"], "payroll:manage")).toBe(true);
    expect(hasPermission(["payroll:view", "!payroll:view"], "payroll:view")).toBe(false);
    expect(isPermission("!payroll:view")).toBe(false); // can never be stored on a role
  });
  it("feature management permissions exist", () => {
    expect(ALL_PERMISSIONS.some((p) => p.startsWith("features:"))).toBe(false); // modules follow the plan; no company switch
  });
});
