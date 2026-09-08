const pool = require('../config/db');

async function main() {
  try {
    const [tables] = await pool.execute('SHOW TABLES');
    console.log('Tables in database:', tables.map(t => Object.values(t)[0]));

    for (const tableObj of tables) {
      const tableName = Object.values(tableObj)[0];
      const [columns] = await pool.execute(`DESCRIBE \`${tableName}\``);
      console.log(`\n--- SCHEMA FOR TABLE: ${tableName} ---`);
      columns.forEach(col => {
        console.log(`  ${col.Field.padEnd(25)} | ${col.Type.padEnd(20)} | Null: ${col.Null} | Key: ${col.Key} | Default: ${col.Default}`);
      });
    }
  } catch (err) {
    console.error('Error running schema check:', err);
  } finally {
    await pool.end();
  }
}

main();
