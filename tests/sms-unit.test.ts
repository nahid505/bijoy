import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderTemplate, smsSegments, SMS_EVENT, SMS_EVENTS, SMS_VARIABLES } from "@/lib/sms-text";
import { decryptSecret, encryptSecret, otpHash, secretHint } from "@/server/sms/secret";
import { createProvider, platformConfig, SmsProviderError } from "@/server/sms/providers";

describe("SMS length and multi-part handling", () => {
  it("plain English uses GSM-7: 160 per single SMS, 153 per part", () => {
    expect(smsSegments("a".repeat(160))).toMatchObject({ encoding: "GSM7", units: 160, parts: 1 });
    expect(smsSegments("a".repeat(161))).toMatchObject({ encoding: "GSM7", parts: 2, perPart: 153 });
    expect(smsSegments("a".repeat(306))).toMatchObject({ parts: 2 });
    expect(smsSegments("a".repeat(307))).toMatchObject({ parts: 3 });
  });

  it("GSM extension characters count twice", () => {
    expect(smsSegments("€".repeat(80)).units).toBe(160);
    expect(smsSegments("€".repeat(81)).parts).toBe(2);
    expect(smsSegments("{[]}").units).toBe(8);
  });

  it("Bangla switches to Unicode (UCS-2): 70 per single SMS, 67 per part", () => {
    const bn = "আপনার বকেয়া ৳৫০০";
    expect(smsSegments(bn)).toMatchObject({ encoding: "UCS2", units: bn.length, parts: 1 });
    expect(smsSegments("ক".repeat(70)).parts).toBe(1);
    expect(smsSegments("ক".repeat(71))).toMatchObject({ parts: 2, perPart: 67 });
    expect(smsSegments("ক".repeat(134)).parts).toBe(2);
    expect(smsSegments("ক".repeat(135)).parts).toBe(3);
    // one Bangla letter turns an otherwise English message into Unicode
    expect(smsSegments("Invoice INV-1 total 500 টাকা").encoding).toBe("UCS2");
  });

  it("emoji take two UTF-16 units", () => {
    expect(smsSegments("😀").units).toBe(2);
  });

  it("default templates render to sensible lengths", () => {
    const body = renderTemplate(SMS_EVENT.SALE_INVOICE.defaultBody, { customer_name: "রহিম", business_name: "করিম স্টোর", invoice_no: "INV-000123", total: "১,২৫০", paid: "১,০০০", due: "২৫০", date: "৪ অক্টোবর ২০২৬" });
    expect(body).toContain("INV-000123");
    expect(smsSegments(body).parts).toBeLessThanOrEqual(3);
  });
});

describe("templates", () => {
  it("replaces every documented variable and drops unknown ones", () => {
    const vars = Object.fromEntries(SMS_VARIABLES.map((v) => [v, `<${v}>`]));
    const body = SMS_VARIABLES.map((v) => `{${v}}`).join(" ") + " {unknown}";
    const out = renderTemplate(body, vars);
    for (const v of SMS_VARIABLES) expect(out).toContain(`<${v}>`);
    expect(out).not.toContain("{unknown}");
  });

  it("keeps values on one line", () => {
    expect(renderTemplate("Hi {customer_name}!", { customer_name: "A\nB" })).toBe("Hi A B!");
  });

  it("covers every requested event", () => {
    const keys = SMS_EVENTS.map((e) => e.key);
    for (const k of ["SALE_INVOICE", "PAYMENT_RECEIVED", "DUE_REMINDER", "SALES_RETURN", "INVOICE_CANCELLED", "PURCHASE", "SUPPLIER_PAYMENT", "PURCHASE_RETURN", "SUPPLIER_DUE", "REGISTRATION_OTP", "LOGIN_OTP", "PASSWORD_RESET_OTP", "NEW_LOGIN_ALERT", "LOW_STOCK", "EXPIRY_WARNING", "EXPIRED"]) {
      expect(keys).toContain(k);
    }
  });
});

