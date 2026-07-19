import { csvEscape, downloadFile } from './utils.js';

export function exportAccountCredentialsCsv(accounts) {
  const header = ['ID Number', 'Name', 'Email', 'Role', 'Temporary Password'];
  const rows = accounts.map(a => [a.idNumber || '', a.name, a.email, a.role, a.tempPassword]);
  const csv = [header, ...rows].map(r => r.map(csvEscape).join(',')).join('\n');
  downloadFile('account-credentials.csv', csv, 'text/csv');
}

/** A human-readable alternative to the CSV export — one clearly-labeled block per person, meant
    to be read or handed over directly rather than opened in a spreadsheet. */
export function exportAccountCredentialsTxt(accounts, orgName = 'UniScheduler') {
  const header = `${orgName} — New Account Credentials\nGenerated: ${new Date().toLocaleString()}\n\n` +
    `These are ONE-TIME TEMPORARY passwords. Each person must set their own password the first\n` +
    `time they log in. Share this list directly and securely — do not post it anywhere public.\n\n`;
  const divider = '-'.repeat(30);
  const blocks = accounts.map(a => `ID Number: ${a.idNumber || '—'}\nName: ${a.name}\nEmail: ${a.email}\nPassword: ${a.tempPassword}\n${divider}`).join('\n\n');
  downloadFile('account-credentials.txt', header + blocks + '\n', 'text/plain');
}
