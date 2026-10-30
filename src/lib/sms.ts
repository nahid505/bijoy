// Generic Bangladeshi SMS gateway service (Greenweb, BulkSMSBD, Generic HTTP, Mock)
import { normalizeBdMobile } from "./mobile";

export interface SendSmsOptions {
  to: string; // 01XXXXXXXXX or +8801XXXXXXXXX
  message: string;
}

export interface SendSmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send an SMS through configured Bangladeshi SMS gateways.
 * Supports Greenweb, BulkSMSBD, and generic HTTP gateways.
 * Falls back to mock logger when credentials are not configured.
 */
export async function sendSms({ to, message }: SendSmsOptions): Promise<SendSmsResult> {
  const mobile = normalizeBdMobile(to);
  if (!mobile) {
    return { success: false, error: "সঠিক বাংলাদেশি মোবাইল নম্বর দিন (১১ ডিজিট)" };
  }

  const apiKey = process.env.SMS_API_KEY || process.env.GREENWEB_API_KEY || process.env.BULKSMSBD_API_KEY;
  const senderId = process.env.SMS_SENDER_ID || process.env.SMS_SENDER;
  const provider = (process.env.SMS_PROVIDER || "bulksmsbd").toLowerCase();
  const gatewayUrl = process.env.SMS_URL;

  // Mock fallback for local dev / testing if no API key is provided
  if (!apiKey) {
    console.log(`[SMS Gateway (Mock)] To: ${mobile} | Message: ${message}`);
    return { success: true, messageId: `mock-${Date.now()}` };
  }

  try {
    if (provider === "greenweb") {
      // Greenweb SMS API: https://api.greenweb.com.bd/api.php
      const form = new URLSearchParams({
        token: apiKey,
        to: mobile,
        message,
      });
      const res = await fetch("https://api.greenweb.com.bd/api.php", {
        method: "POST",
        body: form,
      });
      const text = await res.text();
      if (!res.ok || text.toLowerCase().includes("error")) {
        console.error("[SMS Gateway] Greenweb Error:", text);
        return { success: false, error: text };
      }
      return { success: true, messageId: text.trim() };
    }

    if (provider === "bulksmsbd") {
      // BulkSMSBD API: https://bulksmsbd.net/api/smsapi
      const form = new URLSearchParams({
        api_key: apiKey,
        type: "text",
        number: mobile,
        senderid: senderId || "",
        message,
      });
      const res = await fetch("https://bulksmsbd.net/api/smsapi", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (data && (data.response_code === 202 || data.success)) {
        return { success: true, messageId: String(data.message_id || data.msg_id || "sent") };
      }
      return { success: false, error: data?.error_message || "BulkSMSBD sending failed" };
    }

    if (gatewayUrl) {
      // Generic HTTP gateway endpoint
      const form = new URLSearchParams({
        api_key: apiKey,
        sender_id: senderId || "",
        to: `88${mobile}`,
        message,
      });
      const res = await fetch(gatewayUrl, {
        method: "POST",
        body: form,
      });
      const body = await res.text();
      return { success: res.ok, messageId: body.slice(0, 50) };
    }

    // Default mock fallback
    console.log(`[SMS Gateway] Default sender to ${mobile}: ${message}`);
    return { success: true, messageId: `sms-${Date.now()}` };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "SMS sending failed";
    console.error("[SMS Gateway Exception]:", errorMsg);
    return { success: false, error: errorMsg };
  }
}
