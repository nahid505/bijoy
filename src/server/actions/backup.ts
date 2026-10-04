"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertPermission, setBusinessCookie } from "../auth";
import { audit } from "../audit";
import { flash } from "../flash";
import { guard, UserError } from "../action-utils";
import { restoreBackup, validateBackup, type ValidationReport } from "../services/backup";

const MAX_BYTES = 50 * 1024 * 1024;

export type BackupActionState = { ok: boolean; message?: string; report?: ValidationReport } | null;

async function readUpload(fd: FormData): Promise<unknown> {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) throw new UserError("ব্যাকআপ ফাইল নির্বাচন করুন");
  if (file.size > MAX_BYTES) throw new UserError("ফাইল সর্বোচ্চ ৫০ MB হতে পারবে");
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new UserError("ফাইলটি বৈধ JSON নয়");
  }
}

/** Validates a backup file without writing anything. */
export async function validateBackupAction(_prev: BackupActionState, fd: FormData): Promise<BackupActionState> {
  const result = await guard(async () => {
    await assertPermission("backup:manage");
    return validateBackup(await readUpload(fd));
  });
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: result.data.ok, message: result.data.ok ? "ব্যাকআপ ফাইল বৈধ — রিস্টোর করা যাবে" : "ব্যাকআপ ফাইলে সমস্যা পাওয়া গেছে", report: result.data };
}

/** Restores a backup as a NEW business (never overwrites) and switches to it. */
export async function restoreBackupAction(_prev: BackupActionState, fd: FormData): Promise<BackupActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("backup:manage");
    const restored = await restoreBackup(await readUpload(fd), ctx.user.id);
    await audit({ businessId: restored.businessId, userId: ctx.user.id, action: "CREATE", entity: "Backup", entityId: restored.businessId, details: { restoredFrom: ctx.business.id, name: restored.name } });
    return restored;
  });
  if (!result.ok) return { ok: false, message: result.message };
  await setBusinessCookie(result.data.businessId);
  await flash(`"${result.data.name}" নামে রিস্টোর সম্পন্ন — ট্রায়াল ব্যালেন্স যাচাই করা হয়েছে`);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
