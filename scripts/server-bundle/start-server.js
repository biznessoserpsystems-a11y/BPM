// Runs inside the portable server bundle (see .github/workflows/release.yml
// and docs/offline-deployment.md) using the bundled node.exe — nothing here
// needs Node.js to already be installed on the machine, and nothing here
// ever reaches the internet.
//
// Responsibilities:
//   - First run: copy template.db -> db/custom.db, generate and persist
//     JWT_SECRET/FIELD_ENCRYPTION_KEY (these must stay stable across
//     restarts — regenerating them would invalidate sessions and break
//     decryption of already-encrypted payroll data).
//   - Print the LAN address so the operator knows what to type into each
//     desktop client's "Change Server" screen.
//   - Spawn the actual Next.js standalone server, bound to 0.0.0.0 so
//     other computers on the network can reach it, not just this one.
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = __dirname;
const APP_DIR = path.join(ROOT, 'app');
const DB_DIR = path.join(ROOT, 'db');
const DB_PATH = path.join(DB_DIR, 'custom.db');
const TEMPLATE_DB_PATH = path.join(ROOT, 'template.db');
const CONFIG_PATH = path.join(ROOT, 'config.json');

function loadOrCreateConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    // Upgrade path: a bundle started before this field existed won't have
    // it yet — add it in place rather than requiring a fresh install.
    let isNewLicenseSecret = false;
    if (!config.licenseAdminSecret) {
      config.licenseAdminSecret = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
      isNewLicenseSecret = true;
    }
    return { config, isNewLicenseSecret };
  } catch {
    const config = {
      port: 3210,
      jwtSecret: crypto.randomBytes(48).toString('hex'),
      fieldEncryptionKey: crypto.randomBytes(48).toString('hex'),
      // Gates the /admin/licenses panel (see src/app/api/v1/admin/
      // license-tokens/route.ts) — separate from JWT_SECRET so pharmacy
      // staff logins can never mint license tokens themselves. Shown
      // once below, when first generated, rather than requiring anyone
      // to open this file by hand — but NOT reprinted on every
      // subsequent start (see show-license-secret.bat for that), since
      // a secret that reappears in this console on every boot is more
      // exposure than necessary (screen-shares, remote desktop,
      // photos, screenshots — all of which have actually happened
      // during this app's own development).
      licenseAdminSecret: crypto.randomBytes(32).toString('hex'),
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    return { config, isNewLicenseSecret: true };
  }
}

function ensureDatabase() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    if (!fs.existsSync(TEMPLATE_DB_PATH)) {
      console.error(`Could not find template.db at ${TEMPLATE_DB_PATH}. This bundle was not built correctly.`);
      process.exit(1);
    }
    fs.copyFileSync(TEMPLATE_DB_PATH, DB_PATH);
    console.log('Created a new database at db\\custom.db');
  }
}

function getLanAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

const { config, isNewLicenseSecret } = loadOrCreateConfig();
ensureDatabase();

const ip = getLanAddress();
console.log('');
console.log('========================================================');
console.log('  Bizness-Ph-OS server starting...');
console.log('');
console.log(`  On this computer:        http://localhost:${config.port}`);
console.log(
  ip
    ? `  From other computers:    http://${ip}:${config.port}`
    : '  Could not detect a network address — check this computer is connected to the network.'
);
console.log('');
console.log('  Enter the "other computers" address into each desktop');
console.log('  app\u2019s "Change Server" screen to connect it to this one.');
console.log('========================================================');
console.log('');
if (isNewLicenseSecret) {
  console.log('  License admin panel: http://localhost:' + config.port + '/admin/licenses');
  console.log('  Secret (enter this on that page) \u2014 shown ONLY this once:');
  console.log('    ' + config.licenseAdminSecret);
  console.log('  Copy it somewhere safe now (a password manager, not a');
  console.log('  sticky note). It will NOT be printed again on future');
  console.log('  starts \u2014 run show-license-secret.bat if you need it');
  console.log('  again later. Treat it like a password: whoever has it');
  console.log('  can generate license tokens for new pharmacies.');
} else {
  console.log('  License admin panel: http://localhost:' + config.port + '/admin/licenses');
  console.log('  (run show-license-secret.bat if you need the secret again)');
}
console.log('========================================================');
console.log('');
console.log('Leave this window open while staff are using the system.');
console.log('Closing it will shut the server down for everyone connected.');
console.log('');

const child = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
  cwd: APP_DIR,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(config.port),
    HOSTNAME: '0.0.0.0',
    DATABASE_URL: `file:${DB_PATH}`,
    JWT_SECRET: config.jwtSecret,
    FIELD_ENCRYPTION_KEY: config.fieldEncryptionKey,
    LICENSE_ADMIN_SECRET: config.licenseAdminSecret,
  },
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
