const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config();

// 1. Validate mandatory database environment variables
const requiredEnvVars = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASS', 'DB_NAME'];
const missingVars = requiredEnvVars.filter(v => process.env[v] === undefined || process.env[v] === null || process.env[v].toString().trim() === '');

if (missingVars.length > 0) {
  console.error('\n================================================================================');
  console.error(' ❌ FATAL CONFIGURATION ERROR: MISSING DATABASE ENVIRONMENT VARIABLES');
  console.error('================================================================================');
  console.error(' The application requires all database settings to be loaded from environment variables.');
  console.error(' The following required environment variable(s) are missing in .env:\n');
  missingVars.forEach(v => console.error(`   - ${v}`));
  console.error('\n Please configure these environment variables before starting the application.');
  console.error('================================================================================\n');
  process.exit(1);
}

// 2. Build production database configuration (No hardcoded credentials or fallbacks)
const dbConfig = {
  host: process.env.DB_HOST.trim(),
  port: parseInt(process.env.DB_PORT.trim(), 10),
  user: process.env.DB_USER.trim(),
  password: process.env.DB_PASS,
  database: process.env.DB_NAME.trim(),
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '20', 10),
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
};

// 3. Log database connection details (Password protected)
console.log('[Database Engine] Initializing MySQL connection pool...');
console.log(`  • Host:     ${dbConfig.host}`);
console.log(`  • Port:     ${dbConfig.port}`);
console.log(`  • Database: ${dbConfig.database}`);
console.log(`  • User:     ${dbConfig.user}`);
console.log('  • Password: [PROTECTED]');

// 4. Create MySQL connection pool
const pool = mysql.createPool(dbConfig);

// 5. Test initial database connection on startup
pool.getConnection()
  .then(connection => {
    console.log(`[Database Engine] ✅ Connected successfully to MySQL database "${dbConfig.database}" on ${dbConfig.host}:${dbConfig.port} as user "${dbConfig.user}".`);
    connection.release();
  })
  .catch(err => {
    console.error('\n================================================================================');
    console.error(' ❌ FATAL DATABASE ERROR: CONNECTION FAILED');
    console.error('================================================================================');
    console.error(` Error Code: ${err.code || 'UNKNOWN'}`);
    console.error(` Message:    ${err.message}`);
    console.error(` Target:     ${dbConfig.host}:${dbConfig.port}`);
    console.error(` Database:   ${dbConfig.database}`);
    console.error(` User:       ${dbConfig.user}`);
    console.error('================================================================================\n');
  });

module.exports = pool;
