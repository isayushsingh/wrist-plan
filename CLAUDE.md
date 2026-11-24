# WristPlan

A minimal dark-mode workout viewer for Apple Watch, plus a local admin portal on the laptop.
The owner uses it at the gym. The watch shows only the **exercise name and a looping animation**. There is **no tracking**: no sets, reps, timers, HealthKit or logging. Keep it that way unless he asks.

## Why it's a web page (decided, don't revisit)
- A native watchOS app needs the paid Apple Developer Program ($99/yr) to stay installed. With a free Apple ID it expires every 7 days. The owner wants a free solution.
- Expo/React Native can't build watch UI, and EAS iOS device builds need a paid account.
- Chosen approach: a static page on Vercel, opened in a free third-party watch browser (Fern Browser / Searchino) and bookmarked there.

## Structure
```
admin/server.mjs   Node http server, zero deps, binds 127.0.0.1:4321 (PORT env)
admin/index.html   admin UI (vanilla JS, single file)
admin/motion-map.mjs  MOTIONS (key → label) + name rules mapping dataset exercises to vector movements, dataset muscles → figure muscles, equipment → held prop
admin/gif.mjs      zero-dep GIF decoder + darkBackground() (white backdrop → #000) + frameImages() (one indexed PNG per frame); also a GIF encoder, currently unused
site/              deployed as-is (vercel.json → outputDirectory: "site", no build)
  index.html       watch UI (vanilla JS, single file, ES5-ish for old WebKit); first <script> is the `Motion` vector-animation library
  plan.json        source of truth, written only by admin Save
  anim/<id>/<n>.png  raster fallback frames (180×180 each), only for plan exercises shown with the original animation (no vector movement, or overridden to 'gif')
  anim/meta.json   processing version + frame delays cache; if its style differs from ANIM_STYLE in server.mjs, every animation is regenerated on the next Save
scripts/setup.mjs  shallow-clones the dataset into ./dataset (gitignored, ~300 MB)
dataset/           github.com/hasaneyldrm/exercises-dataset
```

Commands: `npm run setup` (one-time), `npm run admin` → http://localhost:4321

## Data
plan.json:
```json
{ "version": 2, "updatedAt": "ISO", "attribution": "© Gym visual — https://gymvisual.com/",
  "weekAnchor": "2026-11-23",
  "weeks": [
    { "id": "A", "name": "Week A", "days": [ { "id": "push", "name": "Push", "exercises": [ { "id": "0025", "label": "Bench Press", "mo": "bench" } ] } ] },
    { "id": "B", "name": "Week B", "days": [ ... ] } ] }
```
- **Alternating weeks:** the weeks rotate A, B, A, B, … every Monday, continuously, not reset per month. `weekAnchor` is a Monday on which `weeks[0]` starts, and current week = `floor(daysSince(anchor) / 7) mod weeks.length` in local time. The admin's "Make this week" button rewrites the anchor. The server accepts 1–4 weeks; the admin UI assumes two.
- Day ids must be unique across all weeks, because `wp.lastDay` stores one. The server de-dupes them.
- v1 plans (a top-level `days` array) are still accepted everywhere. The admin migrates one on load into Week A plus a copy as Week B; the watch treats it as a single week.
- `id` is the 4-digit dataset id. `label` is the display name shown on the watch. `mo` (optional) overrides the animation: a movement key, or `"gif"` for the original raster animation.
- Written by Save: `motion` (id → `{ m: movement key | null, eq: bb|db|kb|cable|machine|bw, p: [primary muscles], s: [secondary] }`), `anim` (id → raster frame delays) and `animV`.
- Dataset `data/exercises.json` is an array of objects with `id, name, target, body_part, equipment, image (180px jpg), gif_url (180px gif)`. Some names contain the mojibake `в°`, which `cleanName()` turns into `°`.

