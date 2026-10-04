import "server-only";
import { cookies } from "next/headers";

export const FLASH_COOKIE = "bl_flash";

/** One-shot toast message that survives a redirect (read and cleared by <Toaster/>). */
export async function flash(message: string, type: "success" | "error" | "info" = "success") {
  // Next.js URL-encodes cookie values itself; the client decodes once.
  (await cookies()).set(FLASH_COOKIE, JSON.stringify({ type, message }), {
    path: "/",
    maxAge: 30,
    sameSite: "lax",
    httpOnly: false, // read by the client toaster; contains no sensitive data
  });
}
