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
  console.log('   RESTAURANT POS - DEACTIVATE SUPER ADMIN CLI    ');
  console.log('==================================================\n');

  try {
    let email = await question('Enter Super Admin Email to Deactivate: ');
    while (!email || !email.trim()) {
      console.log('❌ Email cannot be empty.');
      email = await question('Enter Super Admin Email to Deactivate: ');
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

    if (user.is_active === 0) {
      console.log(`\n⚠️ Note: Super Admin "${user.name}" (${user.email}) is ALREADY inactive.`);
      process.exit(0);
    }

    // 2. Prevent deactivation of the last active Super Admin
    const [activeCountRows] = await pool.query(
      'SELECT COUNT(*) as activeCount FROM users WHERE role IN ("super_admin", "superadmin") AND is_active = 1'
    );

    const activeCount = activeCountRows[0].activeCount;

    if (activeCount <= 1) {
      console.log('\n❌ ACTION BLOCKED (SECURITY GUARD):');
      console.log('   Cannot deactivate the last active Super Admin account.');
      console.log('   At least one Super Admin must remain active in the system.');
      process.exit(1);
    }

    // 3. Mark account as inactive
    await pool.query('UPDATE users SET is_active = 0 WHERE id = ?', [user.id]);

    // 4. Log action for auditing
    try {
      await SuperAdminRepository.addAuditLog(
        null,
        user.id,
        'SUPER_ADMIN_CLI_DEACTIVATE',
        `Deactivated Super Admin account "${user.name}" (${user.email}) via Server CLI`,
        '127.0.0.1'
      );
    } catch (auditErr) {
      console.log('Audit log note:', auditErr.message);
    }

    console.log('\n==================================================');
    console.log('     🔴 SUPER ADMIN DEACTIVATED SUCCESSFULLY!    ');
    console.log('==================================================');
    console.log(` ID:     ${user.id}`);
    console.log(` Name:   ${user.name}`);
    console.log(` Email:  ${user.email}`);
    console.log(` Status: INACTIVE (0)`);
    console.log('==================================================\n');

  } catch (err) {
    console.error('\n❌ Failed to deactivate Super Admin:', err.message);
  } finally {
    rl.close();
    process.exit(0);
  }
}

main();
