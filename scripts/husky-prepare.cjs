const fs = require('fs');

const isCI = process.env.CI === 'true' || Boolean(process.env.VERCEL);
const hasGit = fs.existsSync('.git');

if (isCI || !hasGit) {
  process.stdout.write('Skipping husky install (CI or no .git)\n');
  process.exit(0);
}

try {
  const husky = require('husky');
  husky.install();
  process.stdout.write('Husky installed.\n');
} catch (e) {
  process.stdout.write('Husky install failed, skipping.\n');
  process.exit(0);
}

