import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, DEPOT_PERMISSIONS, hasPermission, isPermission, PERMISSION_GROUPS, REPORT_ACCESS, RICE_MILL_PERMISSIONS } from "@/lib/permissions";
import { RICE_MILL_ACCESS, riceMillBlocked } from "@/lib/rice-mill";
import { DEPOT_ACCESS } from "@/lib/depot";
import { ownerFeature } from "@/lib/features";
import { voucherAccess } from "@/server/voucher-permissions";

const MILL = [
  "auto_rice_mill.procurement:view", "auto_rice_mill.procurement:create", "auto_rice_mill.milling:view", "auto_rice_mill.milling:create",
  "auto_rice_mill.inventory:view", "auto_rice_mill.sales:view", "auto_rice_mill.sales:create",
];

describe("permission catalogue: rice mill, single reports, depot", () => {
  it("'অটো রাইস মিল ব্যবস্থাপনা' group with the seven rice-mill keys, labelled", () => {
    const g = PERMISSION_GROUPS.find((x) => x.label === "অটো রাইস মিল ব্যবস্থাপনা");
    expect(g && "module" in g && g.module).toBe("RICE_MILL");
    expect(g!.permissions.map((p) => p.key)).toEqual(MILL);
    expect(RICE_MILL_PERMISSIONS).toEqual(MILL);
    for (const p of g!.permissions) expect(p.label.length).toBeGreaterThan(3);
  });

  it("report keys in 'ড্যাশবোর্ড ও রিপোর্ট'", () => {
    const g = PERMISSION_GROUPS.find((x) => x.label === "ড্যাশবোর্ড ও রিপোর্ট")!;
    expect(g.permissions.map((p) => p.key)).toEqual(expect.arrayContaining(["reports.daily_milling:view", "reports.daily_stock:view", "reports.ledger:view", "reports.ledger:print"]));
  });

  it("every key is unique and known; every access list uses known keys", () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    for (const list of [...Object.values(RICE_MILL_ACCESS), ...Object.values(REPORT_ACCESS), ...Object.values(DEPOT_ACCESS)]) for (const k of list) expect(isPermission(k), k).toBe(true);
  });

  it("the depot items map onto the existing depot keys (challan, dealer with business / owner, collection, expense)", () => {
    for (const k of ["depot:view", "depot:delivery_manage", "depot:dealers_manage", "depot:collection_create", "depot:expense_manage"]) expect(DEPOT_PERMISSIONS).toContain(k);
    const dealer = (PERMISSION_GROUPS as readonly { permissions: readonly { key: string; label: string }[] }[]).flatMap((g) => g.permissions).find((p) => p.key === "depot:dealers_manage")!;
    expect(dealer.label).toContain("প্রতিষ্ঠান/মালিক");
  });
});

describe("access: each new key opens its screens beside the old general key", () => {
  it("a mill-only role opens the rice-mill screens; an old general role still does", () => {
    const mill = ["auto_rice_mill.procurement:create", "auto_rice_mill.milling:view", "auto_rice_mill.sales:view"];
    expect(hasPermission(mill, RICE_MILL_ACCESS.paddyView)).toBe(true); // create implies the list
    expect(hasPermission(mill, RICE_MILL_ACCESS.paddyCreate)).toBe(true);
    expect(hasPermission(mill, RICE_MILL_ACCESS.millingView)).toBe(true);
    expect(hasPermission(mill, RICE_MILL_ACCESS.milling)).toBe(false); // view only
    expect(hasPermission(mill, RICE_MILL_ACCESS.salesCreate)).toBe(false);
    expect(hasPermission(mill, RICE_MILL_ACCESS.stock)).toBe(false);
    const old = ["purchases:view", "purchases:create", "purchases:edit", "production:view", "production:manage", "inventory:view", "sales:view", "sales:create"];
    for (const list of Object.values(RICE_MILL_ACCESS)) expect(hasPermission(old, list)).toBe(true);
  });

  it("report keys: a single report without reports:view; reports:view / accounts:view keep opening them", () => {
    expect(hasPermission(["reports.daily_stock:view"], REPORT_ACCESS.dailyStock)).toBe(true);
    expect(hasPermission(["reports.daily_stock:view"], REPORT_ACCESS.dailyMilling)).toBe(false);
    expect(hasPermission(["reports.ledger:view"], REPORT_ACCESS.ledgerView)).toBe(true);
    expect(hasPermission(["reports.ledger:view"], REPORT_ACCESS.ledgerPrint)).toBe(false);
    expect(hasPermission(["reports.ledger:view", "reports.ledger:print"], REPORT_ACCESS.ledgerExport)).toBe(true);
    expect(hasPermission(["reports:view"], REPORT_ACCESS.dailyMilling)).toBe(true);
    expect(hasPermission(["accounts:view"], REPORT_ACCESS.ledgerPrint)).toBe(true);
  });

  it("vouchers: a milling batch, a rice sale (view / create, not edit / delete), a paddy purchase (view) — never the depot book", () => {
    const has = (keys: string[], ...a: Parameters<typeof voucherAccess>) => hasPermission(keys, voucherAccess(...a));
    expect(has(["auto_rice_mill.milling:create"], "PRODUCTION", "edit", "AUTO_RICE_MILL")).toBe(true);
    expect(has(["auto_rice_mill.sales:create"], "SALES", "create", "AUTO_RICE_MILL")).toBe(true);
    expect(has(["auto_rice_mill.sales:create"], "SALES", "edit", "AUTO_RICE_MILL")).toBe(false);
    expect(has(["auto_rice_mill.sales:view"], "SALES", "delete", "AUTO_RICE_MILL")).toBe(false);
    expect(has(["auto_rice_mill.procurement:view"], "PURCHASE", "view", "AUTO_RICE_MILL")).toBe(true);
    expect(has(["auto_rice_mill.procurement:create"], "PURCHASE", "create", "AUTO_RICE_MILL")).toBe(false);
    expect(has(["auto_rice_mill.sales:create"], "SALES", "create", "DEPOT", "DEPOT")).toBe(false);
  });

  it("outside a rice-mill business the rice-mill keys are blocked ('!key' beats a grant and '*')", () => {
    expect(riceMillBlocked(["AUTO_RICE_MILL"])).toEqual([]);
    expect(riceMillBlocked(["DEPOT", "AUTO_RICE_MILL"])).toEqual([]);
    expect(riceMillBlocked([])).toEqual(MILL);
    expect(riceMillBlocked(["DEPOT"])).toEqual(MILL);
    const granted = ["*", "auto_rice_mill.sales:create", ...riceMillBlocked(["GENERAL"]).map((k) => `!${k}`)];
    expect(hasPermission(granted, "auto_rice_mill.sales:create")).toBe(false);
    expect(hasPermission(granted, "sales:create")).toBe(true);
  });

  it("feature switches: the new keys belong to the module whose screens they open", () => {
    expect(ownerFeature("auto_rice_mill.milling:create")).toBe(ownerFeature("production:manage"));
    expect(ownerFeature("auto_rice_mill.procurement:view")).toBe(ownerFeature("purchases:view"));
    expect(ownerFeature("auto_rice_mill.sales:create")).toBe(ownerFeature("sales:create"));
    expect(ownerFeature("auto_rice_mill.inventory:view")).toBe(ownerFeature("inventory:view"));
    expect(ownerFeature("reports.ledger:view")).toBe(ownerFeature("accounts:view"));
  });
});
