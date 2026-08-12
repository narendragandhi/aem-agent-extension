const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const packageJson = JSON.parse(read('package.json'));

const failures = [];
if (manifest.manifest_version !== 3) failures.push('manifest must use Manifest V3');
if (manifest.version !== packageJson.version) failures.push('manifest/package versions differ');
for (const size of ['16', '48', '128']) {
  if (!manifest.icons?.[size]) failures.push(`missing ${size}px icon`);
}
if (!fs.existsSync(path.join(root, 'privacy-policy.html'))) failures.push('privacy policy is missing');
if (read('src/sidepanel/sidepanel.html').includes('btnDevOps')) failures.push('unfinished Cloud Manager action is exposed');

const source = [
  'src/background/background.js',
  'src/sidepanel/sidepanel.js',
  'src/content/bridge.js'
].map(read).join('\n');
if (/storage\.local\.set\([^\n]*aemPassword/.test(source)) {
  failures.push('AEM password must not be written to persistent storage');
}
if (/<script[^>]+src=["']https?:\/\//i.test(read('src/sidepanel/sidepanel.html'))) {
  failures.push('extension page references a remote script');
}

if (failures.length) {
  console.error(failures.map(failure => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log(`Store package checks passed for ${manifest.name} ${manifest.version}`);
