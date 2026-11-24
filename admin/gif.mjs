// Minimal zero-dependency GIF decoder/encoder, plus darkBackground():
// turns the dataset's white backdrop into black so the animation sits directly on the OLED page.
//
// decode()  -> { width, height, loop, frames: [{ rgba: Uint8Array(w*h*4), delay }] }  (fully composited frames)
// encode()  <- the same shape; writes delta frames (unchanged pixels transparent) with a local palette each.

import zlib from 'node:zlib';

// ---------- decode ----------
export function decode(buf) {
  let p = 0;
  const u8 = () => buf[p++];
  const u16 = () => { const v = buf[p] | (buf[p + 1] << 8); p += 2; return v; };
  const sig = buf.toString('latin1', 0, 6);
  if (sig !== 'GIF89a' && sig !== 'GIF87a') throw new Error('not a GIF');
  p = 6;
  const width = u16(), height = u16(), flags = u8(); u8(); u8(); // bg index, aspect
  const readTable = (n) => { const t = buf.subarray(p, p + n * 3); p += n * 3; return t; };
  const gct = flags & 0x80 ? readTable(1 << ((flags & 7) + 1)) : null;

  const canvas = new Uint8Array(width * height * 4); // alpha 0 = nothing drawn yet
  const frames = [];
  let gce = { disposal: 0, delay: 10, transparent: -1 }, loop = 0;

  const subBlocks = () => {
    const parts = [];
    for (let n = u8(); n; n = u8()) { parts.push(buf.subarray(p, p + n)); p += n; }
    return Buffer.concat(parts);
  };

  while (p < buf.length) {
    const b = u8();
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        u8(); const f = u8(), delay = u16(), ti = u8(); u8();
        gce = { disposal: (f >> 2) & 7, delay, transparent: f & 1 ? ti : -1 };
      } else if (label === 0xff) {
        const data = subBlocks();
        if (data.toString('latin1', 0, 11) === 'NETSCAPE2.0') loop = data[13] | (data[14] << 8);
      } else subBlocks();
      continue;
    }
    if (b !== 0x2c) throw new Error('bad GIF block 0x' + b.toString(16));

    const fx = u16(), fy = u16(), fw = u16(), fh = u16(), ff = u8();
    const table = ff & 0x80 ? readTable(1 << ((ff & 7) + 1)) : gct;
    const interlaced = !!(ff & 0x40);
    const minCode = u8();
    const idx = lzwDecode(subBlocks(), minCode, fw * fh);

    const before = gce.disposal === 3 ? canvas.slice() : null;
    const rows = interlaced ? interlaceOrder(fh) : null;
    for (let r = 0; r < fh; r++) {
      const y = fy + (rows ? rows[r] : r);
      if (y >= height) continue;
      for (let x = 0; x < fw; x++) {
        const ci = idx[r * fw + x];
        if (ci === gce.transparent || fx + x >= width) continue;
        const o = (y * width + fx + x) * 4;
        canvas[o] = table[ci * 3]; canvas[o + 1] = table[ci * 3 + 1]; canvas[o + 2] = table[ci * 3 + 2]; canvas[o + 3] = 255;
      }
    }
    frames.push({ rgba: canvas.slice(), delay: gce.delay });

    if (gce.disposal === 2) {
      for (let y = fy; y < Math.min(fy + fh, height); y++)
        canvas.fill(0, (y * width + fx) * 4, (y * width + Math.min(fx + fw, width)) * 4);
    } else if (before) canvas.set(before);
    gce = { disposal: 0, delay: 10, transparent: -1 };
  }
  return { width, height, loop, frames };
}

function interlaceOrder(h) {
  const rows = [];
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) rows.push(y);
  return rows;
}

function lzwDecode(data, minCode, n) {
  const out = new Uint8Array(n);
  const clear = 1 << minCode, eoi = clear + 1;
  const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096), len = new Int32Array(4096);
  for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; first[i] = i; len[i] = 1; }
  let size = minCode + 1, next = eoi + 1, prev = -1, op = 0, bits = 0, acc = 0, dp = 0;
  while (op < n) {
    while (bits < size && dp < data.length) { acc |= data[dp++] << bits; bits += 8; }
    if (bits < size) break;
    const code = acc & ((1 << size) - 1); acc >>>= size; bits -= size;
    if (code === clear) { size = minCode + 1; next = eoi + 1; prev = -1; continue; }
    if (code === eoi) break;
    let c = code;
    if (code >= next) { // KwKwK case
      if (prev < 0) break;
      c = prev;
    }
    // write string for c (backwards)
    const l = len[c];
    let q = c, end = op + l + (code >= next ? 1 : 0);
    for (let i = op + l - 1; i >= op; i--) { if (i < n) out[i] = suffix[q]; q = prefix[q]; }
    if (code >= next && op + l < n) out[op + l] = first[prev];
    op = Math.min(end, n);
    if (prev >= 0 && next < 4096) {
      prefix[next] = prev; suffix[next] = first[code < next ? code : prev]; first[next] = first[prev]; len[next] = len[prev] + 1; next++;
      if (next === 1 << size && size < 12) size++;
    }
    prev = code;
  }
  return out;
}

