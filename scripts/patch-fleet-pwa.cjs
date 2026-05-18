const fs = require('fs');
const path = require('path');

const fleetHtmlPath = path.join(process.cwd(), 'dist', 'fleet', 'index.html');

if (!fs.existsSync(fleetHtmlPath)) {
  process.exit(0);
}

const original = fs.readFileSync(fleetHtmlPath, 'utf8');
const patched = original.replace(/\s*<link rel="manifest" href="\/manifest\.webmanifest">/g, '');

if (patched !== original) {
  fs.writeFileSync(fleetHtmlPath, patched, 'utf8');
  console.log('[patch-fleet-pwa] manifest principal removido de dist/fleet/index.html');
}
