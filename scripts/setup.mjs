// Downloads the exercise dataset (≈300 MB) into ./dataset for the admin portal.
// Only GIFs you actually use get copied into ./site/gifs, so the deployed site stays tiny.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'dataset');

if (existsSync(path.join(dest, 'data', 'exercises.json'))) {
  console.log('✓ Dataset already present at ./dataset');
  process.exit(0);
}

console.log('Cloning exercise dataset (~300 MB, one-time)…');
execFileSync('git', ['clone', '--depth', '1',
  'https://github.com/hasaneyldrm/exercises-dataset.git', dest], { stdio: 'inherit' });
console.log('✓ Done. Run:  npm run admin');
