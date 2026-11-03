import { NextResponse, type NextRequest } from "next/server";
import { hasPermission } from "@/lib/permissions";
import { getContext } from "@/server/auth";
import { prisma } from "@/lib/db";
import { verifyBulkSmsBdApiKey } from "@/server/sms/bulksmsbd-bridge";
import { encryptSecret, secretHint } from "@/server/sms/secret";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!hasPermission(ctx.permissions, "sms:manage")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const apiKey = searchParams.get("api_key") || searchParams.get("apiKey");
  const senderId = searchParams.get("sender_id") || searchParams.get("senderId") || null;

  if (!apiKey) {
    return new NextResponse(
      `<!DOCTYPE html>
      <html>
      <head><title>Error</title><meta charset="utf-8"/></head>
      <body style="font-family:sans-serif;text-align:center;padding:50px;">
        <h2 style="color:#dc2626;">API Key Missing</h2>
        <p>No API key was provided by BulkSMSBD portal.</p>
        <button onclick="window.close()" style="padding:8px 16px;cursor:pointer;">Close Window</button>
      </body>
      </html>`,
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const verify = await verifyBulkSmsBdApiKey(apiKey);
  if (!verify.ok) {
    return new NextResponse(
      `<!DOCTYPE html>
      <html>
      <head><title>Verification Failed</title><meta charset="utf-8"/></head>
      <body style="font-family:sans-serif;text-align:center;padding:50px;">
        <h2 style="color:#dc2626;">Verification Failed</h2>
        <p>${verify.message}</p>
        <button onclick="window.close()" style="padding:8px 16px;cursor:pointer;">Close Window</button>
      </body>
      </html>`,
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const now = new Date();
  const data = {
    provider: "bulksmsbd",
    enabled: true,
    apiKeyEnc: encryptSecret(apiKey),
    apiKeyHint: secretHint(apiKey),
    ...(senderId ? { senderId } : {}),
    ...(verify.balance !== undefined ? { balance: verify.balance, balanceCheckedAt: now } : {}),
  };

  await prisma.smsSettings.upsert({
    where: { businessId: ctx.business.id },
    create: {
      businessId: ctx.business.id,
      ...data,
    },
    update: data,
  });

  await audit({
    businessId: ctx.business.id,
    userId: ctx.user.id,
    action: "UPDATE",
    entity: "SmsSettings",
    entityId: ctx.business.id,
    details: {
      provider: "bulksmsbd",
      callbackConnect: true,
      balance: verify.balance,
      senderId: senderId ?? undefined,
      apiKeyHint: secretHint(apiKey),
    },
  });

  const payload = JSON.stringify({
    type: "BULKSMSBD_CONNECTED",
    ok: true,
    balance: verify.balance,
    apiKeyHint: secretHint(apiKey),
    senderId: senderId || "",
  });

  return new NextResponse(
    `<!DOCTYPE html>
    <html>
    <head>
      <title>BulkSMSBD Connected</title>
      <meta charset="utf-8"/>
    </head>
    <body style="font-family:sans-serif;text-align:center;padding:50px;line-height:1.6;">
      <h2 style="color:#16a34a;">BulkSMSBD Connected Successfully!</h2>
      <p>Balance: BDT ${Number(verify.balance ?? 0).toFixed(2)}</p>
      <p>Closing window...</p>
      <script>
        const payload = ${payload};
        if (window.opener) {
          try {
            window.opener.postMessage(payload, "*");
          } catch(e) {}
          setTimeout(() => window.close(), 1200);
        } else {
          setTimeout(() => { window.location.href = "/sms/settings?connected=1"; }, 1500);
        }
      </script>
    </body>
    </html>`,
    {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }
  );
}
