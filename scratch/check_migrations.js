const pool = require('../config/db');
(async () => {
  try {
    const [rows] = await pool.query('SELECT * FROM schema_migrations');
    console.log('Applied migrations:', rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
