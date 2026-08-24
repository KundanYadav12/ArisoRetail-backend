const pool = require('../config/db');

async function main() {
  console.log('\n========================================================================================================');
  console.log('                                 RESTAURANT POS - LIST SUPER ADMINS CLI                                  ');
  console.log('========================================================================================================\n');

  try {
    const [rows] = await pool.query(
      `SELECT id, name, username, email, is_active, created_at, last_login_at
       FROM users
       WHERE role IN ('super_admin', 'superadmin')
       ORDER BY id ASC`
    );

    if (rows.length === 0) {
      console.log('⚠️ No Super Admin accounts found in database.');
      process.exit(0);
    }

    console.log(`Found ${rows.length} Super Admin account(s):\n`);

    const formattedList = rows.map((u, idx) => ({
      '#': idx + 1,
      ID: u.id,
      Name: u.name,
      Email: u.email || u.username,
      Status: u.is_active === 1 ? '🟢 ACTIVE' : '🔴 INACTIVE',
      'Created Date': u.created_at ? new Date(u.created_at).toLocaleString() : 'N/A',
      'Last Login': u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Never logged in'
    }));

    console.table(formattedList);
    console.log('\n========================================================================================================\n');

  } catch (err) {
    console.error('❌ Failed to list Super Admins:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
