import { NextResponse, type NextRequest } from "next/server";
import { processProviderResult } from "@/server/billing/checkout";
import { BillingProviderError } from "@/server/billing/providers";

export const dynamic = "force-dynamic";

/**
 * The customer's browser returns here from the gateway. Nothing in the URL is trusted: the provider
 * adapter verifies the result (signature or a server-to-server query) before anything is activated.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const back = new URLSearchParams();
  try {
    const r = await processProviderResult(provider, Object.fromEntries(req.nextUrl.searchParams.entries()));
    back.set("txn", r.transactionId);
    back.set("outcome", r.outcome);
  } catch (e) {
    back.set("outcome", "INVALID");
    if (!(e instanceof BillingProviderError)) console.error("[billing:callback]", provider, e);
  }
  // relative Location: the browser stays on the host it used (and keeps its session cookie); behind a
  // proxy the server-side origin can differ from the public one
  return new NextResponse(null, { status: 303, headers: { location: `/billing/result?${back}` } });
}
