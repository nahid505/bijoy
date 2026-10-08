import "server-only";
// Platform operator access. Super admins are flagged on User.isSuperAdmin — set only from the server
// (npm run super-admin -- grant …), never from the UI. Pages answer 404 to everyone else (the panel's
// existence is not revealed); actions throw ForbiddenError.
import { notFound } from "next/navigation";
import { ForbiddenError, getCurrentUser, requireUser, type CurrentUser } from "./auth";

export async function requireSuperAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isSuperAdmin) notFound();
  return user;
}

export async function assertSuperAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user?.isSuperAdmin) throw new ForbiddenError();
  return user;
}
