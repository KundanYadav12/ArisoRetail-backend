const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const SuperAdminRepository = require('../repositories/superadmin_repository');
const {
  getEnvironmentInfo,
  printBanner,
  validateEmail,
  validatePassword,
  createPrompt
} = require('./helpers/cli_helper');

async function main() {
  const prompt = createPrompt(process.stdin, process.stdout);
  const { isProduction, env, dbName, dbHost } = getEnvironmentInfo();

  printBanner('Create New Superadmin Account');

  try {
    // 1. Full Name
    let name = await prompt.ask('1. Enter Full Name: ');
    while (!name) {
      console.log('   ❌ Full name cannot be empty.');
      name = await prompt.ask('1. Enter Full Name: ');
    }
    if (name.length > 100) {
      name = name.slice(0, 100);
    }

    // 2. Email Address
    let rawEmail = await prompt.ask('2. Enter Superadmin Email: ');
    let emailValidation = validateEmail(rawEmail);
    while (!emailValidation.valid) {
      console.log(`   ❌ ${emailValidation.error}`);
      rawEmail = await prompt.ask('2. Enter Superadmin Email: ');
      emailValidation = validateEmail(rawEmail);
    }
    const email = emailValidation.email;

    // 3. Duplicate Account Prevention
    const [existing] = await pool.query(
      'SELECT id, username, email, role FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?',
      [email, email]
    );

    if (existing.length > 0) {
      console.log('\n❌ [Duplicate Account Refused]');
      console.log(`   An account with email or username "${email}" already exists in ${dbName}.`);
      console.log(`   Existing Account ID:   ${existing[0].id}`);
      console.log(`   Existing Account Role: ${existing[0].role}`);
      console.log('   Aborting to prevent duplicate superadmin creation.\n');
      prompt.close();
      process.exit(1);
    }

    // 4. Password (hidden prompt)
    let password = await prompt.askHidden('3. Enter Password (hidden): ');
    let passwordValidation = validatePassword(password);
    while (!passwordValidation.valid) {
      console.log('   ❌ Password does not satisfy strong password policy:');
      passwordValidation.errors.forEach(err => console.log(`      • ${err}`));
      password = await prompt.askHidden('3. Enter Password (hidden): ');
      passwordValidation = validatePassword(password);
    }

    // 5. Confirm Password (hidden prompt)
    let confirmPassword = await prompt.askHidden('4. Confirm Password (hidden): ');
    if (password !== confirmPassword) {
      console.log('\n❌ [Password Mismatch]');
      console.log('   The entered passwords do not match. Aborting.\n');
      prompt.close();
      process.exit(1);
    }

    // 6. Production Safety Confirmation
    if (isProduction) {
      console.log('\n⚠️  ATTENTION: You are operating against a PRODUCTION environment.');
      const confirmed = await prompt.askConfirmation(
        '   Type "CONFIRM" to create this Superadmin in production: ',
        'CONFIRM'
      );
      if (!confirmed) {
        console.log('\n🚫 Operation cancelled by user. No changes were made.\n');
        prompt.close();
        process.exit(0);
      }
    }

    // 7. Secure Password Hashing (bcrypt, 10 rounds)
    const passwordHash = await bcrypt.hash(password, 10);

    // 8. Insert into users table
    const [result] = await pool.query(
      `INSERT INTO users (
        restaurant_id, name, username, email, password_hash,
        role, is_active, must_change_password, is_verified, active_session_id
      ) VALUES (NULL, ?, ?, ?, ?, 'super_admin', 1, 0, 1, NULL)`,
      [name, email, email, passwordHash]
    );

    const newSuperAdminId = result.insertId;

    // 9. Audit Logging
    try {
      await SuperAdminRepository.addAuditLog(
        null,
        newSuperAdminId,
        'SUPER_ADMIN_CLI_CREATE',
        `Created Superadmin account "${name}" (${email}) via CLI`,
        '127.0.0.1'
      );
    } catch (auditErr) {
      // Audit log failures should not block successful creation
    }

    // 10. Display Safe Success Summary
    console.log('\n================================================================================');
    console.log('                  🎉 SUPERADMIN ACCOUNT CREATED SUCCESSFULLY!                   ');
    console.log('================================================================================');
    console.log(` ID:          ${newSuperAdminId}`);
    console.log(` Name:        ${name}`);
    console.log(` Email:       ${email}`);
    console.log(` Username:    ${email}`);
    console.log(` Role:        super_admin`);
    console.log(` Status:      ACTIVE`);
    console.log(` Database:    ${dbName} @ ${dbHost}`);
    console.log(` Environment: ${env.toUpperCase()}`);
    console.log('--------------------------------------------------------------------------------');
    console.log(' 🔒 SECURITY NOTE: The password has been securely hashed using bcrypt.');
    console.log('    Plaintext passwords are never logged, printed, or stored.');
    console.log('================================================================================\n');

    prompt.close();
    process.exit(0);

  } catch (err) {
    console.error('\n❌ Fatal error creating Superadmin:', err.message);
    prompt.close();
    process.exit(1);
  }
}

main();
