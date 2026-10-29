const readline = require('readline');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('dotenv').config();

/**
 * Returns environment and database connection info safely (without passwords)
 */
function getEnvironmentInfo() {
  const env = (process.env.NODE_ENV || 'development').trim().toLowerCase();
  const isProduction = env === 'production';
  const dbHost = (process.env.DB_HOST || 'localhost').trim();
  const dbPort = (process.env.DB_PORT || '3306').trim();
  const dbName = (process.env.DB_NAME || 'ariso_retail_db').trim();
  const dbUser = (process.env.DB_USER || 'root').trim();

  return {
    env,
    isProduction,
    dbHost,
    dbPort,
    dbName,
    dbUser
  };
}

/**
 * Displays a standard header banner for CLI commands
 */
function printBanner(title) {
  const { env, isProduction, dbHost, dbPort, dbName } = getEnvironmentInfo();
  const envBadge = isProduction ? '🔴 PRODUCTION' : '🟢 DEVELOPMENT';

  console.log('\n================================================================================');
  console.log(`                ARISO RETAIL POS — SUPERADMIN ADMINISTRATIVE CLI                `);
  console.log('================================================================================');
  console.log(` Command:     ${title}`);
  console.log(` Environment: ${envBadge} (${env})`);
  console.log(` Database:    ${dbName} @ ${dbHost}:${dbPort}`);
  console.log('================================================================================\n');
}

/**
 * Validates email format according to RFC standards
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email address cannot be empty.' };
  }
  const cleanEmail = email.trim().toLowerCase();
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  if (!emailRegex.test(cleanEmail)) {
    return { valid: false, error: 'Please enter a valid email address (e.g., admin@example.com).' };
  }
  if (cleanEmail.length > 100) {
    return { valid: false, error: 'Email address cannot exceed 100 characters.' };
  }
  return { valid: true, email: cleanEmail };
}

/**
 * Enforces a strong password policy:
 * - At least 8 characters
 * - At least 1 uppercase letter (A-Z)
 * - At least 1 lowercase letter (a-z)
 * - At least 1 number (0-9)
 * - At least 1 special character (!@#$%^&*...)
 * - No whitespace characters
 */
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, errors: ['Password cannot be empty.'] };
  }

  const errors = [];

  if (password.length < 8) {
    errors.push('Must be at least 8 characters long.');
  }
  if (password.length > 128) {
    errors.push('Must not exceed 128 characters.');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Must contain at least one uppercase letter (A-Z).');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Must contain at least one lowercase letter (a-z).');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Must contain at least one number (0-9).');
  }
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/.test(password)) {
    errors.push('Must contain at least one special character (e.g. !@#$%^&*).');
  }
  if (/\s/.test(password)) {
    errors.push('Must not contain spaces or whitespace.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Creates an interactive prompt helper supporting:
 * - standard questions
 * - hidden questions (no echo of typed characters)
 * - confirmation prompts
 */
function createPrompt(inStream = process.stdin, outStream = process.stdout) {
  const rl = readline.createInterface({
    input: inStream,
    output: outStream,
    terminal: inStream.isTTY || false
  });

  const iterator = rl[Symbol.asyncIterator]();
  let isMuted = false;
  const origWrite = rl._writeToOutput;

  rl._writeToOutput = function (stringToWrite) {
    if (isMuted) {
      if (stringToWrite.includes('\n') || stringToWrite.includes('\r')) {
        outStream.write('\n');
      }
    } else if (origWrite) {
      origWrite.call(rl, stringToWrite);
    }
  };

  return {
    /**
     * Ask a normal text question
     */
    async ask(query) {
      isMuted = false;
      outStream.write(query);
      const res = await iterator.next();
      return (res.value || '').trim();
    },

    /**
     * Ask a hidden question where typed characters are not displayed
     */
    async askHidden(query) {
      outStream.write(query);
      isMuted = true;
      const res = await iterator.next();
      isMuted = false;
      return (res.value || '').trim();
    },

    /**
     * Ask for explicit user confirmation (y/N or specific text)
     */
    async askConfirmation(query, expected = null) {
      const answer = await this.ask(query);
      if (expected) {
        return answer.trim().toUpperCase() === expected.toUpperCase();
      }
      return ['y', 'yes'].includes(answer.trim().toLowerCase());
    },

    /**
     * Close the readline interface
     */
    close() {
      rl.close();
    }
  };
}

module.exports = {
  getEnvironmentInfo,
  printBanner,
  validateEmail,
  validatePassword,
  createPrompt
};
