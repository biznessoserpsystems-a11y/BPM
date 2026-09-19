#!/usr/bin/env node
// Runs after `next build` (see the "postbuild" npm script). Next's
// `output: "standalone"` (next.config.ts) produces a minimal server +
// node_modules subset, but deliberately does NOT include the static
// assets or the public/ folder — those have to be copied in by hand for
// the standalone output to actually serve the app correctly.
//
// Plain Node (fs.cpSync) instead of a shell `cp -r`, so this works
// identically on Linux, macOS, and Windows CI runners — `cp` isn't a
// command cmd.exe understands, and this script runs on windows-latest
// as part of building the offline server bundle (see
// .github/workflows/release.yml and docs/offline-deployment.md).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

fs.cpSync(path.join(root, '.next', 'static'), path.join(root, '.next', 'standalone', '.next', 'static'), {
  recursive: true,
});
fs.cpSync(path.join(root, 'public'), path.join(root, '.next', 'standalone', 'public'), { recursive: true });

console.log('Copied .next/static and public/ into .next/standalone/');
