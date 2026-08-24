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
  console.log('     RESTAURANT POS - CREATE SUPER ADMIN CLI      ');
  console.log('==================================================\n');

  try {
    let name = await question('1. Enter Super Admin Name: ');
    while (!name || !name.trim()) {
      console.log('❌ Name cannot be empty.');
      name = await question('1. Enter Super Admin Name: ');
    }
    name = name.trim();

    let email = await question('2. Enter Super Admin Email: ');
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    while (!email || !emailRegex.test(email.trim())) {
      console.log('❌ Please enter a valid email address.');
      email = await question('2. Enter Super Admin Email: ');
    }
    email = email.trim().toLowerCase();

    // Check if user already exists with email or username
    const [existing] = await pool.query(
      'SELECT id, username, email FROM users WHERE email = ? OR username = ?',
      [email, email]
    );

    if (existing.length > 0) {
      console.log(`\n❌ Error: User with email/username "${email}" already exists in the database.`);
      process.exit(1);
    }

    // 3. Generate secure random 8-character password
    const rawPassword = generateSecurePassword(8);

    // 4. Hash password with bcrypt
    const passwordHash = await bcrypt.hash(rawPassword, 10);

    // 5. Insert Super Admin into database
    const [result] = await pool.query(
      `INSERT INTO users (restaurant_id, name, username, email, password_hash, role, is_active, must_change_password, is_verified)
       VALUES (NULL, ?, ?, ?, ?, 'super_admin', 1, 0, 1)`,
      [name, email, email, passwordHash]
    );

    const newSuperAdminId = result.insertId;

    // 7. Log creation event for auditing
    try {
      await SuperAdminRepository.addAuditLog(
        null,
        newSuperAdminId,
        'SUPER_ADMIN_CLI_CREATE',
        `Created Super Admin account "${name}" (${email}) via Server CLI`,
        '127.0.0.1'
      );
    } catch (auditErr) {
      console.log('Audit log note:', auditErr.message);
    }

    // 6. Display generated password ONCE in terminal
    console.log('\n==================================================');
    console.log('     🎉 SUPER ADMIN CREATED SUCCESSFULLY!         ');
    console.log('==================================================');
    console.log(` ID:       ${newSuperAdminId}`);
    console.log(` Name:     ${name}`);
    console.log(` Username: ${email}`);
    console.log(` Email:    ${email}`);
    console.log(` Status:   ACTIVE`);
    console.log(` Role:     super_admin`);
    console.log('--------------------------------------------------');
    console.log(` GENERATED PASSWORD: ${rawPassword}`);
    console.log('--------------------------------------------------');
    console.log(' ⚠️ IMPORTANT: Store this password securely!');
    console.log('    Only its bcrypt hash is saved in the MySQL database.');
    console.log('==================================================\n');

  } catch (err) {
    console.error('\n❌ Failed to create Super Admin:', err.message);
  } finally {
    rl.close();
    process.exit(0);
  }
}

main();
