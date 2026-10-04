import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getClientIp } from "./auth";

export type AuditAction = "CREATE" | "UPDATE" | "DELETE" | "LOGIN" | "LOGOUT" | "LOGIN_FAILED";

export async function audit(params: {
  businessId?: string | null;
  userId: string | null;
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  details?: Prisma.InputJsonValue;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        businessId: params.businessId ?? null,
        userId: params.userId,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId ?? null,
        details: params.details,
        ipAddress: await getClientIp(),
      },
    });
  } catch (err) {
    console.error("audit log failed", err); // auditing must never break the main operation
  }
}
