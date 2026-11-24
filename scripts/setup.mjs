// One-time setup:
//  1. clones the exercise dataset (≈300 MB) into ./dataset for the admin portal (not deployed)
//  2. downloads the CC0 3D character used to render the exercise animations (≈11 MB, not committed)
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'dataset');
const model = path.join(root, 'tools', 'render3d', 'man.glb');
// "Man Base Mesh" (rigged), CC0 1.0 public domain: https://grab3d.com/models/characters/man-base-character/
const MODEL_URL = 'https://grab3d.com/dl/man-base-character-rigged/man-base-character-rigged.glb';

if (existsSync(path.join(dest, 'data', 'exercises.json'))) console.log('✓ Dataset already present at ./dataset');
else {
  console.log('Cloning exercise dataset (~300 MB, one-time)…');
  execFileSync('git', ['clone', '--depth', '1', 'https://github.com/hasaneyldrm/exercises-dataset.git', dest], { stdio: 'inherit' });
}

if (existsSync(model)) console.log('✓ 3D model already present');
else {
  console.log('Downloading the 3D character (~11 MB)…');
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
  await writeFile(model, Buffer.from(await res.arrayBuffer()));
  console.log('✓ 3D model saved');
}
console.log('✓ Done. Run:  npm run admin');
