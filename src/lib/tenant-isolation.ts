import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@prisma/client";

export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantIsolationError";
  }
}

export interface TenantContextStore {
  businessId?: string;
  bypassTenantCheck?: boolean;
}

export const tenantStorage = new AsyncLocalStorage<TenantContextStore>();

/**
 * Runs a function with an active tenant businessId context.
 * Queries on tenant-scoped models without an explicit where.businessId
 * will automatically inherit this businessId.
 */
export async function withTenantContext<T>(businessId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ businessId, bypassTenantCheck: false }, fn);
}

/**
 * Runs a function bypassing tenant isolation enforcement.
 * Intended for super-admin platform jobs, data migrations, and cross-tenant consolidations.
 */
export async function withBypassTenantCheck<T>(fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ bypassTenantCheck: true }, fn);
}

/**
 * All transaction, ledger, inventory, payroll, and master models
 * that MUST strictly be scoped by businessId/tenant_id.
 */
export const TENANT_SCOPED_MODELS = new Set([
  "Voucher",
  "JournalEntry",
  "StockMovement",
  "Customer",
  "Supplier",
  "Product",
  "Account",
  "AccountGroup",
  "Warehouse",
  "Category",
  "Brand",
  "Unit",
  "Department",
  "Employee",
  "PayrollRun",
  "Payslip",
  "Attendance",
  "Recipe",
  "ProductionRun",
  "PaddyPurchase",
  "PaddyPurchaseItem",
  "DepotDelivery",
  "BankTransferLog",
  "BankDisbursementBatch",
  "SmsMessage",
  "SmsTemplate",
  "AuditLog",
  "ProductBatch",
  "Notification",
]);

/**
 * Models where businessId is optional in the database schema
 * (e.g. system-level auth events, OTP SMS before registration/login, platform notifications).
 */
export const OPTIONAL_TENANT_MODELS = new Set([
  "SmsMessage",
  "AuditLog",
  "Notification",
]);

/**
 * Inspects a query 'where' clause to determine if a tenant constraint is present.
 */
export function hasTenantCondition(where: unknown): boolean {
  if (!where || typeof where !== "object") return false;
  const w = where as Record<string, unknown>;

  if (w.businessId !== undefined || w.tenantId !== undefined || w.business_id !== undefined || w.tenant_id !== undefined) {
    return true;
  }

  // Check compound unique keys such as businessId_code, businessId_sourceKey, etc.
  for (const key of Object.keys(w)) {
    if (key.startsWith("businessId_") || key.startsWith("tenantId_")) {
      return true;
    }
    if (key === "business" && typeof w.business === "object" && w.business !== null) {
      const b = w.business as Record<string, unknown>;
      if (b.id !== undefined || hasTenantCondition(b)) return true;
    }
    if (key === "AND" && Array.isArray(w.AND)) {
      if (w.AND.some((cond) => hasTenantCondition(cond))) return true;
    }
    if (key === "OR" && Array.isArray(w.OR)) {
      if (w.OR.every((cond) => hasTenantCondition(cond))) return true;
    }

    // Check nested relation filters (e.g. { voucher: { businessId } }, { recipe: { businessId } }, etc.)
    const val = w[key];
    if (val && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
      if (hasTenantCondition(val)) {
        return true;
      }
    }
  }

  // Scoped parent relations / primary entity pointers that unambiguously identify a tenant record
  if (
    w.voucherId !== undefined ||
    w.voucherItemId !== undefined ||
    w.productionId !== undefined ||
    w.paddyPurchaseId !== undefined ||
    w.payrollRunId !== undefined ||
    w.runId !== undefined ||
    w.payslipId !== undefined ||
    w.employeeId !== undefined ||
    w.bankDisbursementBatchId !== undefined ||
    w.batchId !== undefined ||
    w.productId !== undefined ||
    w.accountId !== undefined ||
    w.customerId !== undefined ||
    w.supplierId !== undefined
  ) {
    return true;
  }

  return false;
}

export function hasParentPointer(data: Record<string, unknown> | undefined): boolean {
  if (!data || typeof data !== "object") return false;
  return Boolean(
    data.businessId ||
    data.tenantId ||
    data.business_id ||
    data.tenant_id ||
    data.voucherId ||
    data.payslipId ||
    data.runId ||
    data.payrollRunId ||
    data.productionId ||
    data.paddyPurchaseId ||
    data.bankDisbursementBatchId
  );
}

