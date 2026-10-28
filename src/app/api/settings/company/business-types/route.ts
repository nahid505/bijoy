import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { businessModules, primaryBusinessType } from "@/lib/business-types";
import { businessTypesSchema } from "@/lib/validation";
import { getContext } from "@/server/auth";
import { audit } from "@/server/audit";
import { setBusinessTypes } from "@/server/services/bootstrap";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
const view = (types: string[]) => ({ businessTypes: types, primary: primaryBusinessType(types), modules: [...businessModules(types)] });

/** GET: the signed-in business's types and the modules they switch on (any user of the business). */
export async function GET() {
  const ctx = await getContext();
  if (!ctx) return json({ error: "unauthorized" }, 401);
  return json(view(ctx.business.businessTypes));
}

/**
 * PUT /api/settings/company/business-types  { "businessTypes": ["RETAIL", "DEPOT"] }
 * The business owner only (business:manage on the owner role). Same rules as the settings page's form.
 */
export async function PUT(req: Request) {
  const ctx = await getContext();
  if (!ctx) return json({ error: "unauthorized" }, 401);
  if (!hasPermission(ctx.permissions, "business:manage") || !ctx.isOwner) return json({ error: "forbidden", message: "ব্যবসার ধরন শুধু ব্যবসার মালিক পরিবর্তন করতে পারেন" }, 403);
  // same-origin JSON only (a cross-site form or script cannot send it with the session cookie). Compared with the Host the
  // browser addressed — X-Forwarded-Host behind a proxy (cPanel / Caddy), as Next.js does for server actions; req.url
  // holds the internal address there.
  const origin = req.headers.get("origin");
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host).split(",")[0].trim();
  if (origin && new URL(origin).host !== host) return json({ error: "forbidden", message: "cross-origin request" }, 403);
  if (!req.headers.get("content-type")?.includes("application/json")) return json({ error: "unsupported media type", message: "Content-Type: application/json দিন" }, 415);
  let input;
  try {
    input = businessTypesSchema.parse(await req.json());
  } catch (e) {
    const message = e instanceof ZodError ? e.issues[0]?.message ?? "তথ্য সঠিক নয়" : "JSON সঠিক নয়";
    return json({ error: "invalid", message }, 400);
  }
  const before = ctx.business.businessTypes;
  const saved = await prisma.$transaction((tx) => setBusinessTypes(tx, ctx.business.id, input.businessTypes));
  await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: "Business", entityId: ctx.business.id, details: { businessTypes: { before, after: saved.businessTypes }, via: "api" } });
  return json(view(saved.businessTypes));
}
