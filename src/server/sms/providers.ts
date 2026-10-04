// Provider-independent SMS gateway layer. The app only talks to the SmsProvider interface;
// each adapter maps one gateway's API onto it and classifies failures:
//   temporary → the queue retries later (network error, timeout, HTTP 5xx / 429, gateway busy)
//   permanent → never retried (invalid number, bad credentials, no balance, rejected sender ID)
import { randomUUID } from "node:crypto";
import type { SmsEncoding } from "@/lib/sms-text";

export class SmsProviderError extends Error {
  constructor(message: string, public readonly temporary: boolean, public readonly code?: string) {
    super(message);
  }
}

export interface OutgoingSms {
  to: string; // 01XXXXXXXXX
  text: string;
  encoding: SmsEncoding;
  senderId?: string | null;
}

export interface SendResult {
  requestId: string;
  /** most gateways accept now and report delivery later; some confirm delivery immediately */
  status: "SENT" | "DELIVERED";
  cost?: number | null;
}

export interface SmsProvider {
  id: string;
  send(msg: OutgoingSms): Promise<SendResult>;
  balance?(): Promise<number | null>;
  /** delivery report polling, for gateways without callbacks */
  status?(requestId: string): Promise<"SENT" | "DELIVERED" | "FAILED" | null>;
}

export interface ProviderConfig {
  provider: string;
  apiKey: string | null;
  senderId: string | null;
}

export const PROVIDER_LABELS: Record<string, string> = {
  platform: "সার্ভারের ডিফল্ট প্রোভাইডার (প্ল্যাটফর্ম)",
  bulksmsbd: "BulkSMSBD",
  http: "জেনেরিক HTTP গেটওয়ে",
  mock: "ডেমো / টেস্ট (আসল এসএমএস যায় না)",
};

const intl = (to: string) => `88${to}`; // 01XXXXXXXXX → 8801XXXXXXXXX

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<{ status: number; body: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* plain-text gateways */
    }
    if (res.status >= 500 || res.status === 429) throw new SmsProviderError(`গেটওয়ে সাময়িকভাবে অনুপলব্ধ (HTTP ${res.status})`, true, String(res.status));
    return { status: res.status, body };
  } catch (e) {
    if (e instanceof SmsProviderError) throw e;
    throw new SmsProviderError(`গেটওয়েতে সংযোগ করা যায়নি: ${(e as Error).name === "AbortError" ? "সময় শেষ" : (e as Error).message}`, true, "NETWORK");
  } finally {
    clearTimeout(t);
  }
}

/** BulkSMSBD (bulksmsbd.net) — base URL overridable with SMS_BULKSMSBD_URL. */
function bulkSmsBd(cfg: ProviderConfig): SmsProvider {
  const base = (process.env.SMS_BULKSMSBD_URL || "https://bulksmsbd.net").replace(/\/$/, "");
  const key = cfg.apiKey ?? "";
  // documented response codes: 202 accepted; 1001 invalid number; 1002 sender id; 1005 internal;
  // 1006 / 1007 balance; 1011 unknown user; 1031 account not verified; 1032 IP not whitelisted
  const TEMPORARY = new Set(["1005"]);
  return {
    id: "bulksmsbd",
    async send(m) {
      const q = new URLSearchParams({ api_key: key, type: m.encoding === "UCS2" ? "unicode" : "text", number: intl(m.to), senderid: cfg.senderId ?? "", message: m.text });
      const { status, body } = await fetchJson(`${base}/api/smsapi?${q}`);
      const b = (body ?? {}) as { response_code?: number | string; success_message?: string; error_message?: string; message_id?: string };
      const code = String(b.response_code ?? status);
      if (code === "202") return { requestId: String(b.message_id ?? randomUUID()), status: "SENT" };
      throw new SmsProviderError(`BulkSMSBD ত্রুটি ${code}: ${b.error_message ?? b.success_message ?? "অজানা"}`, TEMPORARY.has(code), code);
    },
    async balance() {
      const { body } = await fetchJson(`${base}/api/getBalanceApi?${new URLSearchParams({ api_key: key })}`);
      const b = (body ?? {}) as { response_code?: number | string; balance?: number | string; error_message?: string };
      if (String(b.response_code) !== "202") throw new SmsProviderError(`ব্যালেন্স জানা যায়নি: ${b.error_message ?? b.response_code}`, false, String(b.response_code));
      return Number(b.balance ?? 0);
    },
  };
}