// ---------- encode ----------
export function encode({ width, height, loop = 0, frames }) {
  const chunks = [];
  const push = (...bytes) => chunks.push(Buffer.from(bytes));
  const u16 = (v) => [v & 255, v >> 8];
  chunks.push(Buffer.from('GIF89a', 'latin1'));
  push(...u16(width), ...u16(height), 0x00, 0, 0);               // no global table
  push(0x21, 0xff, 11); chunks.push(Buffer.from('NETSCAPE2.0', 'latin1')); push(3, 1, ...u16(loop), 0);

  let prev = null;
  for (const f of frames) {
    // bounding box of pixels that changed since the previous frame
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (!prev || prev[o] !== f.rgba[o] || prev[o + 1] !== f.rgba[o + 1] || prev[o + 2] !== f.rgba[o + 2]) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) { x0 = y0 = 0; x1 = y1 = 0; } // identical frame: emit a 1px no-op so timing is kept
    const fw = x1 - x0 + 1, fh = y1 - y0 + 1;

    // palette: index 0 = transparent ("same as before"), then the frame's colours
    const colors = new Map(), pal = [0, 0, 0], idx = new Uint8Array(fw * fh);
    let over = false;
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const o = ((y0 + y) * width + x0 + x) * 4;
      if (prev && prev[o] === f.rgba[o] && prev[o + 1] === f.rgba[o + 1] && prev[o + 2] === f.rgba[o + 2]) continue;
      const key = (f.rgba[o] << 16) | (f.rgba[o + 1] << 8) | f.rgba[o + 2];
      let ci = colors.get(key);
      if (ci === undefined) {
        if (colors.size < 255) { ci = colors.size + 1; colors.set(key, ci); pal.push(f.rgba[o], f.rgba[o + 1], f.rgba[o + 2]); }
        else { over = true; ci = nearest(pal, f.rgba[o], f.rgba[o + 1], f.rgba[o + 2]); }
      }
      idx[y * fw + x] = ci;
    }
    void over;
    const bitsNeeded = Math.max(1, Math.ceil(Math.log2(pal.length / 3)));
    while (pal.length < (1 << bitsNeeded) * 3) pal.push(0);

    push(0x21, 0xf9, 4, (1 << 2) | 1, ...u16(f.delay), 0, 0);       // disposal 1 (keep), transparent idx 0
    push(0x2c, ...u16(x0), ...u16(y0), ...u16(fw), ...u16(fh), 0x80 | (bitsNeeded - 1));
    chunks.push(Buffer.from(pal));
    const minCode = Math.max(2, bitsNeeded);
    push(minCode);
    const data = lzwEncode(idx, minCode);
    for (let i = 0; i < data.length; i += 255) { const s = data.subarray(i, i + 255); push(s.length); chunks.push(Buffer.from(s)); }
    push(0);
    prev = f.rgba;
  }
  push(0x3b);
  return Buffer.concat(chunks);
}

function nearest(pal, r, g, b) {
  let best = 1, bd = Infinity;
  for (let i = 3; i < pal.length; i += 3) {
    const d = (pal[i] - r) ** 2 + (pal[i + 1] - g) ** 2 + (pal[i + 2] - b) ** 2;
    if (d < bd) { bd = d; best = i / 3; }
  }
  return best;
}

function lzwEncode(idx, minCode) {
  const clear = 1 << minCode, eoi = clear + 1, out = [];
  let size = minCode + 1, next = eoi + 1, acc = 0, bits = 0;
  const emit = (c) => { acc |= c << bits; bits += size; while (bits >= 8) { out.push(acc & 255); acc >>>= 8; bits -= 8; } };
  let dict = new Map();
  emit(clear);
  let w = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], key = w * 256 + k, hit = dict.get(key);
    if (hit !== undefined) { w = hit; continue; }
    emit(w);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << size) && size < 12) size++;
    } else { emit(clear); dict = new Map(); size = minCode + 1; next = eoi + 1; }
    w = k;
  }
  emit(w); emit(eoi);
  if (bits > 0) out.push(acc & 255);
  return Uint8Array.from(out);
}

