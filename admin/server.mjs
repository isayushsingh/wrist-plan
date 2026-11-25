// WristPlan admin server — runs only on your laptop (127.0.0.1). No dependencies.
//   npm run admin   →   http://localhost:4321
import http from 'node:http';
import { readFile, writeFile, readdir, unlink, mkdir, stat, rm } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { decode, darkBackground, frameImages } from './gif.mjs';
import { MOTIONS, RENDERED, motionInfo } from './motion-map.mjs';
import { renderJobs, RENDER_STYLE } from '../tools/render3d/render.mjs';

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
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4',
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
      motion: mo.m,         // auto-matched movement key, or null (3D if it's in RENDERED)
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

// Each exercise is shown on the watch as ONE still image in site/anim/ (animations proved too slow on
// the watch browser):
//  - <id>.jpg: 3D render at the peak of the movement (tools/render3d), for movements in RENDERED.
//    Cached by movement + muscles + RENDER_STYLE.
//  - <id>.png: the first frame of the dataset GIF, white backdrop darkened (no 3D movement, or the
//    exercise is overridden to 'gif'). Bump IMG_STYLE when that processing changes.
const IMG_STYLE = 'still-dark-v1';
const META = path.join(ANIM, 'meta.json');

// what the watch shows for each plan exercise: { id: { kind: '3d', key } | { kind: 'raster' } }
function imagePlan(plan) {
  const out = {};
  for (const w of plan.weeks) for (const d of w.days) for (const x of d.exercises) {
    const key = x.mo === 'gif' ? null : (x.mo || motionById.get(x.id)?.m);
    out[x.id] = key && RENDERED.has(key) ? { kind: '3d', key } : { kind: 'raster' };
  }
  return out;
}

async function syncImages(plan, onProgress = () => {}) {
  await mkdir(ANIM, { recursive: true });
  const want = imagePlan(plan);
  let meta = {};
  try { meta = JSON.parse(await readFile(META, 'utf8')); } catch {}
  const old = meta.images || {}, items = {};
  let rendered = 0;
  const exists = (f) => existsSync(path.join(ANIM, f));

  const jobs = [];
  for (const [id, w] of Object.entries(want)) {
    if (w.kind !== '3d') continue;
    const mi = motionById.get(id) || { p: [], s: [] }, sig = [w.key, mi.p.join('+'), mi.s.join('+'), RENDER_STYLE].join('|');
    const o = old[id];
    if (o && o.sig === sig && exists(o.file)) { items[id] = o; continue; }
    jobs.push({ id, key: w.key, p: mi.p, s: mi.s, sig });
  }
  if (jobs.length) {
    onProgress(`rendering ${jobs.length} 3D image${jobs.length === 1 ? '' : 's'}`);
    const res = await renderJobs(jobs.map(({ sig, ...j }) => j), ANIM, { onLog: (m) => { try { const j = JSON.parse(m); if (j.id) onProgress(`rendered ${j.id} (${j.key})`); } catch {} } });
    for (const j of jobs) {
      if (!res[j.id] || !exists(`${j.id}.jpg`)) throw new Error(`3D render produced nothing for ${j.id} (${j.key})`);
      items[j.id] = { sig: j.sig, file: `${j.id}.jpg`, v: Date.now().toString(36) };
      rendered++;
    }
  }
  for (const [id, w] of Object.entries(want)) {
    if (w.kind !== 'raster') continue;
    const o = old[id], sig = 'raster|' + IMG_STYLE;
    if (o && o.sig === sig && exists(o.file)) { items[id] = o; continue; }
    const { frames } = frameImages(darkBackground(decode(await readFile(gifById.get(id)))));
    await writeFile(path.join(ANIM, `${id}.png`), frames[0]);
    items[id] = { sig, file: `${id}.png`, v: Date.now().toString(36) };
  }

  // remove everything else: unused images, and old per-frame folders / videos
  const keep = new Set(Object.values(items).map((it) => it.file).concat('meta.json'));
  let removed = 0;
  for (const e of await readdir(ANIM, { withFileTypes: true })) {
    if (keep.has(e.name)) continue;
    await rm(path.join(ANIM, e.name), { recursive: true, force: true }); removed++;
  }
  await writeFile(META, JSON.stringify({ images: items }) + '\n');

  const img = {}, imgVer = {};
  for (const [id, it] of Object.entries(items)) { img[id] = it.file; imgVer[id] = it.v; }
  return { rendered, removed, total: Object.keys(want).length, img, imgVer };
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
    // movements available in the admin's per-exercise picker (the ones with a 3D animation)
    if (p === '/api/motions' && req.method === 'GET') return send(res, 200, Object.fromEntries(Object.entries(MOTIONS).filter(([k]) => RENDERED.has(k))));

    if (p === '/api/plan' && req.method === 'GET') {
      const txt = existsSync(PLAN) ? await readFile(PLAN, 'utf8') : '{"version":1,"days":[]}';
      return send(res, 200, txt);
    }

    if (p === '/api/plan' && req.method === 'PUT') {
      await loadLibrary();
      const plan = validatePlan(JSON.parse(await readBody(req)));
      const t0 = Date.now();
      const { img, imgVer, ...gifs } = await syncImages(plan, (m) => console.log('  ' + m));
      plan.img = img;           // { id: '<id>.jpg' (3D still) | '<id>.png' (original, first frame) } under anim/
      plan.imgVer = imgVer;     // { id: cache tag } — images are served with a 1-week max-age
      await writeFile(PLAN, JSON.stringify(plan, null, 2) + '\n');
      return send(res, 200, { ok: true, updatedAt: plan.updatedAt, gifs, seconds: Math.round((Date.now() - t0) / 1000) });
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

// a first Save can render many 3D images (a few seconds each): don't let Node cut the request off
server.requestTimeout = 0; server.timeout = 0;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  WristPlan admin →  http://localhost:${PORT}\n`);
});
