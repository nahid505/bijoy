// Payment provider abstraction for subscription payments (Bangladesh first).
//
// A provider turns a PaymentTransaction into a checkout (redirect URL) and later VERIFIES the result
// server-side — a payment is never trusted because a browser says so:
//   • mock      development / tests only: a local "gateway" page whose callback carries an HMAC
//               signature (BILLING_WEBHOOK_SECRET, or derived from AUTH_SECRET); refused in production
//               unless BILLING_MOCK_ALLOW_PRODUCTION=true
//   • manual    the customer pays by bKash/Nagad/bank transfer and types the TrxID; a super admin
//               verifies it in the Super Admin panel (works without any gateway contract)
//   • bkash     bKash Tokenized Checkout (grant token → create → execute; status query as fallback).
//               Credentials only from the environment: BKASH_BASE_URL, BKASH_APP_KEY, BKASH_APP_SECRET,
//               BKASH_USERNAME, BKASH_PASSWORD. The callback is verified by calling bKash (execute/query).
//   • nagad, card — registered placeholders: they need merchant credentials / keys before they can be
//               implemented and enabled (see docs); they report "not configured".
// New gateways implement BillingProvider and call registerBillingProvider().
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

export type Outcome = "SUCCESS" | "FAILED" | "CANCELLED" | "PENDING";

export interface CheckoutInput {
  transactionId: string;
  amount: number;
  currency: string;
  description: string;
  customer: { name: string; mobile: string | null };
  baseUrl: string;
}
export interface CheckoutResult {
  redirectUrl: string;
  providerPaymentId?: string | null;
}
export interface CallbackResult {
  transactionId: string | null; // our transaction (or null when the provider only knows its own id)
  providerPaymentId?: string | null;
  outcome: Outcome;
  providerTrxId?: string | null;
  amount?: number;
  reason?: string;
  raw?: Record<string, unknown>;
}
export interface BillingProvider {
  id: string;
  labelBn: string;
  labelEn: string;
  kind: "redirect" | "manual";
  configured(): boolean;
  checkout?(input: CheckoutInput): Promise<CheckoutResult>;
  /** verify a browser return / gateway notification (params from the query string or the body) */
  verify?(params: Record<string, string>): Promise<CallbackResult>;
}

export class BillingProviderError extends Error {}

const registry = new Map<string, BillingProvider>();
export function registerBillingProvider(p: BillingProvider) {
  registry.set(p.id, p);
}
export const billingProvider = (id: string) => registry.get(id) ?? null;
export const allBillingProviders = () => [...registry.values()];
export const configuredBillingProviders = () => [...registry.values()].filter((p) => p.configured());

// ───────────────────────── mock (development) ─────────────────────────

function signingKey() {
  const base = process.env.BILLING_WEBHOOK_SECRET || process.env.AUTH_SECRET;
  if (!base || base.length < 32) throw new Error("BILLING_WEBHOOK_SECRET or AUTH_SECRET (min 32 chars) must be set");
  return Buffer.from(hkdfSync("sha256", base, "bijoy-lenden", "billing-mock-gateway", 32));
}
export function mockSignature(fields: { txn: string; outcome: string; trx: string; amount: string }) {
  return createHmac("sha256", signingKey()).update(`${fields.txn}|${fields.outcome}|${fields.trx}|${fields.amount}`).digest("base64url");
}
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

registerBillingProvider({
  id: "mock",
  labelBn: "টেস্ট গেটওয়ে (ডেভেলপমেন্ট)",
  labelEn: "Test gateway (development)",
  kind: "redirect",
  configured: () => process.env.BILLING_MOCK === "true" && (process.env.NODE_ENV !== "production" || process.env.BILLING_MOCK_ALLOW_PRODUCTION === "true"),
  async checkout(i) {
    return { redirectUrl: `${i.baseUrl}/billing/mock-gateway?txn=${encodeURIComponent(i.transactionId)}`, providerPaymentId: `mock-${i.transactionId}` };
  },
  async verify(p) {
    const fields = { txn: p.txn ?? "", outcome: p.outcome ?? "", trx: p.trx ?? "", amount: p.amount ?? "" };
    if (!p.sig || !safeEqual(p.sig, mockSignature(fields))) throw new BillingProviderError("invalid signature");
    const outcome = (["SUCCESS", "FAILED", "CANCELLED"] as const).find((o) => o === fields.outcome) ?? "FAILED";
    return { transactionId: fields.txn, outcome, providerTrxId: outcome === "SUCCESS" ? fields.trx : null, amount: Number(fields.amount), raw: { outcome, trx: fields.trx, amount: fields.amount }, reason: outcome === "SUCCESS" ? undefined : "customer did not complete the payment" };
  },
});

