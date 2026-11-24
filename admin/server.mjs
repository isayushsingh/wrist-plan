// WristPlan admin server — runs only on your laptop (127.0.0.1). No dependencies.
//   npm run admin   →   http://localhost:4321
import http from 'node:http';
import { readFile, writeFile, readdir, copyFile, unlink, mkdir, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATASET = process.env.DATASET || path.join(ROOT, 'dataset');
const SITE = path.join(ROOT, 'site');
const GIFS = path.join(SITE, 'gifs');
const PLAN = path.join(SITE, 'plan.json');
const PORT = Number(process.env.PORT || 4321);
const ATTRIBUTION = '© Gym visual — https://gymvisual.com/';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.gif': 'image/gif', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// ---------- dataset ----------
const cleanName = (s) => s.replace(/в°/g, '°').replace(/\s+/g, ' ').trim();
let library = null;          // slim list sent to the browser
const gifById = new Map();   // id -> absolute gif path

async function loadLibrary() {
  if (library) return library;
  const file = path.join(DATASET, 'data', 'exercises.json');
  if (!existsSync(file)) throw new Error('Dataset missing. Run:  npm run setup');
  const raw = JSON.parse(await readFile(file, 'utf8'));
  library = raw.map((e) => {
    gifById.set(e.id, path.join(DATASET, e.gif_url));
    return {
      id: e.id,
      name: cleanName(e.name),
      target: e.target || '',
      bodyPart: e.body_part || '',
      equipment: e.equipment || '',
      image: e.image,       // served from /dataset/...
      gif: e.gif_url,
    };
  });
  return library;
}

// ---------- helpers ----------
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

async function serveFile(res, baseDir, rel) {
  const target = path.resolve(baseDir, '.' + path.posix.normalize('/' + rel));
  if (!target.startsWith(path.resolve(baseDir) + path.sep) && target !== path.resolve(baseDir)) {
    return send(res, 403, { error: 'forbidden' });
  }
  try {
    const s = await stat(target);
    const file = s.isDirectory() ? path.join(target, 'index.html') : target;
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': path.extname(file) === '.gif' || path.extname(file) === '.jpg'
        ? 'public, max-age=86400' : 'no-store',
    });
    createReadStream(file).pipe(res);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

const readBody = (req) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', (c) => { data += c; if (data.length > 2e6) reject(new Error('too large')); });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

function validatePlan(plan) {
  if (!plan || !Array.isArray(plan.days)) throw new Error('plan.days must be an array');
  const days = plan.days.map((d, i) => {
    if (!Array.isArray(d.exercises)) throw new Error(`Day ${i + 1}: exercises must be an array`);
    return {
      id: String(d.id || `d${i + 1}`).slice(0, 40),
      name: String(d.name || `Day ${i + 1}`).slice(0, 40),
      exercises: d.exercises.map((x) => {
        const id = String(x.id);
        if (!/^\d{4}$/.test(id) || !gifById.has(id)) throw new Error(`Unknown exercise id: ${id}`);
        return { id, label: String(x.label || '').slice(0, 60) };
      }),
    };
  });
  return { version: 1, updatedAt: new Date().toISOString(), attribution: ATTRIBUTION, days };
}

async function syncGifs(plan) {
  await mkdir(GIFS, { recursive: true });
  const needed = new Set(plan.days.flatMap((d) => d.exercises.map((x) => x.id)));
  const existing = new Set((await readdir(GIFS)).filter((f) => f.endsWith('.gif')).map((f) => f.slice(0, -4)));
  let added = 0, removed = 0;
  for (const id of needed) {
    if (!existing.has(id)) { await copyFile(gifById.get(id), path.join(GIFS, `${id}.gif`)); added++; }
  }
  for (const id of existing) {
    if (!needed.has(id)) { await unlink(path.join(GIFS, `${id}.gif`)); removed++; }
  }
  return { added, removed, total: needed.size };
}

const git = (args) => new Promise((resolve) => {
  execFile('git', args, { cwd: ROOT }, (err, stdout, stderr) =>
    resolve({ ok: !err, out: (stdout + stderr).trim() }));
});

// ---------- routes ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = decodeURIComponent(url.pathname);
  try {
    if (p === '/' || p === '/index.html') return serveFile(res, path.join(ROOT, 'admin'), 'index.html');
    if (p.startsWith('/preview')) return serveFile(res, SITE, p.slice('/preview'.length) || '/');
    if (p.startsWith('/dataset/')) return serveFile(res, DATASET, p.slice('/dataset'.length));

    if (p === '/api/exercises' && req.method === 'GET') return send(res, 200, await loadLibrary());

    if (p === '/api/plan' && req.method === 'GET') {
      const txt = existsSync(PLAN) ? await readFile(PLAN, 'utf8') : '{"version":1,"days":[]}';
      return send(res, 200, txt);
    }

    if (p === '/api/plan' && req.method === 'PUT') {
      await loadLibrary();
      const plan = validatePlan(JSON.parse(await readBody(req)));
      await writeFile(PLAN, JSON.stringify(plan, null, 2) + '\n');
      const gifs = await syncGifs(plan);
      return send(res, 200, { ok: true, updatedAt: plan.updatedAt, gifs });
    }

    if (p === '/api/publish' && req.method === 'POST') {
      if (!existsSync(path.join(ROOT, '.git'))) {
        return send(res, 200, { ok: false, out: 'This folder is not a git repo yet. See README → "Deploy".' });
      }
      const steps = [];
      for (const args of [['add', 'site'], ['commit', '-m', 'Update workout plan'], ['push']]) {
        const r = await git(args);
        steps.push(`$ git ${args.join(' ')}\n${r.out}`);
        if (!r.ok && !(args[0] === 'commit' && /nothing to commit/.test(r.out))) {
          return send(res, 200, { ok: false, out: steps.join('\n\n') });
        }
      }
      return send(res, 200, { ok: true, out: steps.join('\n\n') });
    }

    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 400, { error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  WristPlan admin →  http://localhost:${PORT}\n`);
});
