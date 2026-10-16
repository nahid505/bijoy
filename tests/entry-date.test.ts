import { describe, expect, it } from "vitest";
import { CHANGE_DATE_PERMISSION, entryDateAllowed, isoDay, lockedEntryDate } from "@/lib/entry-date";
import { hasPermission, isPermission, PERMISSION_GROUPS } from "@/lib/permissions";
import defaults from "@/lib/business-defaults.json";

describe("date lock (transaction:change_date)", () => {
  const today = "2026-10-14";

  it("is a real permission, shown as a checkbox in its own group, granted by '*'", () => {
    expect(isPermission(CHANGE_DATE_PERMISSION)).toBe(true);
    const group = PERMISSION_GROUPS.find((g) => g.permissions.some((p) => p.key === CHANGE_DATE_PERMISSION))!;
    expect(group.label).toBe("সাধারণ অনুমতি (লেনদেন)");
    expect(group.permissions[0].label).toContain("লেনদেনের তারিখ পরিবর্তন করার অনুমতি");
    expect(hasPermission(["*"], "transaction:change_date")).toBe(true);
    expect(hasPermission(["vouchers:create"], "transaction:change_date")).toBe(false);
  });

  it("without the permission: a new entry only today, an edit only its own date", () => {
    const allowed = (date: string, originalDate?: string) => entryDateAllowed({ canChangeDate: false, date, today, originalDate });
    expect(allowed("2026-10-14")).toBe(true);
    expect(allowed("2026-10-13")).toBe(false); // back-dated
    expect(allowed("2026-10-15")).toBe(false); // future
    expect(allowed("2026-09-01", "2026-09-01")).toBe(true); // editing an old voucher keeps its date
    expect(allowed("2026-10-14", "2026-09-01")).toBe(false); // …and is not moved to today
    expect(lockedEntryDate(today)).toBe(today);
    expect(lockedEntryDate(today, "2026-09-01")).toBe("2026-09-01");
  });

  it("with the permission: any date", () => {
    for (const date of ["2020-01-01", "2026-10-13", "2026-10-15"]) expect(entryDateAllowed({ canChangeDate: true, date, today })).toBe(true);
    expect(entryDateAllowed({ canChangeDate: true, date: "2026-01-01", today, originalDate: "2026-09-01" })).toBe(true);
  });

  it("stored dates are compared as calendar days", () => {
    expect(isoDay(new Date("2026-10-14T00:00:00.000Z"))).toBe("2026-10-14");
  });

  it("default roles: office roles may change the date; counter roles (sales person, cashier) are locked", () => {
    const has = (name: string) => defaults.roles.find((r) => r.name.includes(name))!.permissions.includes(CHANGE_DATE_PERMISSION);
    for (const r of ["Admin", "Manager", "Accountant", "Purchase", "Inventory"]) expect(has(r)).toBe(true);
    for (const r of ["Salesperson", "Cashier", "Viewer", "HR"]) expect(has(r)).toBe(false);
    expect(defaults.roles.find((r) => r.name.includes("Owner"))!.permissions).toEqual(["*"]);
  });
});
