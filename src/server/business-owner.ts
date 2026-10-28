import "server-only";
import { UserError } from "@/lib/errors";
import type { AppContext } from "./auth";

/** The business owner only (the role with "*"): the business types decide which modules every user of the business sees. */
export function assertOwner(ctx: AppContext): AppContext {
  if (!ctx.isOwner) throw new UserError("ব্যবসার ধরন শুধু ব্যবসার মালিক পরিবর্তন করতে পারেন");
  return ctx;
}
