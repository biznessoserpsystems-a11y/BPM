#!/usr/bin/env node
// Builds db/template.db: a SQLite database with the schema already
// applied and only global reference data seeded (RBAC roles, current
// accounting period — see prisma/seed.js). This runs once at BUILD time
// (on a machine with internet access, e.g. GitHub Actions), so the
// server bundle it ends up in never needs `prisma db push` or any
// Prisma engine download on the end user's offline machine — see
// docs/offline-deployment.md.
//
// Usage: node scripts/build-template-db.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const templatePath = path.join(root, 'db', 'template.db');

fs.mkdirSync(path.dirname(templatePath), { recursive: true });
if (fs.existsSync(templatePath)) fs.rmSync(templatePath);

const env = {
  ...process.env,
  DATABASE_URL: `file:${templatePath}`,
};

console.log('Applying schema to template database...');
execSync('npx prisma db push --accept-data-loss --skip-generate', {
  cwd: root,
  env,
  stdio: 'inherit',
});

console.log('Seeding reference data...');
execSync('node prisma/seed.js', {
  cwd: root,
  env,
  stdio: 'inherit',
});

console.log(`Template database ready: ${templatePath}`);