describe("secret storage", () => {
  beforeAll(() => {
    process.env.AUTH_SECRET ??= "unit-test-secret-0123456789-abcdefghijkl";
  });
  it("encrypts API keys (random IV, authenticated) and shows only a hint", () => {
    const a = encryptSecret("my-api-key-123456");
    const b = encryptSecret("my-api-key-123456");
    expect(a).not.toContain("my-api-key");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("my-api-key-123456");
    expect(secretHint("my-api-key-123456")).toBe("••••3456");
    const tampered = a.slice(0, -2) + (a.endsWith("A") ? "BB" : "AA");
    expect(decryptSecret(tampered)).toBeNull();
    expect(decryptSecret("garbage")).toBeNull();
  });
  it("hashes one-time codes with a key (not reversible, bound to purpose and number)", () => {
    const h = otpHash("LOGIN", "01712345678", "123456");
    expect(h).not.toContain("123456");
    expect(h).toBe(otpHash("LOGIN", "01712345678", "123456"));
    expect(h).not.toBe(otpHash("PASSWORD_RESET", "01712345678", "123456"));
    expect(h).not.toBe(otpHash("LOGIN", "01812345678", "123456"));
  });
});

describe("provider adapters", () => {
  let server: Server;
  let mode = "ok";
  const seen: URL[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://x");
      seen.push(u);
      if (mode === "down") return void res.writeHead(503).end("busy");
      if (mode === "slow") return; // never answers → timeout
      res.writeHead(200, { "content-type": "application/json" });
      if (u.pathname === "/api/getBalanceApi") return void res.end(JSON.stringify({ response_code: 202, balance: 1234.5 }));
      if (mode === "badnumber") return void res.end(JSON.stringify({ response_code: 1001, error_message: "Invalid Number" }));
      if (mode === "internal") return void res.end(JSON.stringify({ response_code: 1005, error_message: "Internal Error" }));
      res.end(JSON.stringify({ response_code: 202, success_message: "SMS Submitted Successfully", message_id: "abc-1" }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    process.env.SMS_BULKSMSBD_URL = `http://127.0.0.1:${port}`;
  });
  afterAll(() => {
    server.close();
    delete process.env.SMS_BULKSMSBD_URL;
  });
  const p = () => createProvider({ provider: "bulksmsbd", apiKey: "k-123", senderId: "BIJOY" });

  it("sends Bangla as unicode with the international number and sender ID", async () => {
    mode = "ok";
    const r = await p().send({ to: "01712345678", text: "বকেয়া ৳৫০০", encoding: "UCS2", senderId: "BIJOY" });
    expect(r).toEqual({ requestId: "abc-1", status: "SENT" });
    const u = seen.at(-1)!;
    expect(u.searchParams.get("number")).toBe("8801712345678");
    expect(u.searchParams.get("type")).toBe("unicode");
    expect(u.searchParams.get("message")).toBe("বকেয়া ৳৫০০");
    expect(u.searchParams.get("senderid")).toBe("BIJOY");
  });

  it("reads the balance", async () => {
    mode = "ok";
    expect(await p().balance!()).toBe(1234.5);
  });

  it("classifies failures: invalid number = permanent; internal error, HTTP 5xx and network = temporary", async () => {
    mode = "badnumber";
    await expect(p().send({ to: "01712345678", text: "x", encoding: "GSM7" })).rejects.toMatchObject({ temporary: false, code: "1001" });
    mode = "internal";
    await expect(p().send({ to: "01712345678", text: "x", encoding: "GSM7" })).rejects.toMatchObject({ temporary: true });
    mode = "down";
    await expect(p().send({ to: "01712345678", text: "x", encoding: "GSM7" })).rejects.toMatchObject({ temporary: true, code: "503" });
    process.env.SMS_HTTP_URL = "http://127.0.0.1:1/send"; // nothing listens on port 1
    const dead = createProvider({ provider: "http", apiKey: "k", senderId: null });
    await expect(dead.send({ to: "01712345678", text: "x", encoding: "GSM7" })).rejects.toMatchObject({ temporary: true, code: "NETWORK" });
    delete process.env.SMS_HTTP_URL;
  });

  it("refuses to run without credentials, and the platform config needs SMS_PROVIDER", () => {
    expect(() => createProvider({ provider: "bulksmsbd", apiKey: null, senderId: null })).toThrow(SmsProviderError);
    expect(platformConfig({})).toBeNull();
    expect(platformConfig({ SMS_PROVIDER: "bulksmsbd" })).toBeNull(); // no key
    expect(platformConfig({ SMS_PROVIDER: "bulksmsbd", SMS_API_KEY: "k", SMS_SENDER_ID: "S" })).toEqual({ provider: "bulksmsbd", apiKey: "k", senderId: "S" });
    expect(platformConfig({ SMS_PROVIDER: "mock" })?.provider).toBe("mock");
  });
});