// ---------- white backdrop -> black ----------
// Flood-fills the near-white background from the frame edges (so light parts of the figure that
// don't touch the backdrop are kept), then darkens the anti-aliased rim pixels toward black.
export function darkBackground(gif, { hard = 254, soft = 200 } = {}) {
  const { width: w, height: h } = gif;
  const isBg = (px, o) => px[o + 3] === 0 || (px[o] >= hard && px[o + 1] >= hard && px[o + 2] >= hard);
  for (const f of gif.frames) {
    const px = f.rgba, bg = new Uint8Array(w * h), stack = [];
    const seed = (x, y) => { const i = y * w + x; if (!bg[i] && isBg(px, i * 4)) { bg[i] = 1; stack.push(i); } };
    for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
    for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      if (x > 0) seed(x - 1, y); if (x < w - 1) seed(x + 1, y);
      if (y > 0) seed(x, y - 1); if (y < h - 1) seed(x, y + 1);
    }
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (bg[i]) { px[o] = px[o + 1] = px[o + 2] = 0; px[o + 3] = 255; continue; }
      // rim: a light pixel touching the backdrop is part white; fade it toward black
      const x = i % w, y = (i / w) | 0;
      const touches = (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (y > 0 && bg[i - w]) || (y < h - 1 && bg[i + w]);
      if (!touches) continue;
      const m = Math.min(px[o], px[o + 1], px[o + 2]);
      if (m <= soft) continue;
      const t = (hard - m) / (hard - soft); // 1 at soft (keep) .. 0 at hard (black)
      const k = 0.25 + 0.75 * Math.max(0, Math.min(1, t));
      px[o] = Math.round(px[o] * k); px[o + 1] = Math.round(px[o + 1] * k); px[o + 2] = Math.round(px[o + 2] * k);
    }
  }
  return gif;
}

// ---------- sprite sheet ----------
// Some watch browsers show only the first frame of a GIF. So the watch page animates a vertical
// sprite sheet (all frames stacked, one 8-bit indexed PNG) with JS timers instead.
// Returns { png: Buffer, delays: [ms per frame] }.
export function spriteSheet(gif) {
  const { width: w, height: fh } = gif;
  // merge consecutive identical frames; browsers treat delays of 0–1 cs as 100 ms
  const frames = [];
  for (const f of gif.frames) {
    const ms = (f.delay <= 1 ? 10 : f.delay) * 10, last = frames[frames.length - 1];
    if (last && sameRGB(last.rgba, f.rgba)) last.ms += ms; else frames.push({ rgba: f.rgba, ms });
  }
  // palette: the 256 most frequent colours; rare ones (faded rim shades) snap to the nearest
  const count = new Map();
  for (const f of frames) for (let o = 0; o < f.rgba.length; o += 4) {
    const k = (f.rgba[o] << 16) | (f.rgba[o + 1] << 8) | f.rgba[o + 2];
    count.set(k, (count.get(k) || 0) + 1);
  }
  const keys = [...count.keys()].sort((a, b) => count.get(b) - count.get(a));
  const pal = keys.slice(0, 256), index = new Map(pal.map((k, i) => [k, i]));
  for (const k of keys.slice(256)) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < pal.length; i++) {
      const d = ((k >> 16) - (pal[i] >> 16)) ** 2 + (((k >> 8) & 255) - ((pal[i] >> 8) & 255)) ** 2 + ((k & 255) - (pal[i] & 255)) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    index.set(k, best);
  }
  const h = fh * frames.length, raw = Buffer.alloc((w + 1) * h); // filter byte 0 per row
  frames.forEach((f, n) => {
    for (let y = 0; y < fh; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      raw[(n * fh + y) * (w + 1) + 1 + x] = index.get((f.rgba[o] << 16) | (f.rgba[o + 1] << 8) | f.rgba[o + 2]);
    }
  });
  const plte = Buffer.alloc(pal.length * 3);
  pal.forEach((k, i) => { plte[i * 3] = k >> 16; plte[i * 3 + 1] = (k >> 8) & 255; plte[i * 3 + 2] = k & 255; });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 3; // 8-bit, indexed
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
  return { png, delays: frames.map((f) => f.ms) };
}

function sameRGB(a, b) {
  for (let o = 0; o < a.length; o += 4) if (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2]) return false;
  return true;
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function chunk(type, data) {
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  let c = -1; for (const b of td) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); td.copy(out, 4); out.writeUInt32BE((c ^ -1) >>> 0, 8 + data.length);
  return out;
}
