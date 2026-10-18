import { voucherPermissionFamily, type VoucherTypeKey } from "@/lib/accounting";
import type { Permission } from "@/lib/permissions";
import { isDepot } from "@/lib/depot";

export type VoucherAction = "view" | "create" | "edit" | "delete";

/** Maps (voucher type, action) → permission key, enforced on every page and action. */
export function voucherPermission(type: VoucherTypeKey, action: VoucherAction): Permission {
  const family = voucherPermissionFamily(type);
  if (family === "stock") return action === "view" ? "inventory:view" : "stock:adjust";
  if (family === "production") return action === "view" ? "production:view" : "production:manage";
  return `${family}:${action}` as Permission;
}

/** Depot permissions that also open a voucher type in a depot business (stock in = purchase, market collection = receipt). */
export function depotVoucherPermissions(type: VoucherTypeKey, action: VoucherAction): Permission[] {
  if (type === "DEPOT_DELIVERY") return action === "view" ? ["depot:view", "depot:delivery_manage"] : ["depot:delivery_manage"];
  if ((type === "PURCHASE" || type === "PURCHASE_RETURN") && (action === "view" || action === "create")) return ["depot:stock_in"];
  if (type === "RECEIPT" && (action === "view" || action === "create")) return ["depot:collection_create"];
  if (type === "PAYMENT" && (action === "view" || action === "create")) return ["depot:company_payment"]; // paying the company
  if (type === "STOCK_JOURNAL" && (action === "view" || action === "create")) return ["depot:stock_adjust"]; // depot stock adjustment
  if (type === "SALES") return action === "view" ? ["depot:view", "depot:delivery_manage"] : ["depot:delivery_manage"]; // a depot-book sale is a market-sale challan
  return [];
}

/**
 * Every permission that opens (type, action) here — any one is enough. The depot permissions open only
 * depot-book vouchers (book DEPOT; challans always) in a depot business — never a general purchase / receipt.
 */
export function voucherAccess(type: VoucherTypeKey, action: VoucherAction, businessType: string | null | undefined, book: string = "GENERAL"): Permission[] {
  const depot = isDepot(businessType) && (book === "DEPOT" || type === "DEPOT_DELIVERY");
  return [voucherPermission(type, action), ...(depot ? depotVoucherPermissions(type, action) : [])];
}