/** Generic JSON gateway: POST {to, message, sender_id, unicode} with a Bearer token (SMS_HTTP_URL). */
function httpGateway(cfg: ProviderConfig): SmsProvider {
  const url = process.env.SMS_HTTP_URL ?? "";
  const headers = { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey ?? ""}` };
  return {
    id: "http",
    async send(m) {
      if (!url) throw new SmsProviderError("SMS_HTTP_URL কনফিগার করা নেই", false, "CONFIG");
      const { status, body } = await fetchJson(url, { method: "POST", headers, body: JSON.stringify({ to: intl(m.to), message: m.text, sender_id: cfg.senderId, unicode: m.encoding === "UCS2" }) });
      const b = (body ?? {}) as { id?: string; message_id?: string; status?: string; cost?: number; error?: string };
      if (status >= 200 && status < 300 && (b.id || b.message_id)) {
        return { requestId: String(b.id ?? b.message_id), status: b.status === "delivered" ? "DELIVERED" : "SENT", cost: b.cost ?? null };
      }
      throw new SmsProviderError(`গেটওয়ে প্রত্যাখ্যান করেছে (HTTP ${status}): ${b.error ?? "অজানা"}`, false, String(status));
    },
    async balance() {
      if (!url) return null;
      const { status, body } = await fetchJson(url.replace(/\/send\/?$/, "") + "/balance", { headers });
      const b = (body ?? {}) as { balance?: number };
      return status === 200 && typeof b.balance === "number" ? b.balance : null;
    },
    async status(requestId) {
      if (!url) return null;
      const { status, body } = await fetchJson(url.replace(/\/send\/?$/, "") + `/status/${encodeURIComponent(requestId)}`, { headers });
      const s = String((body as { status?: string })?.status ?? "");
      if (status !== 200) return null;
      return s === "delivered" ? "DELIVERED" : s === "failed" ? "FAILED" : "SENT";
    },
  };
}

/**
 * Demo / test gateway: nothing leaves the server. Numbers ending in 0000 fail permanently and
 * numbers ending in 9999 fail temporarily, so failure handling can be exercised end-to-end.
 */
function mockGateway(): SmsProvider {
  return {
    id: "mock",
    async send(m) {
      if (m.to.endsWith("0000")) throw new SmsProviderError("নম্বরটি সঠিক নয় (ডেমো)", false, "INVALID_NUMBER");
      if (m.to.endsWith("9999")) throw new SmsProviderError("গেটওয়ে সাময়িকভাবে ব্যস্ত (ডেমো)", true, "BUSY");
      return { requestId: `mock-${randomUUID()}`, status: "SENT", cost: m.encoding === "UCS2" ? 0.35 : 0.25 };
    },
    async balance() {
      return Number(process.env.SMS_MOCK_BALANCE ?? 500);
    },
    async status() {
      return "DELIVERED";
    },
  };
}

// Extra adapters can be registered at runtime (used by the test-suite for a programmable gateway).
const custom = new Map<string, (cfg: ProviderConfig) => SmsProvider>();
export function registerSmsProvider(id: string, factory: (cfg: ProviderConfig) => SmsProvider) {
  custom.set(id, factory);
}

/** Provider ids a business may choose: the built-in adapters plus any registered at runtime. */
export function availableProviders(): string[] {
  return [...new Set([...Object.keys(PROVIDER_LABELS), ...custom.keys()])];
}

export function createProvider(cfg: ProviderConfig): SmsProvider {
  const extra = custom.get(cfg.provider);
  if (extra) return extra(cfg);
  if (cfg.provider === "mock") return mockGateway();
  if (!cfg.apiKey) throw new SmsProviderError("এসএমএস API কী সেট করা নেই", false, "CONFIG");
  if (cfg.provider === "bulksmsbd") return bulkSmsBd(cfg);
  if (cfg.provider === "http") return httpGateway(cfg);
  throw new SmsProviderError(`অজানা এসএমএস প্রোভাইডার: ${cfg.provider}`, false, "CONFIG");
}

/** Server-wide credentials (SMS_PROVIDER / SMS_API_KEY / SMS_SENDER_ID) — used for security codes
 *  and by businesses that choose the "platform" provider. */
export function platformConfig(env: Record<string, string | undefined> = process.env): ProviderConfig | null {
  const provider = env.SMS_PROVIDER?.trim();
  if (!provider) return null;
  if (provider !== "mock" && !env.SMS_API_KEY && !custom.has(provider)) return null;
  return { provider, apiKey: env.SMS_API_KEY ?? null, senderId: env.SMS_SENDER_ID ?? null };
}
