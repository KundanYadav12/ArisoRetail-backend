const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const SuperAdminRepository = require('../repositories/superadmin_repository');
const {
  getEnvironmentInfo,
  printBanner,
  validateEmail,
  validatePassword,
  createPrompt
} = require('./helpers/cli_helper');

async function main() {
  const prompt = createPrompt(process.stdin, process.stdout);
  const { isProduction, env, dbName, dbHost } = getEnvironmentInfo();

  printBanner('Reset Superadmin Password');

  try {
    // 1. Email Address Prompt
    let rawEmail = await prompt.ask('1. Enter Superadmin Email to Reset: ');
    let emailValidation = validateEmail(rawEmail);
    while (!emailValidation.valid) {
      console.log(`   ❌ ${emailValidation.error}`);
      rawEmail = await prompt.ask('1. Enter Superadmin Email to Reset: ');
      emailValidation = validateEmail(rawEmail);
    }
    const email = emailValidation.email;

    // 2. Query Account and Verify Superadmin Role
    const [rows] = await pool.query(
      'SELECT id, name, username, email, role, is_active FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?',
      [email, email]
    );

    if (rows.length === 0) {
      console.log('\n❌ [Account Not Found]');
      console.log(`   No user account exists with email/username "${email}" in ${dbName}.`);
      console.log('   Cannot reset password for a nonexistent account.\n');
      prompt.close();
      process.exit(1);
    }

    const user = rows[0];
    const userRole = (user.role || '').toLowerCase();
    const isSuperAdmin = userRole === 'super_admin' || userRole === 'superadmin';

    if (!isSuperAdmin) {
      console.log('\n❌ [Unauthorized Account Type]');
      console.log(`   Account "${user.email || user.username}" exists, but its role is "${user.role}".`);
      console.log('   This CLI command is strictly reserved for Superadmin accounts only.\n');
      prompt.close();
      process.exit(1);
    }

    // 3. User Confirmation Prompt
    console.log(`\n   Target Superadmin: ${user.name} (${user.email}) [ID: ${user.id}]`);
    if (isProduction) {
      console.log('   ⚠️  ATTENTION: You are operating against a PRODUCTION environment.');
      const confirmed = await prompt.askConfirmation(
        '   Type "RESET" to confirm password reset for this Superadmin: ',
        'RESET'
      );
      if (!confirmed) {
        console.log('\n🚫 Password reset cancelled by user. No changes were made.\n');
        prompt.close();
        process.exit(0);
      }
    } else {
      const confirmed = await prompt.askConfirmation(
        `   Are you sure you want to reset password for "${user.email}"? (y/N): `
      );
      if (!confirmed) {
        console.log('\n🚫 Password reset cancelled by user. No changes were made.\n');
        prompt.close();
        process.exit(0);
      }
    }

    // 4. New Password (hidden prompt)
    console.log('');
    let newPassword = await prompt.askHidden('2. Enter New Password (hidden): ');
    let passwordValidation = validatePassword(newPassword);
    while (!passwordValidation.valid) {
      console.log('   ❌ Password does not satisfy strong password policy:');
      passwordValidation.errors.forEach(err => console.log(`      • ${err}`));
      newPassword = await prompt.askHidden('2. Enter New Password (hidden): ');
      passwordValidation = validatePassword(newPassword);
    }

    // 5. Confirm New Password (hidden prompt)
    let confirmPassword = await prompt.askHidden('3. Confirm New Password (hidden): ');
    if (newPassword !== confirmPassword) {
      console.log('\n❌ [Password Mismatch]');
      console.log('   The entered passwords do not match. Aborting.\n');
      prompt.close();
      process.exit(1);
    }

    // 6. Secure Password Hashing (bcrypt, 10 rounds)
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // 7. Update Password in Database and Invalidate Active Sessions
    await pool.query(
      `UPDATE users
       SET password_hash = ?, active_session_id = NULL, updated_at = NOW()
       WHERE id = ?`,
      [passwordHash, user.id]
    );

    // 8. Audit Logging
    try {
      await SuperAdminRepository.addAuditLog(
        null,
        user.id,
        'SUPER_ADMIN_CLI_RESET_PASSWORD',
        `Reset password for Superadmin account "${user.name}" (${user.email}) via CLI; active sessions revoked`,
        '127.0.0.1'
      );
    } catch (auditErr) {
      // Audit log failures should not block successful update
    }

    // 9. Display Safe Success Summary
    console.log('\n================================================================================');
    console.log('              🔑 SUPERADMIN PASSWORD RESET SUCCESSFULLY!                        ');
    console.log('================================================================================');
    console.log(` ID:              ${user.id}`);
    console.log(` Name:            ${user.name}`);
    console.log(` Email:           ${user.email}`);
    console.log(` Role:            ${user.role}`);
    console.log(` Sessions:        Revoked / Invalidated (Active session ID cleared)`);
    console.log(` Database:        ${dbName} @ ${dbHost}`);
    console.log(` Environment:     ${env.toUpperCase()}`);
    console.log('--------------------------------------------------------------------------------');
    console.log(' 🔒 SECURITY NOTE: The new password has been securely hashed using bcrypt.');
    console.log('    Existing sessions/refresh tokens have been revoked.');
    console.log('    Plaintext passwords are never logged, printed, or stored.');
    console.log('================================================================================\n');

    prompt.close();
    process.exit(0);

  } catch (err) {
    console.error('\n❌ Fatal error resetting Superadmin password:', err.message);
    prompt.close();
    process.exit(1);
  }
}

main();
