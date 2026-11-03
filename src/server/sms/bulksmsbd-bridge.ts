// BulkSMSBD Automation Bridge — Auto-login, API Key retrieval, balance verification, and registration helpers.

import https from "node:https";
import { encryptSecret, secretHint } from "./secret";

const BULKSMSBD_BASE_URL = (process.env.SMS_BULKSMSBD_URL || "https://bulksmsbd.net").replace(/\/$/, "");
const BULKSMSBD_REGISTRATION_URL = "https://bulksmsbd.net/v2/register/rindex#/register";
const BULKSMSBD_LOGIN_URL = `${BULKSMSBD_BASE_URL}/login`;
const BULKSMSBD_LOGIN_SUBMIT_URL = `${BULKSMSBD_BASE_URL}/login/submit`;
const BULKSMSBD_RECHARGE_URL = `${BULKSMSBD_BASE_URL}/login`;

// HTTPS Agent with leaf cert tolerance for bulksmsbd.net
const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV === "production" && !process.env.ALLOW_INSECURE_SMS_GATEWAY ? true : false,
});

/**
 * Safe fetch function that handles TLS leaf certificate verification issues on Windows / custom environments.
 */
async function safeFetch(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    // Attempt standard fetch first
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
    });
  } catch (err: any) {
    // If certificate verification failed, fallback with node https request or tolerant fetch
    if (
      err.cause?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
      err.cause?.code === "CERT_HAS_EXPIRED" ||
      err.message?.includes("unable to verify the first certificate")
    ) {
      return new Promise<Response>((resolve, reject) => {
        const parsedUrl = new URL(url);
        const req = https.request(
          {
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 443,
            path: `${parsedUrl.pathname}${parsedUrl.search}`,
            method: init.method || "GET",
            headers: (init.headers as Record<string, string>) || {},
            rejectUnauthorized: false,
            timeout: timeoutMs,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
              const bodyBuffer = Buffer.concat(chunks);
              const headers = new Headers();
              for (const [k, v] of Object.entries(res.headers)) {
                if (Array.isArray(v)) {
                  for (const item of v) headers.append(k, item);
                } else if (v) {
                  headers.set(k, v);
                }
              }

              const response = new Response(bodyBuffer, {
                status: res.statusCode || 200,
                statusText: res.statusMessage || "OK",
                headers,
              });
              resolve(response);
            });
          }
        );

        req.on("error", (e) => reject(e));
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("Request timed out"));
        });

        if (init.body) {
          req.write(init.body);
        }
        req.end();
      });
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

export interface VerifyApiKeyResult {
  ok: boolean;
  balance?: number;
  message: string;
}

/**
 * Validates a BulkSMSBD API Key by querying getBalanceApi.
 */
export async function verifyBulkSmsBdApiKey(apiKey: string): Promise<VerifyApiKeyResult> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    return { ok: false, message: "API কী খালি রাখা যাবে না" };
  }

  try {
    const url = `${BULKSMSBD_BASE_URL}/api/getBalanceApi?${new URLSearchParams({ api_key: cleanKey })}`;
    const res = await safeFetch(url, {
      headers: { "User-Agent": "BijoyLenden/1.0" },
    });

    const text = await res.text();
    let body: any = {};
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, message: "BulkSMSBD সার্ভার থেকে অপ্রত্যাশিত প্রতিক্রিয়া এসেছে" };
    }

    const code = String(body.response_code ?? res.status);
    if (code === "202") {
      const balance = Number(body.balance ?? 0);
      return {
        ok: true,
        balance,
        message: `API কী সফলভাবে যাচাই হয়েছে। বর্তমান ব্যালেন্স: ৳ ${balance.toFixed(2)}`,
      };
    }

    return {
      ok: false,
      message: body.error_message || `BulkSMSBD ত্রুটি (${code}): API কী সঠিক নয় বা ব্যবহারকারী খুঁজে পাওয়া যায়নি`,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: `BulkSMSBD সার্ভারের সাথে সংযোগ করা যায়নি: ${err.message || "নেটওয়ার্ক সমস্যা"}`,
    };
  }
}

export interface LoginBridgeResult {
  ok: boolean;
  apiKey?: string;
  senderId?: string;
  balance?: number;
  message: string;
}

/**
 * Performs credential login to BulkSMSBD portal and extracts API Key and Sender ID.
 */
