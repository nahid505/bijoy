import { describe, expect, it } from "vitest";
import defaults from "@/lib/business-defaults.json";
import {
  ALL_PERMISSIONS,
  EXPENSE_ACCESS,
  EXPENSE_PERMISSIONS,
  hasPermission,
  isPermission,
  PERMISSION_GROUPS,
} from "@/lib/permissions";
import { DEPOT_ACCESS } from "@/lib/depot";

describe("Expense Management Permissions (খরচ ও ব্যয় ব্যবস্থাপনা)", () => {
  const EXPECTED_KEYS = [
    "expense:view",
    "expense:create",
    "expense:edit",
    "expense:delete",
    "expense:approve",
    "expense:category_manage",
    "expense:max_limit_override",
  ] as const;

  it("group exists with correct label and 7 permissions", () => {
    const group = PERMISSION_GROUPS.find((g) => g.label === "খরচ ও ব্যয় ব্যবস্থাপনা");
    expect(group).toBeDefined();
    expect(group?.permissions).toHaveLength(7);
    expect(group?.permissions.map((p) => p.key)).toEqual(EXPECTED_KEYS);
  });

  it("each permission has Bengali label and hint", () => {
    const group = PERMISSION_GROUPS.find((g) => g.label === "খরচ ও ব্যয় ব্যবস্থাপনা")!;
    for (const p of group.permissions) {
      expect(p.label).toBeTruthy();
      expect("hint" in p && p.hint).toBeTruthy();
      expect(isPermission(p.key)).toBe(true);
    }
  });

  it("EXPENSE_PERMISSIONS contains all 7 keys and is included in ALL_PERMISSIONS", () => {
    expect(EXPENSE_PERMISSIONS).toEqual(EXPECTED_KEYS);
    for (const k of EXPECTED_KEYS) {
      expect(ALL_PERMISSIONS).toContain(k);
    }
  });

  it("default Admin and Accountant roles include all 7 expense permissions", () => {
    const admin = defaults.roles.find((r) => r.name.includes("Admin"))!;
    const accountant = defaults.roles.find((r) => r.name.includes("Accountant"))!;
    for (const k of EXPECTED_KEYS) {
      expect(admin.permissions).toContain(k);
      expect(accountant.permissions).toContain(k);
    }
  });

  it("EXPENSE_ACCESS provides fallback access for existing roles and allows fine-grained roles", () => {
    // A role with only expense:create can access expense create
    expect(hasPermission(["expense:create"], EXPENSE_ACCESS.create)).toBe(true);
    expect(hasPermission(["expense:create"], EXPENSE_ACCESS.view)).toBe(false);

    // A role with only vouchers:create can still access expense create (backward compatible)
    expect(hasPermission(["vouchers:create"], EXPENSE_ACCESS.create)).toBe(true);

    // A role with reports:view or expense:view can view expenses
    expect(hasPermission(["expense:view"], EXPENSE_ACCESS.view)).toBe(true);
    expect(hasPermission(["reports:view"], EXPENSE_ACCESS.view)).toBe(true);

    // Fine-grained approve
    expect(hasPermission(["expense:approve"], EXPENSE_ACCESS.approve)).toBe(true);

    // Fine-grained category management
    expect(hasPermission(["expense:category_manage"], EXPENSE_ACCESS.categoryManage)).toBe(true);
    expect(hasPermission(["accounts:manage"], EXPENSE_ACCESS.categoryManage)).toBe(true);

    // Max limit override
    expect(hasPermission(["expense:max_limit_override"], EXPENSE_ACCESS.maxLimitOverride)).toBe(true);
    expect(hasPermission(["expense:create"], EXPENSE_ACCESS.maxLimitOverride)).toBe(false);
  });

  it("depot expense permissions coordinate with general expense permissions", () => {
    expect(hasPermission(["depot:expense_manage"], DEPOT_ACCESS.expense)).toBe(true);
    expect(hasPermission(["expense:view"], DEPOT_ACCESS.expense)).toBe(true);

    expect(hasPermission(["depot:expense_manage"], DEPOT_ACCESS.expenseCreate)).toBe(true);
    expect(hasPermission(["expense:create"], DEPOT_ACCESS.expenseCreate)).toBe(true);

    expect(hasPermission(["depot:expense_manage"], DEPOT_ACCESS.expenseEdit)).toBe(true);
    expect(hasPermission(["expense:edit"], DEPOT_ACCESS.expenseEdit)).toBe(true);

    expect(hasPermission(["depot:expense_manage"], DEPOT_ACCESS.expenseDelete)).toBe(true);
    expect(hasPermission(["expense:delete"], DEPOT_ACCESS.expenseDelete)).toBe(true);
  });
});
