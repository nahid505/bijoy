import { describe, expect, it } from "vitest";
import { dashboardDates } from "@/app/(app)/dashboard/dashboard-parts";

describe("dashboard header dates", () => {
  it("English and Bangla with the weekday", () => {
    expect(dashboardDates("2026-10-28")).toEqual({ en: "28 October 2026", bn: "২৮ অক্টোবর ২০২৬, বুধবার" });
    expect(dashboardDates("2026-10-29").bn).toBe("২৯ অক্টোবর ২০২৬, বৃহস্পতিবার");
    expect(dashboardDates("2026-11-01").bn).toBe("১ নভেম্বর ২০২৬, রবিবার");
  });
});