## Admin server API
- `GET /api/exercises`: slim library list, each with `motion` (auto-matched movement key or null)
- `GET /api/motions`: movement key → label (for the admin's per-exercise "Animation" picker)
- `GET|PUT /api/plan`: the PUT validates ids against the dataset (this also guards against path traversal), adds `motion`, builds or removes raster frames in site/anim (only where needed), adds `anim` (id → frame delays in ms) and `animV` (cache-buster) to the plan, and writes plan.json
- `POST /api/publish`: `git add site && git commit && git push`. Vercel auto-deploys from GitHub.
- `/preview/*` serves site/. The admin embeds it in a 198×242 iframe as the "watch preview".
- `/dataset/*` serves dataset media. `serveFile` blocks paths that escape the base folder.

## Watch UI behaviour
- Home: Week A / Week B tabs (a lime dot marks the calendar's current week; tapping the other only changes the view and resets when the page returns to the foreground), then that week's days. In the current week, the day after the last-opened day gets an accent outline and "Up next". The last-opened day is stored in localStorage (`wp.lastDay`); every storage call is wrapped in try/catch.
- Exercise screen:
  - **Vector animations (default).** The raster source is only 180px, and the watch upscales and resamples it, so it always looked blurry on the device. `Motion` (top of site/index.html) draws a stylised SVG figure instead, which stays sharp at any size:
    - 2-bone IK rig: a pose gives the hip position, torso angle `t`, hand targets `a1/a2`, ankle targets `l1/l2`, and optional `hd` (head angle), `eb/kb` (elbow/knee bend side), `f1` (foot angle), `thf` (thigh foreshortening), `sg` (shrug). Angles use dir(a) = (sin a, cos a): 0 down, 90 right, 180 up, -90 left. Side-view figures face right.
    - Each movement is two poses A and B plus `dur` [hold A, A→B, hold B, B→A] and `sq` (the pose where muscles contract). Views: 's' side, 'f' front, 't' top-down. Equipment is drawn from the joints in `eq()`.
    - Muscles (`chest abs lats traps lowerback delts biceps triceps forearms glutes quads hamstrings calves`) are drawn as glowing strokes on body segments (MUS_S / MUS_F tables): primary brighter than secondary, both pulsing with contraction.
    - Rendering pools SVG elements and updates attributes every 33 ms via setTimeout.
    - **Adding a movement:** `def()` it in site/index.html *and* add its key + label to `MOTIONS` (and a name rule) in admin/motion-map.mjs.
  - Raster fallback: the animation sits directly on the black page because its white backdrop is pre-darkened (see below).
  - **No GIFs on the watch.** Some watch browsers only show a GIF's first frame. All frames `anim/<id>/<n>.png?v=<animV>` are stacked as `<img>`s in the square `.tile`, and `setTimeout` flips which one has `.on`, using the `plan.anim[id]` delays. A frame that hasn't loaded yet is waited for, not skipped.
  - **Never one big image.** watchOS downsamples large images: a 180×2160 sprite sheet showed up blurry and blocky on a real watch. Keep every image at 180×180. Playback stops on home/done and while the page is hidden.
  - The name sits below the animation, with "Day · n of N" underneath.
  - Segmented progress bar at the top.
  - Invisible tap zones: the left 34% goes to the previous exercise, the right 66% to the next. Swipe also works. On the first exercise, "previous" only nudges; the ‹ button leaves.
  - Opening a day preloads every raster frame of that day (vectors need no download), so a dropped connection mid-workout still works.
  - The tile is square, sized `60vh` and capped at 180px (never upscaled). `.name` is wrapped in a plain div because line-clamp breaks on flex items.
- After the last exercise, a "<Day> done" screen appears, showing the next day (or the next week's first day after a week's last day). Taps within 600ms are ignored, and a tap after that returns home.
- Old-WebKit safety: no flex `gap`, no `aspect-ratio`, no `fetch` (XHR), no arrow functions or `const`.
- plan.json is fetched with a cache-busting query. The last good copy is cached in localStorage (`wp.plan`) as an offline fallback; home shows "Offline · saved plan" when that copy is in use. It refetches on `visibilitychange` while on the home screen.
- Sizing uses vw units throughout for small watch viewports. The design target is roughly 184–205px wide.

## Raster fallback processing (admin Save)
- `darkBackground()` flood-fills pure-white (≥254) pixels from the frame edges to black, then fades the light anti-aliased rim pixels toward black.
  - It works edge-only on purpose: enclosed white areas are the machines' white panels and frames, which must stay white.
  - The threshold is 254 because the figure has many 230–253 highlights.
- `frameImages()` merges identical consecutive frames and writes each frame as an 8-bit indexed PNG; all frames of an exercise share one palette.
  - The palette is the 256 most frequent colours; rare faded-rim shades snap to the nearest one.
  - Delays of 0–1 cs become 100 ms, matching what browsers do with GIFs.
  - About 7 KB per frame, roughly 90 KB per exercise.
- Known trade-off: very dark equipment (black benches, dumbbells) has less contrast against the black page.
- If you change the processing, bump `ANIM_STYLE` in server.mjs.

## Design
- Minimal, dark, OLED black (`#000`).
- Text `#f5f5f7`, dim `#8e8e93`, cards `#141416`, single accent `#c7f464` (lime).
- System font (SF). No frameworks, no build step. Keep both pages single-file.

## Constraints
- The vector figures and movements are original to this project. Media © Gym visual (raster fallback, admin library) is redistributed with permission. Rules:
  - Keep the attribution visible.
  - Keep the original 180×180 size (no upscaling).
  - Only the white backdrop is recoloured (for the dark UI); the figure and the animation are untouched.
  - The Vercel site is for personal use only.
- Watch browsers have limited WebKit: avoid modern-only APIs on `site/index.html`, don't rely on service workers, and keep the page light.
- Owner's stack familiarity: Next.js, React, Tailwind, Vercel. Don't migrate this project to them unless asked; zero-dep is intentional.

## Status
- Done:
  - Admin portal: search, filters, add/rename/reorder/delete, live preview, Save and Publish
  - Watch page
  - Sample 6-day plan: Push / Legs / Pull / Push Volume / Legs & Core / Arms. It's placeholder data; the owner will replace it with his trainer's list.
  - Git repo (github.com/isayushsingh/wrist-plan) and Vercel deploy
  - Two alternating weeks (2026-11-24)
  - Black-backdrop animations as JS-stepped per-frame PNGs (2026-11-24)
    - Ant Browser on the watch showed GIFs as static images.
    - A single tall sprite sheet animated but came out blurry, because watchOS downsampled it.
    - Per-frame images were still blurry on the device: the 180px source is simply too small for the watch.
  - Vector SVG animations with muscle highlights (2026-11-24): 39 movements, covering all 30 plan exercises and ~76% of the 1,324-exercise library; the rest (mostly stretches and cardio) fall back to raster. Not yet tested on the device.
  - UI polish pass (2026-11-24): admin has SVG icons, a watch-size switcher (41/45/49mm), `/` to focus search, a responsive layout, and keeps working when the dataset is missing
- Not yet done:
  - Real-device test on an Apple Watch browser
- Possible next steps, only if asked:
  - Import the trainer's list from pasted text (fuzzy-match to dataset ids)
  - A watch-side "today" override