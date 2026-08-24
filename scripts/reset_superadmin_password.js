const readline = require('readline');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const SuperAdminRepository = require('../repositories/superadmin_repository');

function generateSecurePassword(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let password = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return password;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise(resolve => rl.question(query, resolve));

async function main() {
  console.log('\n==================================================');
  console.log(' RESTAURANT POS - RESET SUPER ADMIN PASSWORD CLI  ');
  console.log('==================================================\n');

  try {
    let email = await question('Enter Super Admin Email to Reset Password: ');
    while (!email || !email.trim()) {
      console.log('❌ Email cannot be empty.');
      email = await question('Enter Super Admin Email to Reset Password: ');
    }
    email = email.trim().toLowerCase();

    // 1. Find Super Admin user
    const [rows] = await pool.query(
      'SELECT id, name, email, role FROM users WHERE (email = ? OR username = ?) AND role IN ("super_admin", "superadmin")',
      [email, email]
    );

    if (rows.length === 0) {
      console.log(`\n❌ Error: No Super Admin account found with email "${email}".`);
      process.exit(1);
    }

    const user = rows[0];

    // 2. Generate new secure random 8-character password
    const newRawPassword = generateSecurePassword(8);

    // 3. Hash password with bcrypt
    const passwordHash = await bcrypt.hash(newRawPassword, 10);

    // 4. Update password in database
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, user.id]);

    // 5. Log action for auditing
    try {
      await SuperAdminRepository.addAuditLog(
        null,
        user.id,
        'SUPER_ADMIN_CLI_RESET_PASSWORD',
        `Reset password for Super Admin account "${user.name}" (${user.email}) via Server CLI`,
        '127.0.0.1'
      );
    } catch (auditErr) {
      console.log('Audit log note:', auditErr.message);
    }

    console.log('\n==================================================');
    console.log('  🔑 SUPER ADMIN PASSWORD RESET SUCCESSFULLY!     ');
    console.log('==================================================');
    console.log(` ID:       ${user.id}`);
    console.log(` Name:     ${user.name}`);
    console.log(` Email:    ${user.email}`);
    console.log('--------------------------------------------------');
    console.log(` NEW PASSWORD: ${newRawPassword}`);
    console.log('--------------------------------------------------');
    console.log(' ⚠️ IMPORTANT: Store this password securely!');
    console.log('    Only its bcrypt hash is saved in the MySQL database.');
    console.log('==================================================\n');

  } catch (err) {
    console.error('\n❌ Failed to reset Super Admin password:', err.message);
  } finally {
    rl.close();
    process.exit(0);
  }
}

main();
