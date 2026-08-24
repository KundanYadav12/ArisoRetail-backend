const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function showStatus() {
  console.log('\n================================================================================');
  console.log('                 RESTAURANT POS - DATABASE MIGRATION STATUS                     ');
  console.log('================================================================================\n');

  try {
    const [tableCheck] = await pool.query("SHOW TABLES LIKE 'schema_migrations'");
    let appliedMap = new Map();

    if (tableCheck.length > 0) {
      const [appliedRows] = await pool.query(
        'SELECT migration_name, batch, applied_at FROM schema_migrations ORDER BY id ASC'
      );
      appliedRows.forEach(row => {
        appliedMap.set(row.migration_name, row);
      });
    }

    const scriptsDir = path.join(__dirname, 'scripts');
    const files = fs.existsSync(scriptsDir)
      ? fs.readdirSync(scriptsDir).filter(f => f.endsWith('.js')).sort()
      : [];

    if (files.length === 0) {
      console.log('⚠️ No migration script files found in backend/migrations/scripts/\n');
      process.exit(0);
    }

    const statusList = files.map(file => {
      const name = path.parse(file).name;
      const applied = appliedMap.get(name);
      return {
        Migration: name,
        Status: applied ? '🟢 APPLIED' : '🔴 PENDING',
        Batch: applied ? applied.batch : 'N/A',
        'Applied At': applied ? new Date(applied.applied_at).toLocaleString() : 'Pending'
      };
    });

    console.table(statusList);
    console.log('\n================================================================================\n');

  } catch (err) {
    console.error('❌ Failed to fetch migration status:', err.message);
  } finally {
    process.exit(0);
  }
}

showStatus();