// ───────────────────────── manual transfer ─────────────────────────

registerBillingProvider({
  id: "manual",
  labelBn: "ম্যানুয়াল (বিকাশ/নগদ/ব্যাংক ট্রান্সফার — যাচাইয়ের পর চালু)",
  labelEn: "Manual transfer (activated after verification)",
  kind: "manual",
  configured: () => process.env.BILLING_MANUAL !== "false",
});

// ───────────────────────── bKash Tokenized Checkout ─────────────────────────

const bkashEnv = () => ({
  base: (process.env.BKASH_BASE_URL ?? "").replace(/\/+$/, ""),
  appKey: process.env.BKASH_APP_KEY ?? "",
  appSecret: process.env.BKASH_APP_SECRET ?? "",
  username: process.env.BKASH_USERNAME ?? "",
  password: process.env.BKASH_PASSWORD ?? "",
});
async function bkashCall(path: string, body: unknown, token?: string) {
  const e = bkashEnv();
  const res = await fetch(`${e.base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json", accept: "application/json",
      ...(token ? { authorization: token, "x-app-key": e.appKey } : { username: e.username, password: e.password }),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new BillingProviderError(`bKash ${path} → HTTP ${res.status}`);
  return json;
}
async function bkashToken() {
  const e = bkashEnv();
  const r = await bkashCall("/tokenized/checkout/token/grant", { app_key: e.appKey, app_secret: e.appSecret });
  if (!r.id_token) throw new BillingProviderError(`bKash token: ${String(r.statusMessage ?? r.msg ?? "failed")}`);
  return String(r.id_token);
}

registerBillingProvider({
  id: "bkash",
  labelBn: "বিকাশ",
  labelEn: "bKash",
  kind: "redirect",
  configured: () => Object.values(bkashEnv()).every(Boolean),
  async checkout(i) {
    const token = await bkashToken();
    const r = await bkashCall("/tokenized/checkout/create", {
      mode: "0011", payerReference: i.customer.mobile ?? i.transactionId, callbackURL: `${i.baseUrl}/api/billing/callback/bkash`,
      amount: i.amount.toFixed(2), currency: "BDT", intent: "sale", merchantInvoiceNumber: i.transactionId,
    }, token);
    if (r.statusCode !== "0000" || !r.bkashURL) throw new BillingProviderError(`bKash create: ${String(r.statusMessage ?? "failed")}`);
    return { redirectUrl: String(r.bkashURL), providerPaymentId: String(r.paymentID) };
  },
  async verify(p) {
    const paymentID = p.paymentID ?? "";
    if (!paymentID) throw new BillingProviderError("paymentID missing");
    if (p.status !== "success") return { transactionId: null, providerPaymentId: paymentID, outcome: p.status === "cancel" ? "CANCELLED" : "FAILED", reason: `bKash: ${p.status}`, raw: { status: p.status } };
    // the browser's "success" is only a hint: execute (or query) with bKash decides
    const token = await bkashToken();
    let r = await bkashCall("/tokenized/checkout/execute", { paymentID }, token).catch(() => ({}) as Record<string, unknown>);
    if (r.transactionStatus !== "Completed") r = await bkashCall("/tokenized/checkout/payment/status", { paymentID }, token);
    const ok = r.transactionStatus === "Completed";
    return {
      transactionId: typeof r.merchantInvoiceNumber === "string" ? r.merchantInvoiceNumber : null, providerPaymentId: paymentID,
      outcome: ok ? "SUCCESS" : r.transactionStatus === "Initiated" ? "PENDING" : "FAILED", providerTrxId: ok ? String(r.trxID) : null, amount: Number(r.amount),
      reason: ok ? undefined : String(r.statusMessage ?? r.transactionStatus ?? "not completed"),
      raw: { transactionStatus: r.transactionStatus, trxID: r.trxID, amount: r.amount, statusCode: r.statusCode, statusMessage: r.statusMessage },
    };
  },
});

// ───────────────────────── not yet available ─────────────────────────

for (const [id, labelBn, labelEn] of [["nagad", "নগদ", "Nagad"], ["card", "কার্ড (ভিসা/মাস্টারকার্ড — SSLCommerz)", "Card (SSLCommerz)"]] as const) {
  registerBillingProvider({ id, labelBn, labelEn, kind: "redirect", configured: () => false });
}
