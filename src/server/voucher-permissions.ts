import { voucherPermissionFamily, type VoucherTypeKey } from "@/lib/accounting";
import type { Permission } from "@/lib/permissions";

export type VoucherAction = "view" | "create" | "edit" | "delete";

/** Maps (voucher type, action) → permission key, enforced on every page and action. */
export function voucherPermission(type: VoucherTypeKey, action: VoucherAction): Permission {
  const family = voucherPermissionFamily(type);
  if (family === "stock") return action === "view" ? "inventory:view" : "stock:adjust";
  if (family === "production") return action === "view" ? "production:view" : "production:manage";
  return `${family}:${action}` as Permission;
}
