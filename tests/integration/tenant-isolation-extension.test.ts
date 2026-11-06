import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  TenantIsolationError,
  withTenantContext,
  withBypassTenantCheck,
  hasTenantCondition,
} from "@/lib/tenant-isolation";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

run("Prisma Client Tenant Isolation Extension", () => {
  it("hasTenantCondition correctly recognizes tenant constraints and scoped foreign keys", () => {
    expect(hasTenantCondition({ businessId: "biz-123" })).toBe(true);
    expect(hasTenantCondition({ tenantId: "tenant-1" })).toBe(true);
    expect(hasTenantCondition({ businessId_code: "biz_1" })).toBe(true);
    expect(hasTenantCondition({ business: { id: "biz-123" } })).toBe(true);
    expect(hasTenantCondition({ voucherId: "v-123" })).toBe(true);
    expect(hasTenantCondition({ productId: "p-123" })).toBe(true);
    expect(hasTenantCondition({ AND: [{ businessId: "biz-1" }] })).toBe(true);

    // Negative cases
    expect(hasTenantCondition({})).toBe(false);
    expect(hasTenantCondition(null)).toBe(false);
    expect(hasTenantCondition({ type: "SALES" })).toBe(false);
    expect(hasTenantCondition({ date: { gte: new Date() } })).toBe(false);
  });

  it("throws TenantIsolationError when querying a tenant-scoped model without businessId or parent key", async () => {
    await expect(
      prisma.voucher.findMany({
        where: { type: "SALES" },
      })
    ).rejects.toThrow(TenantIsolationError);

    await expect(
      prisma.customer.findMany({
        where: { isActive: true },
      })
    ).rejects.toThrow(
      'Tenant isolation violation: Model "Customer" query operation "findMany" requires an explicit "businessId" or "tenant_id" filter.'
    );

    await expect(
      prisma.product.count({
        where: { isActive: true },
      })
    ).rejects.toThrow(TenantIsolationError);
  });

  it("permits query when explicit businessId is provided in where clause", async () => {
    // Valid query with explicit businessId
    const vouchers = await prisma.voucher.findMany({
      where: { businessId: "dummy-business-id" },
      take: 1,
    });
    expect(Array.isArray(vouchers)).toBe(true);
  });

  it("permits query when explicit primary id is provided in where clause", async () => {
    const voucher = await prisma.voucher.findFirst({
      where: { id: "non-existent-voucher-id" },
    });
    expect(voucher).toBeNull();
  });

  it("automatically injects businessId when running inside withTenantContext", async () => {
    const fakeBizId = "scoped-context-biz-id";
    await withTenantContext(fakeBizId, async () => {
      // Query has no explicit businessId in where, but extension should auto-inject it
      const count = await prisma.customer.count({
        where: { isActive: true },
      });
      expect(typeof count).toBe("number");
    });
  });

  it("allows cross-tenant read and aggregation queries inside withBypassTenantCheck", async () => {
    await withBypassTenantCheck(async () => {
      // Cross-tenant query with no businessId filter
      const totalCount = await prisma.voucher.count();
      expect(typeof totalCount).toBe("number");

      const someProducts = await prisma.product.findMany({
        take: 2,
        select: { id: true, businessId: true },
      });
      expect(Array.isArray(someProducts)).toBe(true);
    });
  });
});
