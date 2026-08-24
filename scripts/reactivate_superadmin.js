const readline = require('readline');
const pool = require('../config/db');
const SuperAdminRepository = require('../repositories/superadmin_repository');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise(resolve => rl.question(query, resolve));

async function main() {
  console.log('\n==================================================');
  console.log('    RESTAURANT POS - REACTIVATE SUPER ADMIN CLI   ');
  console.log('==================================================\n');

  try {
    let email = await question('Enter Super Admin Email to Reactivate: ');
    while (!email || !email.trim()) {
      console.log('❌ Email cannot be empty.');
      email = await question('Enter Super Admin Email to Reactivate: ');
    }
    email = email.trim().toLowerCase();

    // 1. Find Super Admin user
    const [rows] = await pool.query(
      'SELECT id, name, email, role, is_active FROM users WHERE (email = ? OR username = ?) AND role IN ("super_admin", "superadmin")',
      [email, email]
    );

    if (rows.length === 0) {
      console.log(`\n❌ Error: No Super Admin account found with email "${email}".`);
      process.exit(1);
    }

    const user = rows[0];

    if (user.is_active === 1) {
      console.log(`\n🟢 Note: Super Admin "${user.name}" (${user.email}) is ALREADY active.`);
      process.exit(0);
    }

    // 2. Reactivate account
    await pool.query('UPDATE users SET is_active = 1 WHERE id = ?', [user.id]);

    // 3. Log action for auditing
    try {
      await SuperAdminRepository.addAuditLog(
        null,
        user.id,
        'SUPER_ADMIN_CLI_REACTIVATE',
        `Reactivated Super Admin account "${user.name}" (${user.email}) via Server CLI`,
        '127.0.0.1'
      );
    } catch (auditErr) {
      console.log('Audit log note:', auditErr.message);
    }

    console.log('\n==================================================');
    console.log('     🟢 SUPER ADMIN REACTIVATED SUCCESSFULLY!    ');
    console.log('==================================================');
    console.log(` ID:     ${user.id}`);
    console.log(` Name:   ${user.name}`);
    console.log(` Email:  ${user.email}`);
    console.log(` Status: ACTIVE (1)`);
    console.log('==================================================\n');

  } catch (err) {
    console.error('\n❌ Failed to reactivate Super Admin:', err.message);
  } finally {
    rl.close();
    process.exit(0);
  }
}

main();
