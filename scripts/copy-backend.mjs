/**
 * Copies the backend API source into electron/backend/ so it gets packaged
 * inside the Electron app. Run automatically by `npm run dist` and
 * `npm run electron` — re-run it whenever the backend changes.
 *
 * Also drops a nested package.json marking the copy as CommonJS: this project
 * is "type": "module", and without the override Node would try to load the
 * backend's require()-based files as ES modules.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backendSrc = path.resolve(projectRoot, '..', 'uni scheduling', 'api', 'src');
const dest = path.join(projectRoot, 'electron', 'backend');

if (!fs.existsSync(backendSrc)) {
  console.error(`Backend source not found at: ${backendSrc}`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(backendSrc, dest, { recursive: true });
fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');

console.log(`Copied backend: ${backendSrc} -> ${dest}`);
