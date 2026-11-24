// 3D exercise renderer driver (zero dependencies).
// Serves render.html + the model to a headless Chromium browser (Brave or Chrome, WebGL via
// SwiftShader), hands it a job list, and writes the frames it POSTs back.
//
//   import { renderJobs } from './tools/render3d/render.mjs'
//   await renderJobs([{ id: '0025', key: 'bench', p: ['chest'], s: ['triceps'] }], 'site/anim')
//     → frames at site/anim/0025/0.jpg … ; resolves to { '0025': { frames, fps }, … }
//
// CLI (preview strips for reviewing a movement):  node tools/render3d/render.mjs strip bench [outDir]
import http from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const MODEL = path.join(DIR, 'man.glb');
// bump when render.html changes in a way that should re-render every animation
export const RENDER_STYLE = 'r3d-v3';

const BROWSERS = [
  process.env.BROWSER,
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean);
export const findBrowser = () => BROWSERS.find((b) => existsSync(b));

const body = (req) => new Promise((ok, bad) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); req.on('error', bad); });

function run(query, outDir, jobs, { onLog = () => {}, timeoutMs = 30 * 60 * 1000 } = {}) {
  const browserPath = findBrowser();
  if (!browserPath) return Promise.reject(new Error('3D rendering needs Brave or Google Chrome installed (or set BROWSER).'));
  if (!existsSync(MODEL)) return Promise.reject(new Error('3D model missing. Run:  npm run setup'));
  return new Promise((resolve, reject) => {
    let browser, timer, finished = false;
    const results = {}, errors = [];
    const finish = (err) => {
      if (finished) return; finished = true;
      clearTimeout(timer); browser?.kill(); server.close();
      if (err) reject(err); else if (errors.length) reject(new Error(errors.join('\n'))); else resolve(results);
    };
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      try {
        if (req.method === 'POST' && url.pathname === '/log') {
          const msg = (await body(req)).toString();
          if (/^(ERROR|REJECT)/.test(msg)) errors.push(msg);
          else { try { const j = JSON.parse(msg); if (j.id) results[j.id] = { frames: j.frames, fps: j.fps }; } catch {} }
          onLog(msg); return res.end('ok');
        }
        if (req.method === 'POST' && url.pathname === '/frame') {
          const rel = url.searchParams.get('path') || '';
          if (!/^[\w-]+(\/[\w-]+)*\.(jpg|png)$/.test(rel)) { res.statusCode = 400; return res.end('bad path'); }
          const file = path.join(outDir, rel);
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, Buffer.from((await body(req)).toString().replace(/^data:image\/\w+;base64,/, ''), 'base64'));
          return res.end('ok');
        }
        if (req.method === 'POST' && url.pathname === '/done') { res.end('ok'); return setTimeout(() => finish(), 50); }
        if (url.pathname === '/jobs.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(jobs || [])); }
        const files = { '/render.html': ['render.html', 'text/html'], '/man.glb': ['man.glb', 'model/gltf-binary'] };
        const f = files[url.pathname];
        if (!f) { res.statusCode = 404; return res.end(); }
        res.writeHead(200, { 'Content-Type': f[1] }); res.end(await readFile(path.join(DIR, f[0])));
      } catch (e) { res.statusCode = 500; res.end(String(e.message)); }
    });
    server.listen(0, '127.0.0.1', () => {
      const profile = path.join(os.tmpdir(), 'wristplan-render-' + process.pid + '-' + Date.now());
      browser = spawn(browserPath, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars',
        '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--window-size=800,800',
        `http://127.0.0.1:${server.address().port}/render.html?${query}`], { stdio: 'ignore' });
      browser.on('exit', () => setTimeout(() => { if (!finished) finish(new Error('browser exited before finishing')); rm(profile, { recursive: true, force: true }).catch(() => {}); }, 300));
      timer = setTimeout(() => finish(new Error('3D render timed out')), timeoutMs);
    });
  });
}

// Encode an exercise's frames (<dir>/0.jpg …) into a small looping MP4 (H.264 baseline, muted).
// Watch browsers that play inline video use it (hardware-decoded, smooth); others fall back to the frames.
// Resolves false when ffmpeg isn't installed.
export function encodeLoop(dir, fps) {
  const ffmpeg = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find((f) => existsSync(f)) || 'ffmpeg';
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, '%d.jpg'),
      '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.0', '-pix_fmt', 'yuv420p', '-crf', '24', '-g', String(fps * 2),
      '-movflags', '+faststart', '-an', path.join(dir, 'loop.mp4')], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0));
  });
}

export function renderJobs(jobs, outDir, opts) {
  if (!jobs.length) return Promise.resolve({});
  return run('mode=batch', outDir, jobs, opts);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, key, out = path.join(os.tmpdir(), 'wristplan-strips')] = process.argv.slice(2);
  if (cmd !== 'strip' || !key) { console.log('usage: node tools/render3d/render.mjs strip <movement> [outDir]'); process.exit(1); }
  run(`mode=strip&ex=${encodeURIComponent(key)}&n=6`, out, [], { onLog: console.log })
    .then(() => console.log(`→ ${path.join(out, `strip-${key}.png`)}`))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