/**
 * Prisma Client Extension that enforces tenant isolation on all transaction and master models.
 */
export function createTenantIsolationExtension() {
  return Prisma.defineExtension((client) => {
    return client.$extends({
      name: "tenant-isolation",
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            // Only enforce on registered tenant models
            if (!model || !TENANT_SCOPED_MODELS.has(model)) {
              return query(args);
            }

            const store = tenantStorage.getStore();
            if (store?.bypassTenantCheck) {
              return query(args);
            }

            // READ & AGGREGATE OPERATIONS
            if (
              operation === "findMany" ||
              operation === "findFirst" ||
              operation === "findFirstOrThrow" ||
              operation === "count" ||
              operation === "aggregate" ||
              operation === "groupBy" ||
              operation === "updateMany" ||
              operation === "deleteMany"
            ) {
              const where = (args as { where?: Record<string, unknown> })?.where;

              // When an ambient tenant context is active:
              if (store?.businessId) {
                // Guard against explicit cross-tenant attempts
                const explicitBizId = (where as Record<string, unknown> | undefined)?.businessId;
                if (explicitBizId && typeof explicitBizId === "string" && explicitBizId !== store.businessId) {
                  throw new TenantIsolationError(
                    `Tenant isolation violation: Model "${model}" attempted cross-tenant access to "${explicitBizId}" from context "${store.businessId}".`
                  );
                }

                // If no explicit tenant condition, inject context businessId (even if id is specified)
                if (!hasTenantCondition(where)) {
                  const updatedArgs = {
                    ...args,
                    where: {
                      ...(where || {}),
                      businessId: store.businessId,
                    },
                  };
                  return query(updatedArgs);
                }
              }

              if (hasTenantCondition(where)) {
                return query(args);
              }

              const hasExplicitId =
                where &&
                (where.id !== undefined ||
                  (typeof where.id === "object" &&
                    where.id !== null &&
                    Array.isArray((where.id as { in?: unknown[] }).in)));
              if (hasExplicitId || OPTIONAL_TENANT_MODELS.has(model)) {
                return query(args);
              }

              throw new TenantIsolationError(
                `Tenant isolation violation: Model "${model}" query operation "${operation}" requires an explicit "businessId" or "tenant_id" filter.`
              );
            }

            // CREATE OPERATIONS
            if (operation === "create") {
              const data = (args as { data?: Record<string, unknown> })?.data;
              if (store?.businessId) {
                if (data?.businessId && data.businessId !== store.businessId && !OPTIONAL_TENANT_MODELS.has(model)) {
                  throw new TenantIsolationError(
                    `Tenant isolation violation: Model "${model}" create operation attempted for business "${data.businessId}" under context "${store.businessId}".`
                  );
                }
                if (!data?.businessId && !data?.tenantId && !data?.business_id && !data?.tenant_id && !hasParentPointer(data)) {
                  (data as Record<string, unknown>).businessId = store.businessId;
                }
              } else if (!hasParentPointer(data)) {
                if (!OPTIONAL_TENANT_MODELS.has(model)) {
                  throw new TenantIsolationError(
                    `Tenant isolation violation: Model "${model}" create operation requires an explicit "businessId" or "tenant_id".`
                  );
                }
              }
              return query(args);
            }

            if (operation === "createMany") {
              const createManyArgs = args as { data?: Record<string, unknown> | Record<string, unknown>[] };
              const items = Array.isArray(createManyArgs?.data)
                ? createManyArgs.data
                : createManyArgs?.data
                ? [createManyArgs.data]
                : [];

              for (const item of items) {
                if (!hasParentPointer(item)) {
                  if (store?.businessId) {
                    item.businessId = store.businessId;
                  } else if (!OPTIONAL_TENANT_MODELS.has(model)) {
                    throw new TenantIsolationError(
                      `Tenant isolation violation: Model "${model}" createMany operation requires an explicit "businessId" or "tenant_id" on each item.`
                    );
                  }
                }
              }
              return query(args);
            }

            return query(args);
          },
        },
      },
    });
  });
}
