const pool = require('../config/db');
const { getEnvironmentInfo, printBanner } = require('./helpers/cli_helper');

async function main() {
  const { env, dbName, dbHost, dbPort } = getEnvironmentInfo();

  printBanner('Verify / Check Superadmin Accounts');

  try {
    const [rows] = await pool.query(
      `SELECT id, name, username, email, role, is_active, created_at, last_login_at
       FROM users
       WHERE role IN ('super_admin', 'superadmin')
       ORDER BY id ASC`
    );

    if (rows.length === 0) {
      console.log('⚠️  No Superadmin accounts found in the database.');
      console.log(`   Target Database: ${dbName} @ ${dbHost}:${dbPort}`);
      console.log(`   Target Environment: ${env.toUpperCase()}`);
      console.log('\n💡 You can create your first Superadmin account by running:');
      console.log('   npm run superadmin:create\n');
      process.exit(0);
    }

    console.log(`✅ Superadmin Account Verification: Found ${rows.length} Superadmin account(s) in "${dbName}":\n`);

    const safeList = rows.map((u, idx) => ({
      '#': idx + 1,
      ID: u.id,
      Name: u.name,
      Email: u.email || u.username,
      Role: u.role,
      Status: u.is_active === 1 ? '🟢 ACTIVE' : '🔴 INACTIVE',
      'Created Date': u.created_at ? new Date(u.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
      'Last Login (IST)': u.last_login_at ? new Date(u.last_login_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Never logged in'
    }));

    console.table(safeList);

    console.log('\n🔒 SECURITY AUDIT: Safe display mode active.');
    console.log('   No password hashes, session tokens, or sensitive credentials are displayed.\n');
    process.exit(0);

  } catch (err) {
    console.error('❌ Failed to check Superadmin accounts:', err.message);
    process.exit(1);
  }
}

main();
