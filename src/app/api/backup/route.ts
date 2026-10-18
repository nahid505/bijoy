import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/permissions";
import { toDateInput } from "@/lib/format";
import { getContext } from "@/server/auth";
import { isRestricted } from "@/server/party-scope";
import { audit } from "@/server/audit";
import { exportBusiness } from "@/server/services/backup";

export const dynamic = "force-dynamic";

/** Versioned, checksummed JSON export of the CURRENT business only (tenant-scoped). */
export async function GET() {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // a full export would bypass the assigned-only (row-level) restriction
  if (!hasPermission(ctx.permissions, "backup:manage") || isRestricted(ctx)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const backup = await exportBusiness(ctx.business.id);
  await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "CREATE", entity: "Backup", details: { vouchers: backup.data.vouchers.length, checksum: backup.checksum } });
  return new NextResponse(JSON.stringify(backup), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="bijoy-lenden-backup-${toDateInput()}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
