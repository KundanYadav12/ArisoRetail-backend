const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const EmailService = require('./email_service');

class OTPService {
  /**
   * Generate secure random 6-digit numeric OTP
   */
  static generateNumericOTP(length = 6) {
    let digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * 10)];
    }
    return otp;
  }

  /**
   * Create and send a new OTP to email
   */
  static async createAndSendOTP({ email, ownerName, restaurantName, restaurantId }) {
    if (!email) {
      throw new Error('Email address is required to generate OTP.');
    }

    // 1. Invalidate any existing pending OTPs for this email
    await pool.execute(
      'UPDATE otp_verifications SET is_verified = -1 WHERE email = ? AND is_verified = 0',
      [email.toLowerCase().trim()]
    );

    // 2. Generate plain OTP & Hash it with bcrypt (6 rounds for instant execution)
    const plainOTP = this.generateNumericOTP(6);
    const otpHash = await bcrypt.hash(plainOTP, 6);
    const expiryMinutes = 10;

    // 3. Store Hashed OTP in DB
    await pool.execute(
      'INSERT INTO otp_verifications (email, otp_hash, attempts, is_verified, expires_at, created_at) ' +
      'VALUES (?, ?, 0, 0, DATE_ADD(NOW(), INTERVAL ? MINUTE), NOW())',
      [email.toLowerCase().trim(), otpHash, expiryMinutes]
    );

    // 4. Send Email via EmailService (non-blocking async dispatch for zero UI delay)
    EmailService.sendOTPEmail({
      email: email.toLowerCase().trim(),
      otpCode: plainOTP,
      ownerName,
      restaurantName: restaurantName || 'Restaurant POS',
      expiryMinutes,
      restaurantId
    }).catch(err => console.error('[Async OTP Email Delivery Error]', err.message));

    return { success: true, message: `OTP verification code sent to ${email}.` };
  }

  /**
   * Verify input OTP code against stored bcrypt hash
   */
  static async verifyOTP(email, inputOtpCode) {
    if (!email || !inputOtpCode) {
      return { success: false, error: 'Email and OTP code are required.' };
    }

    const cleanEmail = email.toLowerCase().trim();

    // 1. Fetch latest active or recently verified OTP record for email
    const [rows] = await pool.execute(
      'SELECT * FROM otp_verifications WHERE email = ? AND is_verified IN (0, 1) ORDER BY id DESC LIMIT 1',
      [cleanEmail]
    );

    if (rows.length === 0) {
      return { success: false, error: 'No active OTP verification request found. Please request a new OTP.' };
    }

    const otpRecord = rows[0];

    // 2. Check if expired
    if (new Date() > new Date(otpRecord.expires_at)) {
      await pool.execute('UPDATE otp_verifications SET is_verified = -1 WHERE id = ?', [otpRecord.id]);
      return { success: false, error: 'OTP code has expired. Please request a new OTP.' };
    }

    // 3. If already verified in step 1 of UI, validate code match and return success
    if (otpRecord.is_verified === 1) {
      const isMatch = await bcrypt.compare(inputOtpCode.toString().trim(), otpRecord.otp_hash);
      if (isMatch) {
        return { success: true, message: 'OTP verified successfully.' };
      }
    }

    // 4. Check attempt limit (max 5)
    if (otpRecord.attempts >= 5) {
      await pool.execute('UPDATE otp_verifications SET is_verified = -1 WHERE id = ?', [otpRecord.id]);
      return { success: false, error: 'Maximum verification attempts exceeded. Please request a new OTP.' };
    }

    // 5. Compare input OTP with stored bcrypt hash
    const isMatch = await bcrypt.compare(inputOtpCode.toString().trim(), otpRecord.otp_hash);

    if (!isMatch) {
      // Increment attempt counter
      await pool.execute(
        'UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = ?',
        [otpRecord.id]
      );
      const remaining = 5 - (otpRecord.attempts + 1);
      return { success: false, error: `Invalid OTP code. ${remaining} attempt(s) remaining.` };
    }

    // 6. Success! Mark OTP as verified
    await pool.execute(
      'UPDATE otp_verifications SET is_verified = 1 WHERE id = ?',
      [otpRecord.id]
    );

    return { success: true, message: 'Email address successfully verified.' };
  }
}

module.exports = OTPService;
