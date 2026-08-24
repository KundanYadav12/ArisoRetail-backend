const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

/**
 * Enterprise Production-Ready Migration Runner
 */
async function runMigrations() {
  console.log('[Migration System] Initializing database migration engine...');

  const connection = await pool.getConnection();

  try {
    // 1. Create schema_migrations tracking table if not exists
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        migration_name VARCHAR(255) NOT NULL UNIQUE,
        batch INT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2. Fetch already applied migrations
    const [appliedRows] = await connection.query(
      'SELECT migration_name FROM schema_migrations'
    );
    const appliedNames = new Set(appliedRows.map(row => row.migration_name));

    // 3. Determine current batch number
    const [batchRow] = await connection.query(
      'SELECT COALESCE(MAX(batch), 0) + 1 AS next_batch FROM schema_migrations'
    );
    const nextBatch = batchRow[0].next_batch;

    // 4. Discover all migration script files
    const scriptsDir = path.join(__dirname, 'scripts');
    if (!fs.existsSync(scriptsDir)) {
      fs.mkdirSync(scriptsDir, { recursive: true });
    }

    const files = fs.readdirSync(scriptsDir)
      .filter(f => f.endsWith('.js'))
      .sort(); // Sequential numerical / alphabetical order

    const pendingFiles = files.filter(f => !appliedNames.has(path.parse(f).name));

    if (pendingFiles.length === 0) {
      console.log('[Migration System] Database schema is up to date. Zero pending migrations.');
      return { appliedCount: 0 };
    }

    console.log(`[Migration System] Found ${pendingFiles.length} pending migration(s) to execute (Batch #${nextBatch}).`);

    // 5. Execute pending migrations sequentially
    let appliedCount = 0;

    for (const file of pendingFiles) {
      const migrationName = path.parse(file).name;
      const scriptPath = path.join(scriptsDir, file);
      const migration = require(scriptPath);

      console.log(`[Migration System] Executing migration: "${migrationName}"...`);

      await connection.beginTransaction();

      try {
        if (typeof migration.up === 'function') {
          await migration.up(connection);
        }

        await connection.query(
          'INSERT INTO schema_migrations (migration_name, batch) VALUES (?, ?)',
          [migrationName, nextBatch]
        );

        await connection.commit();
        appliedCount++;
        console.log(`[Migration System] SUCCESS: Applied "${migrationName}".`);
      } catch (migrationErr) {
        await connection.rollback();
        console.error(`\n❌ [Migration System Failed] Migration "${migrationName}" failed with error:`);
        console.error(`   ${migrationErr.message}`);
        console.error('   Transaction rolled back. Halting further migration execution.\n');
        throw migrationErr;
      }
    }

    console.log(`[Migration System] Migration batch #${nextBatch} completed successfully. ${appliedCount} migration(s) applied.`);
    return { appliedCount, batch: nextBatch };

  } catch (err) {
    console.error('[Migration Engine Fatal Error]', err.message);
    throw err;
  } finally {
    connection.release();
  }
}

// Allow CLI execution directly via Node
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('[Migration Engine] Completed.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Migration Engine] Terminated with errors:', err.message);
      process.exit(1);
    });
}

module.exports = runMigrations;
