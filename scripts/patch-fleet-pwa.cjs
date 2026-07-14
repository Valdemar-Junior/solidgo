const fs = require('fs');
const path = require('path');

const fleetHtmlPaths = [
  path.join(process.cwd(), 'dist', 'fleet', 'index.html'),
  path.join(process.cwd(), 'dist', 'inspecao', 'index.html'),
];

fleetHtmlPaths.forEach((fleetHtmlPath) => {
  if (!fs.existsSync(fleetHtmlPath)) return;

  const original = fs.readFileSync(fleetHtmlPath, 'utf8');
  const patched = original.replace(/\s*<link rel="manifest" href="\/manifest\.webmanifest">/g, '');

  if (patched !== original) {
    fs.writeFileSync(fleetHtmlPath, patched, 'utf8');
    console.log(`[patch-fleet-pwa] manifest principal removido de ${path.relative(process.cwd(), fleetHtmlPath)}`);
  }
});
