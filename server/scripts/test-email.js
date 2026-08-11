#!/usr/bin/env node
/**
 * Verifies the SMTP settings in .env by connecting and sending a test message.
 *
 *   node server/scripts/test-email.js                 # send to MAIL_TO
 *   node server/scripts/test-email.js you@example.com # send somewhere else
 *
 * Run this on the server after editing .env — it fails in seconds with a clear
 * reason, instead of you discovering the problem when a real enquiry vanishes.
 */

require('../lib/env').load();

const nodemailer = require('nodemailer');

const to = process.argv[2] || process.env.MAIL_TO || process.env.ADMIN_EMAIL;

const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
const missing = required.filter((key) => !process.env[key]);

console.log('SMTP configuration');
console.log('------------------');
console.log(`  host    ${process.env.SMTP_HOST || '(not set)'}`);
console.log(`  port    ${process.env.SMTP_PORT || '(not set)'}`);
console.log(`  secure  ${process.env.SMTP_SECURE === 'true'}`);
console.log(`  user    ${process.env.SMTP_USER || '(not set)'}`);
console.log(`  pass    ${process.env.SMTP_PASS ? '(set)' : '(not set)'}`);
console.log(`  from    ${process.env.MAIL_FROM || '(not set)'}`);
console.log(`  to      ${to || '(not set)'}\n`);

if (missing.length) {
  console.error(`Missing: ${missing.join(', ')}`);
  console.error('Contact-form enquiries will still be saved to the admin inbox,');
  console.error('but no email notification will be sent. See DEPLOY.md section 3.');
  process.exit(1);
}
if (!to) {
  console.error('No recipient. Set MAIL_TO in .env or pass an address as an argument.');
  process.exit(1);
}

const port = Number(process.env.SMTP_PORT);
const secure = process.env.SMTP_SECURE === 'true';

// Port 465 is implicit TLS; 587 is STARTTLS. Mismatching these is the single
// most common cause of a connection that hangs until timeout.
if (port === 465 && !secure) console.warn('Warning: port 465 normally needs SMTP_SECURE=true\n');
if (port === 587 && secure) console.warn('Warning: port 587 normally needs SMTP_SECURE=false\n');

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
});

(async () => {
  try {
    process.stdout.write('Verifying connection… ');
    await transport.verify();
    console.log('ok');

    process.stdout.write('Sending test message… ');
    const info = await transport.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to,
      subject: 'Koydam — SMTP test',
      text: 'If you are reading this, the contact form and invoice notifications can send email.',
    });
    console.log('ok');
    console.log(`\nMessage ID: ${info.messageId}`);
    console.log(`Delivered to: ${to}`);
    console.log('\nCheck the inbox (and the spam folder — if it landed there, add SPF and DKIM records for your domain).');
  } catch (err) {
    console.log('failed\n');
    console.error(`Error: ${err.message}`);

    const hints = {
      EAUTH: 'Authentication rejected. Check SMTP_USER is the full email address and SMTP_PASS is the mailbox password (not your hPanel password).',
      ETIMEDOUT: 'Connection timed out. Check the port, and whether the host firewall allows outbound SMTP.',
      ECONNECTION: 'Could not connect. Check SMTP_HOST and SMTP_PORT.',
      ESOCKET: 'TLS negotiation failed — usually SMTP_SECURE not matching the port (465 = true, 587 = false).',
      EENVELOPE: 'The server rejected the sender or recipient. MAIL_FROM must be an address on a domain you own.',
    };
    if (hints[err.code]) console.error(`\n${hints[err.code]}`);
    process.exit(1);
  }
})();
