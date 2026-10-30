import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Handles image upload for ledgers and accounts.
 * Saves uploaded image to /public/uploads/ledgers and returns the public URL path.
 */
export async function saveLedgerImageUpload(fd: FormData): Promise<string | null | undefined> {
  const remove = fd.get("removeImage");
  if (remove === "true") {
    return null;
  }

  // 1. Native File from browser
  const file = fd.get("image");
  if (file && typeof file === "object" && "size" in file && (file as { size: number }).size > 0) {
    const f = file as File;
    const arrayBuffer = await f.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const rawExt = path.extname(f.name || "").toLowerCase();
    const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(rawExt) ? rawExt : ".jpg";
    const filename = `ledger-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${safeExt}`;
    const targetDir = path.join(process.cwd(), "public", "uploads", "ledgers");
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, filename), buffer);
    return `/uploads/ledgers/${filename}`;
  }

  // 2. Base64 data URL
  const base64 = fd.get("imageBase64");
  if (typeof base64 === "string" && base64.startsWith("data:image/")) {
    const match = base64.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
    if (match) {
      const ext = match[1] === "jpeg" ? ".jpg" : `.${match[1]}`;
      const buffer = Buffer.from(match[2], "base64");
      const filename = `ledger-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
      const targetDir = path.join(process.cwd(), "public", "uploads", "ledgers");
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(path.join(targetDir, filename), buffer);
      return `/uploads/ledgers/${filename}`;
    }
  }

  // 3. Raw URL string if already uploaded
  const rawUrl = fd.get("imageUrl");
  if (typeof rawUrl === "string" && rawUrl.trim()) {
    return rawUrl.trim();
  }

  return undefined;
}

/**
 * Handles image upload for customers and suppliers (parties).
 * Saves uploaded image to /public/uploads/parties and returns the public URL path.
 */
export async function savePartyImageUpload(fd: FormData): Promise<string | null | undefined> {
  const remove = fd.get("removeImage");
  if (remove === "true") {
    return null;
  }

  // 1. Native File from browser
  const file = fd.get("image");
  if (file && typeof file === "object" && "size" in file && (file as { size: number }).size > 0) {
    const f = file as File;
    const arrayBuffer = await f.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const rawExt = path.extname(f.name || "").toLowerCase();
    const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(rawExt) ? rawExt : ".jpg";
    const filename = `party-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${safeExt}`;
    const targetDir = path.join(process.cwd(), "public", "uploads", "parties");
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, filename), buffer);
    return `/uploads/parties/${filename}`;
  }

  // 2. Base64 data URL
  const base64 = fd.get("imageBase64");
  if (typeof base64 === "string" && base64.startsWith("data:image/")) {
    const match = base64.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
    if (match) {
      const ext = match[1] === "jpeg" ? ".jpg" : `.${match[1]}`;
      const buffer = Buffer.from(match[2], "base64");
      const filename = `party-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
      const targetDir = path.join(process.cwd(), "public", "uploads", "parties");
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(path.join(targetDir, filename), buffer);
      return `/uploads/parties/${filename}`;
    }
  }

  // 3. Raw URL string if already uploaded
  const rawUrl = fd.get("imageUrl");
  if (typeof rawUrl === "string" && rawUrl.trim()) {
    return rawUrl.trim();
  }

  return undefined;
}
