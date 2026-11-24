// WristPlan admin server — runs only on your laptop (127.0.0.1). No dependencies.
//   npm run admin   →   http://localhost:4321
import http from 'node:http';
import { readFile, writeFile, readdir, unlink, mkdir, stat, rm } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { decode, darkBackground, frameImages } from './gif.mjs';
import { MOTIONS, motionInfo } from './motion-map.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATASET = process.env.DATASET || path.join(ROOT, 'dataset');
const SITE = path.join(ROOT, 'site');
const ANIM = path.join(SITE, 'anim');
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
const motionById = new Map(); // id -> { m: movement key | null, eq, p: [muscles], s: [muscles] }

async function loadLibrary() {
  if (library) return library;
  const file = path.join(DATASET, 'data', 'exercises.json');
  if (!existsSync(file)) throw new Error('Dataset missing. Run:  npm run setup');
  const raw = JSON.parse(await readFile(file, 'utf8'));
  library = raw.map((e) => {
    gifById.set(e.id, path.join(DATASET, e.gif_url));
    const mo = motionInfo({ ...e, name: cleanName(e.name) });
    motionById.set(e.id, mo);
    return {
      motion: mo.m,         // auto-matched vector movement, or null
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

// Monday of the current week, local time, as YYYY-MM-DD
function thisMonday() {
  const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function validatePlan(plan) {
  if (!plan) throw new Error('empty plan');
  // v1 plans had a single `days` list: treat it as one week
  const weeksIn = Array.isArray(plan.weeks) ? plan.weeks
    : Array.isArray(plan.days) ? [{ id: 'A', name: 'Week A', days: plan.days }] : null;
  if (!weeksIn || !weeksIn.length || weeksIn.length > 4) throw new Error('plan.weeks must have 1 to 4 weeks');
  const seen = new Set();
  const weeks = weeksIn.map((w, wi) => {
    if (!Array.isArray(w.days)) throw new Error(`Week ${wi + 1}: days must be an array`);
    return {
      id: String(w.id || String.fromCharCode(65 + wi)).slice(0, 20),
      name: String(w.name || `Week ${String.fromCharCode(65 + wi)}`).slice(0, 24),
      days: w.days.map((d, i) => {
        if (!Array.isArray(d.exercises)) throw new Error(`Week ${wi + 1}, day ${i + 1}: exercises must be an array`);
        // day ids must be unique across weeks (the watch remembers the last-opened day by id)
        let id = String(d.id || `d${i + 1}`).slice(0, 40);
        while (seen.has(id)) id += '_';
        seen.add(id);
        return {
          id,
          name: String(d.name || `Day ${i + 1}`).slice(0, 40),
          exercises: d.exercises.map((x) => {
            const xid = String(x.id);
            if (!/^\d{4}$/.test(xid) || !gifById.has(xid)) throw new Error(`Unknown exercise id: ${xid}`);
            const out = { id: xid, label: String(x.label || '').slice(0, 60) };
            // optional animation override: a movement key, or 'gif' for the original animation
            if (x.mo === 'gif' || MOTIONS[x.mo]) out.mo = x.mo;
            return out;
          }),
        };
      }),
    };
  });
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(plan.weekAnchor || '') ? plan.weekAnchor : thisMonday();
  return { version: 2, updatedAt: new Date().toISOString(), attribution: ATTRIBUTION, weekAnchor: anchor, weeks };
}

// Each exercise's animation is published as site/anim/<id>/<n>.png: one 180x180 PNG per frame,
// with the white backdrop turned black. The watch page steps through them with JS, because some
// watch browsers won't animate GIFs and watchOS downsamples big images (a tall sprite sheet came out
// blurry). Frame timings go into plan.json `anim`.
// Bump ANIM_STYLE whenever processing changes; every animation is then regenerated on the next Save.
const ANIM_STYLE = 'frames-dark-v1';
const META = path.join(ANIM, 'meta.json');

// Ids that the watch shows with the original (raster) animation: no vector movement, or overridden.
function rasterIds(plan) {
  const ids = new Set();
  for (const w of plan.weeks) for (const d of w.days) for (const x of d.exercises) {
    if (x.mo === 'gif' || (!x.mo && !motionById.get(x.id)?.m)) ids.add(x.id);
  }
  return ids;
}

async function syncAnims(plan) {
  await mkdir(ANIM, { recursive: true });
  const needed = rasterIds(plan);
  const entries = await readdir(ANIM, { withFileTypes: true });
  const existing = new Set(entries.filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name)).map((e) => e.name));
  let meta = { style: '', delays: {} };
  try { meta = JSON.parse(await readFile(META, 'utf8')); } catch {}
  const fresh = meta.style === ANIM_STYLE;
  const delays = {};
  let added = 0, removed = 0;
  for (const id of needed) {
    if (fresh && existing.has(id) && meta.delays[id]) { delays[id] = meta.delays[id]; continue; }
    const { frames, delays: d } = frameImages(darkBackground(decode(await readFile(gifById.get(id)))));
    const dir = path.join(ANIM, id);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir);
    for (let i = 0; i < frames.length; i++) await writeFile(path.join(dir, `${i}.png`), frames[i]);
    delays[id] = d;
    if (!existing.has(id)) added++;
  }
  for (const id of existing) {
    if (!needed.has(id)) { await rm(path.join(ANIM, id), { recursive: true, force: true }); removed++; }
  }
  // leftovers from older formats (e.g. anim/<id>.png sprite sheets)
  for (const e of entries) if (e.isFile() && e.name.endsWith('.png')) await unlink(path.join(ANIM, e.name));
  await writeFile(META, JSON.stringify({ style: ANIM_STYLE, delays }) + '\n');
  return { added, removed, total: needed.size, delays };
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
    // the watch page uses relative URLs (plan.json, anim/…), so it must be served from /preview/
    if (p === '/preview') { res.writeHead(301, { Location: '/preview/' }); return res.end(); }
    if (p.startsWith('/preview/')) return serveFile(res, SITE, p.slice('/preview'.length));
    if (p.startsWith('/dataset/')) return serveFile(res, DATASET, p.slice('/dataset'.length));

    if (p === '/api/exercises' && req.method === 'GET') return send(res, 200, await loadLibrary());
    if (p === '/api/motions' && req.method === 'GET') return send(res, 200, MOTIONS);

    if (p === '/api/plan' && req.method === 'GET') {
      const txt = existsSync(PLAN) ? await readFile(PLAN, 'utf8') : '{"version":1,"days":[]}';
      return send(res, 200, txt);
    }

    if (p === '/api/plan' && req.method === 'PUT') {
      await loadLibrary();
      const plan = validatePlan(JSON.parse(await readBody(req)));
      const { delays, ...gifs } = await syncAnims(plan);
      plan.anim = delays;       // { id: [ms per frame] }, read by the watch page
      plan.animV = ANIM_STYLE;  // cache-buster for anim/<id>/<n>.png (served with a 1-week max-age)
      // vector movement + muscles per exercise (drawn by the watch page's Motion library)
      plan.motion = {};
      for (const w of plan.weeks) for (const d of w.days) for (const x of d.exercises) plan.motion[x.id] = motionById.get(x.id);
      await writeFile(PLAN, JSON.stringify(plan, null, 2) + '\n');
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
