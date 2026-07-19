const nodemailer = require('nodemailer');

// No email-sending capability existed anywhere in this app before this file — every account
// created up to now hands back a one-time temp password for an admin to relay manually (see
// accounts.js). This adds real SMTP support for the admissions flow (credential + status-change
// emails to an applicant's personal address), but stays entirely optional: with no SMTP_HOST set,
// every call below no-ops instead of throwing, so account creation and status changes never block
// on email being configured.

let transporter;
function getTransporter() {
  if (transporter !== undefined) return transporter;
  if (!process.env.SMTP_HOST) { transporter = null; return transporter; }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}

/** Best-effort send — never throws. Returns { sent: true } or { sent: false, reason }, so every
    call site can treat email as strictly optional (log the failure, keep going). */
async function sendMail({ to, subject, text, html }) {
  const t = getTransporter();
  if (!t) return { sent: false, reason: 'Email is not configured (no SMTP_HOST set).' };
  try {
    const fromName = process.env.SMTP_FROM_NAME || 'UniScheduler';
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'no-reply@example.com';
    await t.sendMail({ from: `"${fromName}" <${fromEmail}>`, to, subject, text, html });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendMail };
