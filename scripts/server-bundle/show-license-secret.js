// Prints the license admin secret on demand. start-server.js only shows
// this once, the very first time it's generated, rather than on every
// startup — this script exists for the (hopefully rare) case where you
// genuinely need to see it again: setting up /admin/licenses on a new
// browser, or you didn't copy it down the first time.
//
// Deliberately a separate, explicit action rather than passive console
// output on every boot — you have to choose to run this and be at the
// keyboard for it, rather than the secret reappearing every time the
// server starts regardless of who's watching the screen.
const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(__dirname, 'config.json');

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch {
  console.error('Could not read config.json — has the server been started at least once yet?');
  process.exit(1);
}

if (!config.licenseAdminSecret) {
  console.error('No license admin secret found in config.json yet — start the server once first.');
  process.exit(1);
}

console.log('');
console.log('License admin panel: http://localhost:' + (config.port || 3210) + '/admin/licenses');
console.log('Secret:');
console.log('  ' + config.licenseAdminSecret);
console.log('');
console.log('Treat this like a password \u2014 whoever has it can generate');
console.log('license tokens for new pharmacies.');
console.log('');
