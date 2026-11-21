// Resets a user's password directly in the server's database — for the case
// where nobody can sign in to do it from inside the app (typically the only
// Admin forgot their password). There's no email on an offline server, so
// there is no "send me a reset link"; the safe alternative is a tool that
// only works from this computer, by someone who can open the server folder.
//
// Run it with reset-password.bat (uses the bundled node.exe). It does not
// need the server to be stopped.
//
// What it does NOT do: it can't read existing passwords (they're stored as
// one-way hashes), and it never touches anything except the one user's
// password hash plus an audit-log entry recording that it happened.
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { Writable } = require('stream');

const ROOT = __dirname;
const DB_PATH = path.join(ROOT, 'db', 'custom.db');
const APP_MODULES = path.join(ROOT, 'app', 'node_modules');

// Same rules as src/lib/password-policy.ts — keep these in sync with it.
function checkPassword(pw) {
  if (!pw || pw.length < 8) return 'Password must be at least 8 characters';
  if (!/[a-z]/.test(pw)) return 'Password must include at least one lowercase letter';
  if (!/[A-Z]/.test(pw)) return 'Password must include at least one uppercase letter';
  if (!/[0-9]/.test(pw)) return 'Password must include at least one number';
  return null;
}

function fail(message) {
  console.error('');
  console.error('ERROR: ' + message);
  console.error('');
  process.exit(1);
}

if (!fs.existsSync(DB_PATH)) {
  fail(
    'Could not find the database at:\n  ' + DB_PATH +
      '\nRun this from the server folder (next to start-server.bat), and start the server at least once first.'
  );
}

let PrismaClient;
let bcrypt;
try {
  ({ PrismaClient } = require(path.join(APP_MODULES, '@prisma', 'client')));
  bcrypt = require(path.join(APP_MODULES, 'bcryptjs'));
} catch (err) {
  fail(
    'This server folder is missing a component needed to reset passwords (' + err.message + ').\n' +
      'Download the latest BiznessPhOS-Server-Windows.zip and copy its files over this folder,\n' +
      'keeping your existing "db" folder and config.json.'
  );
}

process.env.DATABASE_URL = 'file:' + DB_PATH;
const prisma = new PrismaClient();

// Typed characters are echoed through this wrapper; muting it while the
// password is typed means nothing is shown on screen. Lines are read through
// the async iterator so piped input (and fast typists) never lose a line.
let muted = false;
const out = new Writable({
  write(chunk, enc, cb) {
    if (!muted) process.stdout.write(chunk, enc);
    cb();
  },
});
const rl = readline.createInterface({ input: process.stdin, output: out, terminal: !!process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();

async function ask(question, hidden) {
  process.stdout.write(question);
  muted = !!hidden;
  const { value, done } = await lines.next();
  muted = false;
  if (hidden) process.stdout.write('\n');
  if (done) throw new Error('Input ended before all answers were given.');
  return String(value).trim();
}

async function main() {
  console.log('');
  console.log('Bizness-Ph-OS — reset a password');
  console.log('---------------------------------');
  console.log('This changes the password of one account on THIS server. Run it only if');
  console.log('nobody can sign in to reset it from the Users screen.');
  console.log('');

  const admins = await prisma.user.findMany({
    where: { role: { roleName: 'ADMIN' } },
    include: { company: true },
    orderBy: { username: 'asc' },
  });
  if (admins.length) {
    console.log('Administrator accounts on this server:');
    for (const a of admins) {
      console.log('  ' + a.username + '   (' + a.fullName + ', ' + a.company.name + (a.isActive ? '' : ', INACTIVE') + ')');
    }
    console.log('');
  }

  const username = await ask('Username to reset: ', false);
  if (!username) throw new Error('No username entered.');

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw new Error('No account with the username "' + username + '". Check the spelling (it is case-sensitive).');

  console.log('');
  console.log('Resetting the password for ' + user.fullName + ' (' + user.username + ').');
  console.log('At least 8 characters, with an uppercase letter, a lowercase letter, and a number.');
  const pw1 = await ask('New password: ', true);
  const problem = checkPassword(pw1);
  if (problem) throw new Error(problem);
  const pw2 = await ask('Type it again: ', true);
  if (pw1 !== pw2) throw new Error('The two passwords did not match. Nothing was changed.');

  const passwordHash = await bcrypt.hash(pw1, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  // Leave a trail: this bypasses the app, so it must show up in the Audit Log.
  await prisma.systemAuditLog.create({
    data: {
      branchId: user.homeBranchId,
      action: 'OFFLINE_RESET_PASSWORD',
      entityName: 'User',
      entityId: String(user.id),
      details: JSON.stringify({ targetUsername: user.username, method: 'reset-password.bat on the server computer' }),
    },
  });

  console.log('');
  console.log('Done. ' + user.username + ' can now sign in with the new password.');
  if (!user.isActive) {
    console.log('Note: this account is INACTIVE — an Admin must reactivate it from the Users screen before it can sign in.');
  }
  console.log('If they were locked out by repeated wrong attempts, restart the server (or wait');
  console.log('15 minutes) and the lockout clears.');
  console.log('');
}

main()
  .catch((err) => {
    console.error('');
    console.error('Could not reset the password: ' + err.message);
    console.error('');
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });
