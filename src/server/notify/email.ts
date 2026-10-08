// E-mail channel (architecture). A provider is chosen with EMAIL_PROVIDER:
//   "log"   (default) — writes the message to the server log; nothing leaves the server
//   "http"  — POSTs JSON { to, from, subject, text } to EMAIL_HTTP_URL with "Authorization: Bearer
//             EMAIL_HTTP_TOKEN" (works with most transactional e-mail APIs / a small relay)
// More providers (SMTP, SES …) register with registerEmailProvider(). Never throws.
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}
type EmailProvider = (m: EmailMessage & { from: string }) => Promise<void>;

const providers: Record<string, EmailProvider> = {
  log: async (m) => {
    console.log(`[email:log] to=${m.to} subject=${JSON.stringify(m.subject)}`);
  },
  http: async (m) => {
    const url = process.env.EMAIL_HTTP_URL;
    if (!url) throw new Error("EMAIL_HTTP_URL is not set");
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.EMAIL_HTTP_TOKEN ? { authorization: `Bearer ${process.env.EMAIL_HTTP_TOKEN}` } : {}) },
      body: JSON.stringify(m),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`e-mail relay answered ${res.status}`);
  },
};

export function registerEmailProvider(id: string, p: EmailProvider) {
  providers[id] = p;
}

export async function sendEmail(m: EmailMessage): Promise<boolean> {
  const id = process.env.EMAIL_PROVIDER || "log";
  const p = providers[id];
  if (!p) return false;
  try {
    await p({ ...m, from: process.env.EMAIL_FROM || "no-reply@bijoylenden.local" });
    return true;
  } catch (e) {
    console.error("[email] failed:", (e as Error).message);
    return false;
  }
}
