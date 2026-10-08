"use server";

// Feature & module activation. Only users with "features:manage" (Admin / Owner) may switch
// modules; the check happens here on the server, not only by hiding buttons.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertPermission } from "../auth";
import { audit } from "../audit";
import { guard, toResult, type ActionState } from "../action-utils";
import { setFeatureEnabled } from "../features";
import { flash } from "../flash";

export async function setFeatureAction(key: string, enabled: boolean, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("features:manage");
    const note = String(fd.get("note") ?? "").trim().slice(0, 300) || null;
    const res = await setFeatureEnabled({ businessId: ctx.business.id, userId: ctx.user.id, isOwner: ctx.isOwner }, key, enabled, note);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: "Feature", entityId: key, details: { feature: key, enabled, note } });
    return res;
  });
  if (!r.ok) return toResult(r);
  await flash(`"${r.data.def.nameBn}" ${enabled ? "চালু হয়েছে — মেনু ও পাতা এখন দেখা যাবে" : "বন্ধ হয়েছে — তথ্য সংরক্ষিত আছে, শুধু প্রবেশ বন্ধ"}`);
  revalidatePath("/", "layout"); // menus everywhere change
  redirect("/features");
}