export async function loginToBulkSmsBd(username: string, password: string): Promise<LoginBridgeResult> {
  const cleanUser = username.trim();
  const cleanPass = password.trim();

  if (!cleanUser || !cleanPass) {
    return { ok: false, message: "ইউজারনেম ও পাসওয়ার্ড উভয়ই প্রদান করুন" };
  }

  try {
    // 1. Fetch login page to retrieve CSRF token and session cookies
    const pageRes = await safeFetch(BULKSMSBD_LOGIN_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    const rawCookies = pageRes.headers.getSetCookie
      ? pageRes.headers.getSetCookie()
      : [pageRes.headers.get("set-cookie") || ""];
    const cookieHeader = rawCookies
      .filter(Boolean)
      .map((c) => c.split(";")[0])
      .join("; ");

    const html = await pageRes.text();
    const tokenMatch = html.match(/name="_token"\s+value="([^"]+)"/);
    const csrfToken = tokenMatch ? tokenMatch[1] : "";

    if (!csrfToken) {
      return {
        ok: false,
        message: "BulkSMSBD লগইন পেজ থেকে সিকিউরিটি টোকেন পাওয়া যায়নি। অনুগ্রহ করে সরাসরি API কী দিয়ে কানেক্ট করুন।",
      };
    }

    // 2. Submit login form
    const formParams = new URLSearchParams({
      _token: csrfToken,
      username: cleanUser,
      password: cleanPass,
    });

    const submitRes = await safeFetch(BULKSMSBD_LOGIN_SUBMIT_URL, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader,
        Referer: BULKSMSBD_LOGIN_URL,
      },
      body: formParams.toString(),
      redirect: "manual",
    });

    const submitCookiesRaw = submitRes.headers.getSetCookie
      ? submitRes.headers.getSetCookie()
      : [submitRes.headers.get("set-cookie") || ""];
    const authCookieHeader = [
      cookieHeader,
      ...submitCookiesRaw.filter(Boolean).map((c) => c.split(";")[0]),
    ]
      .filter(Boolean)
      .join("; ");

    const location = submitRes.headers.get("location") || "";

    // If redirected back to /login or status 401/419
    if (location.endsWith("/login") || location === BULKSMSBD_LOGIN_URL || submitRes.status === 419) {
      return {
        ok: false,
        message: "BulkSMSBD ইউজারনেম বা পাসওয়ার্ড সঠিক নয়। অনুগ্রহ করে তথ্য যাচাই করে পুনরায় চেষ্টা করুন।",
      };
    }

    // 3. Request developer / API page to discover the user's permanent API Key
    const candidateUrls = [
      `${BULKSMSBD_BASE_URL}/developer`,
      `${BULKSMSBD_BASE_URL}/client/dashboard`,
      `${BULKSMSBD_BASE_URL}/api`,
      `${BULKSMSBD_BASE_URL}/client/api`,
      location || `${BULKSMSBD_BASE_URL}/dashboard`,
    ];

    let extractedApiKey: string | null = null;
    let extractedSenderId: string | null = null;

    for (const targetUrl of candidateUrls) {
      if (!targetUrl) continue;
      try {
        const dashRes = await safeFetch(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Cookie: authCookieHeader,
            Referer: BULKSMSBD_LOGIN_URL,
          },
        });

        const dashHtml = await dashRes.text();

        // Pattern matching for BulkSMSBD API keys:
        // Commonly an alphanumeric string 32 to 64 chars, e.g. api_key or value="..."
        const keyMatch =
          dashHtml.match(/api[_-]?key["']?\s*[:=]\s*["']([A-Za-z0-9_\-]{20,80})["']/i) ||
          dashHtml.match(/id=["']api[_-]?key["'][^>]*value=["']([A-Za-z0-9_\-]{20,80})["']/i) ||
          dashHtml.match(/value=["']([A-Za-z0-9_\-]{20,80})["'][^>]*id=["']api[_-]?key["']/i);

        if (keyMatch && keyMatch[1]) {
          extractedApiKey = keyMatch[1];
        }

        // Pattern matching for approved sender ID
        const senderMatch =
          dashHtml.match(/sender[_-]?id["']?\s*[:=]\s*["']([A-Za-z0-9\s._-]{3,20})["']/i) ||
          dashHtml.match(/id=["']sender[_-]?id["'][^>]*value=["']([A-Za-z0-9\s._-]{3,20})["']/i);

        if (senderMatch && senderMatch[1]) {
          extractedSenderId = senderMatch[1].trim();
        }

        if (extractedApiKey) break;
      } catch {
        // continue trying next candidate URL
      }
    }

    // If an API key was found, verify it with getBalanceApi
    if (extractedApiKey) {
      const verifyRes = await verifyBulkSmsBdApiKey(extractedApiKey);
      if (verifyRes.ok) {
        return {
          ok: true,
          apiKey: extractedApiKey,
          senderId: extractedSenderId || undefined,
          balance: verifyRes.balance,
          message: `BulkSMSBD সফলভাবে কানেক্ট হয়েছে! ব্যালেন্স: ৳ ${(verifyRes.balance ?? 0).toFixed(2)}`,
        };
      }
    }

    // If automatic scraping couldn't find the key on HTML (e.g. CSRF/Two-factor protection)
    return {
      ok: false,
      message:
        "BulkSMSBD অ্যাকাউন্টে সফলভাবে লগইন করা গেলেও ড্যাশবোর্ড থেকে API কী রিট্রিভ করা যায়নি। অনুগ্রহ করে BulkSMSBD ড্যাশবোর্ড থেকে API কী কপি করে নিচের 'সরাসরি API কী' ট্যাবে পেস্ট করুন।",
    };
  } catch (err: any) {
    return {
      ok: false,
      message: `BulkSMSBD সার্ভারের সাথে সংযোগ ব্যর্থ হয়েছে: ${err.message || "নেটওয়ার্ক ত্রুটি"}`,
    };
  }
}

/**
 * Returns formatted registration details and BulkSMSBD official portal link.
 */
export function getBulkSmsBdRegistrationData(business: {
  name: string;
  mobile?: string | null;
  email?: string | null;
}) {
  return {
    registrationUrl: BULKSMSBD_REGISTRATION_URL,
    rechargeUrl: BULKSMSBD_RECHARGE_URL,
    prefilled: {
      name: business.name || "",
      mobile: business.mobile || "",
      email: business.email || "",
    },
  };
}
