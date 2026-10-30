// Email sending helper using nodemailer with cPanel / SMTP credentials
import nodemailer from "nodemailer";

export interface SendOtpEmailOptions {
  to: string;
  otp: string;
  userName?: string;
}

export interface SendMailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Sends a beautifully formatted 6-digit OTP verification email via SMTP (cPanel / standard SMTP).
 * If SMTP credentials are not configured, logs to console (mock) for seamless development.
 */
export async function sendOtpEmail({ to, otp, userName }: SendOtpEmailOptions): Promise<SendMailResult> {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  const from = process.env.SMTP_FROM || `"বিজয় লেনদেন" <${user || "noreply@bijoylenden.com"}>`;

  // Fallback to mock log if SMTP credentials are not configured
  if (!host || !user || !pass) {
    console.log(`[Mail (Mock)] To: ${to} | OTP Code: ${otp}`);
    return { success: true, messageId: `mock-email-${Date.now()}` };
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
    });

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="bn">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>পাসওয়ার্ড রিসেট ভেরিফিকেশন কোড</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px;">
        <div style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <div style="background-color: #0f172a; padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700;">বিজয় লেনদেন</h1>
            <p style="color: #94a3b8; margin: 4px 0 0; font-size: 13px;">ব্যবসায়িক হিসাব ও লেনদেন ব্যবস্থাপনা</p>
          </div>
          
          <!-- Body Content -->
          <div style="padding: 32px 24px; color: #1e293b;">
            <h2 style="font-size: 18px; margin-top: 0; color: #0f172a;">পাসওয়ার্ড রিসেট ওটিপি (OTP)</h2>
            <p style="font-size: 14px; line-height: 1.6; color: #475569;">
              ${userName ? `প্রিয় <strong>${userName}</strong>,` : "প্রিয় গ্রাহক,"}<br>
              আপনার বিজয় লেনদেন অ্যাকাউন্টের পাসওয়ার্ড রিসেট করার জন্য অনুরোধ করা হয়েছে। আপনার ৬-সংখ্যার ওটিপি কোডটি নিচে দেওয়া হলো:
            </p>
            
            <!-- OTP Box -->
            <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0;">
              <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #047857; font-family: monospace;">${otp}</span>
            </div>
            
            <p style="font-size: 13px; color: #64748b; margin-bottom: 0;">
              ⏱️ এই ওটিপি কোডটির মেয়াদ <strong>৫ মিনিট</strong>।<br>
              ⚠️ এই কোডটি কাউকে জানাবেন না। আপনি যদি এই পাসওয়ার্ড রিসেটের অনুরোধ না করে থাকেন, তবে অনুগ্রহ করে এই ইমেইলটি উপেক্ষা করুন।
            </p>
          </div>
          
          <!-- Footer -->
          <div style="background-color: #f1f5f9; padding: 16px 24px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
            © ${new Date().getFullYear()} বিজয় লেনদেন। সর্বস্বত্ব সংরক্ষিত।
          </div>
        </div>
      </body>
      </html>
    `;

    const info = await transporter.sendMail({
      from,
      to,
      subject: "বিজয় লেনদেন - পাসওয়ার্ড রিসেট ওটিপি কোড",
      text: `আপনার বিজয় লেনদেন পাসওয়ার্ড রিসেট ওটিপি কোড হলো: ${otp}। মেয়াদ ৫ মিনিট। কোডটি কাউকে জানাবেন না।`,
      html: htmlContent,
    });

    return { success: true, messageId: info.messageId };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "ইমেইল পাঠানো সম্ভব হয়নি";
    console.error("[Nodemailer Exception]:", errorMsg);
    return { success: false, error: errorMsg };
  }
}
