import { NextResponse, type NextRequest } from "next/server";
import { processProviderResult } from "@/server/billing/checkout";
import { BillingProviderError } from "@/server/billing/providers";

export const dynamic = "force-dynamic";

/**
 * Server-to-server notification (IPN) from a gateway. Same verification as the browser callback;
 * idempotent, so gateways may retry. Answers 400 to anything that fails verification.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const type = req.headers.get("content-type") ?? "";
  let fields: Record<string, string> = {};
  try {
    if (type.includes("application/json")) fields = Object.fromEntries(Object.entries((await req.json()) as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
    else fields = Object.fromEntries([...(await req.formData()).entries()].map(([k, v]) => [k, String(v)]));
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  try {
    const r = await processProviderResult(provider, fields);
    return NextResponse.json({ ok: true, transaction: r.transactionId, outcome: r.outcome });
  } catch (e) {
    if (e instanceof BillingProviderError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    console.error("[billing:webhook]", provider, e);
    return NextResponse.json({ ok: false, error: "server error" }, { status: 500 });
  }
}
