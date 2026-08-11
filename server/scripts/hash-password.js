#!/usr/bin/env node
/**
 * Usage: node server/scripts/hash-password.js "my super secret password"
 * Copy the output into ADMIN_PASSWORD_HASH in your .env file.
 */
const { hashPassword } = require('../lib/auth');

const password = process.argv.slice(2).join(' ');
if (!password) {
  console.error('Usage: node server/scripts/hash-password.js "<password>"');
  process.exit(1);
}
console.log(hashPassword(password));
