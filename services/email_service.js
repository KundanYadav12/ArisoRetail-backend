const nodemailer = require('nodemailer');
const pool = require('../config/db');
require('dotenv').config();

// Singleton pooled SMTP Transporter for ultra-fast instant email dispatch
let cachedTransporter = null;

const getTransporter = () => {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.EMAIL_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.EMAIL_PORT || '587');
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    return null; // Return null if SMTP environment variables are missing
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    pool: true, // Reuse SMTP connection pool
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000,
    family: 4, // Force IPv4 to prevent IPv6 DNS lookup delays
    auth: { user, pass },
    tls: { rejectUnauthorized: false }
  });

  return cachedTransporter;
};

class EmailService {
  /**
   * Log outgoing email to email_logs database table
   */
  static async logEmail(restaurantId, toEmail, subject, status, errorMessage = null) {
    try {
      await pool.execute(
        'INSERT INTO email_logs (restaurant_id, to_email, subject, status, error_message, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [restaurantId || null, toEmail, subject, status, errorMessage || null]
      );
    } catch (err) {
      console.error('[Email Log Error]', err.message);
    }
  }

  /**
   * Send Email with HTML Payload
   */
  static async sendMail({ to, subject, html, restaurantId }) {
    const transporter = getTransporter();
    const fromAddress = process.env.EMAIL_FROM || '"Restaurant POS SaaS" <no-reply@saas-pos.com>';

    if (!transporter) {
      // Mock Console Fallback Mode
      console.log(`==================================================`);
      console.log(`[SMTP MOCK EMAIL SENDER]`);
      console.log(`To: ${to}`);
      console.log(`Subject: ${subject}`);
      console.log(`Body:\n${html.replace(/<[^>]*>?/gm, '')}`);
      console.log(`==================================================`);
      
      await this.logEmail(restaurantId, to, subject, 'SENT', 'Mock Mode (SMTP credentials not set in .env)');
      return { success: true, mode: 'mock' };
    }

    try {
      console.log(`[SMTP Mail Dispatching] Sending email to: "${to}" | Subject: "${subject}"...`);
      const info = await transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        html
      });
      console.log(`[SMTP Mail Success] Message ID: ${info.messageId} successfully delivered to "${to}".`);
      await this.logEmail(restaurantId, to, subject, 'SENT');
      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.error(`❌ [SMTP Mail Delivery Error] Failed sending to "${to}":`, err.message);
      await this.logEmail(restaurantId, to, subject, 'FAILED', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Send Account Verification OTP Email
   */
  static async sendOTPEmail({ email, otpCode, ownerName, restaurantName, expiryMinutes = 10, restaurantId }) {
    const subject = `🔐 OTP Verification Code for ${restaurantName} POS Account`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; borderRadius: 8px;">
        <h2 style="color: #f97316; margin-top: 0;">Welcome to Restaurant POS SaaS</h2>
        <p>Hello <b>${ownerName || 'Restaurant Owner'}</b>,</p>
        <p>Your tenant account for <b>${restaurantName}</b> has been provisioned by Super Admin. Please complete your email verification to set up your account password.</p>
        
        <div style="background-color: #fff7ed; border: 1px solid #ffedd5; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; font-size: 14px; color: #9a3412;">Your One-Time Password (OTP) Code:</p>
          <h1 style="font-size: 36px; font-weight: bold; letter-spacing: 6px; color: #c2410c; margin: 10px 0;">${otpCode}</h1>
          <p style="margin: 0; font-size: 12px; color: #9a3412;">Code expires in <b>${expiryMinutes} minutes</b>.</p>
        </div>

        <p style="font-size: 13px; color: #64748b;">Security Note: Never share this OTP code with anyone. Platform administrators will never ask for your verification code.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #94a3b8; text-align: center;">Restaurant SaaS POS System &copy; 2026. All rights reserved.</p>
      </div>
    `;

    return this.sendMail({ to: email, subject, html, restaurantId });
  }

  /**
   * Send Subscription Expiry / Warning Email
   */
  static async sendSubscriptionNotification({ email, ownerName, restaurantName, status, expiresAt, restaurantId }) {
    const subject = `⚠️ Subscription Status Update for ${restaurantName}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #ef4444;">Subscription Notice: ${status.toUpperCase()}</h2>
        <p>Dear <b>${ownerName}</b>,</p>
        <p>The subscription status for <b>${restaurantName}</b> is now marked as <b>${status.toUpperCase()}</b>.</p>
        <p>Expiration Date: <b>${expiresAt ? new Date(expiresAt).toLocaleDateString() : 'N/A'}</b></p>
        <p>If your account is expired or suspended, terminal logins and order processing APIs are temporarily locked. Please contact platform support or Super Admin to renew your subscription.</p>
      </div>
    `;

    return this.sendMail({ to: email, subject, html, restaurantId });
  }
}

module.exports = EmailService;
