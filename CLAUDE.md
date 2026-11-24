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
admin/motion-map.mjs  MOTIONS (key → label), RENDERED (keys with a 3D animation), name rules mapping dataset exercises to movements, dataset muscles → render muscles, equipment
tools/render3d/render.html  three.js scene (CDN three@0.160.0): CC0 character, IK rig, equipment, EX[key] movements, muscle shader; modes ?mode=strip&ex=<key> and ?mode=batch
tools/render3d/render.mjs   zero-dep driver: serves render.html + man.glb to headless Brave/Chrome (SwiftShader WebGL), feeds /jobs.json, writes POSTed frames; renderJobs(), RENDER_STYLE
tools/render3d/man.glb      CC0 "Man Base Mesh" (Grab3D), 11 MB, gitignored, downloaded by npm run setup
admin/gif.mjs      zero-dep GIF decoder + darkBackground() (white backdrop → #000) + frameImages() (one indexed PNG per frame); also a GIF encoder, currently unused
site/              deployed as-is (vercel.json → outputDirectory: "site", no build)
  index.html       watch UI (vanilla JS, single file, ES5-ish for old WebKit)
  plan.json        source of truth, written only by admin Save
  anim/<id>/<n>.jpg  3D-rendered frames (288×288, 12 fps, ~200 KB per exercise), for plan exercises whose movement is in RENDERED
  anim/<id>/loop.mp4 the same 3D loop as a muted H.264 video (~30 KB), made by ffmpeg on Save when available
  check.html       diagnostic page for the watch browser: inline-video support, timer speed, frame download time
  anim/<id>/<n>.png  raster fallback frames (180×180), for exercises with no 3D movement or overridden to 'gif'
  anim/meta.json   per-id cache: 3D {sig: key|muscles|RENDER_STYLE, n, ms} or raster {style: ANIM_STYLE, delays}; changed entries are regenerated on Save
scripts/setup.mjs  shallow-clones the dataset into ./dataset (gitignored, ~300 MB)
dataset/           github.com/hasaneyldrm/exercises-dataset
```

Commands: `npm run setup` (one-time: dataset + 3D model), `npm run admin` → http://localhost:4321
Review a movement while tuning it: `npm run strip -- <key> [outDir]` → strip-<key>.png with 6 stills across the rep.

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
- Written by Save: `anim` (id → frame delays in ms), `animExt` (id → 'jpg' 3D | 'png' raster), `animVer` (id → cache tag; frames are served with a 1-week max-age), `animVideo` (id → 1 when loop.mp4 exists). Older plans may still carry `motion`/`animV`; they're ignored.
- Dataset `data/exercises.json` is an array of objects with `id, name, target, body_part, equipment, image (180px jpg), gif_url (180px gif)`. Some names contain the mojibake `в°`, which `cleanName()` turns into `°`.

## Admin server API
- `GET /api/exercises`: slim library list, each with `motion` (auto-matched movement key or null)
- `GET /api/motions`: movement key → label, only movements in RENDERED (the admin's per-exercise "Animation" picker)
- `GET|PUT /api/plan`: the PUT validates ids against the dataset (this also guards against path traversal), runs `syncAnims()` (3D renders for new/changed exercises in one headless-browser session, raster frames for the rest, removes unused folders), adds `anim`/`animExt`/`animVer`, and writes plan.json. A first Save of 30 exercises takes ~3.5 min, so the server's request timeout is disabled.
- `POST /api/publish`: `git add site && git commit && git push`. Vercel auto-deploys from GitHub.
- `/preview/*` serves site/. The admin embeds it in a 198×242 iframe as the "watch preview".
- `/dataset/*` serves dataset media. `serveFile` blocks paths that escape the base folder.

## Watch UI behaviour
- Home: Week A / Week B tabs (a lime dot marks the calendar's current week; tapping the other only changes the view and resets when the page returns to the foreground), then that week's days. In the current week, the day after the last-opened day gets an accent outline and "Up next". The last-opened day is stored in localStorage (`wp.lastDay`); every storage call is wrapped in try/catch.
- Exercise screen:
  - **3D animations (default).** The dataset's raster animations are only 180px, so they always looked blurry on the watch (GIF, sprite sheet and per-frame PNGs were all tried). Each exercise is instead rendered on the laptop by tools/render3d into 288×288 JPEG frames (2× the tile) plus a loop.mp4.
  - **Playback (performance matters: the first 3D version was "almost not running" on the watch).** Opening a day used to request every frame of every exercise at once, so the exercise on screen starved behind ~185 downloads. Now:
    - Video first: if `animVideo[id]`, play loop.mp4 muted inline. Support is unknown until tested, so while testing the frames play underneath (no stall either way); the first that actually advances wins, and the result is stored in localStorage `wp.video` ('1'/'0'). If the video has data but doesn't advance within 3 s (or 12 s total), the browser is marked as no-video.
    - Frames: only the current exercise's `<img>`s are in the DOM. After they've all loaded, the rest of the day prefetches one exercise at a time, 2 requests in flight, without keeping Image objects (the HTTP cache holds them). Prefetch pauses whenever a new exercise is shown.
    - `site/check.html` reports what a watch browser can do; ask the owner to open it when playback misbehaves.
  - Earlier attempts, don't repeat: hand-drawn SVG vector figures (sharp, but the owner found them too crude) and the raw 180px media (blurry).
  - Raster fallback: the animation sits directly on the black page because its white backdrop is pre-darkened (see below).
  - **No GIFs on the watch.** Some watch browsers only show a GIF's first frame. All frames `anim/<id>/<n>.png?v=<animV>` are stacked as `<img>`s in the square `.tile`, and `setTimeout` flips which one has `.on`, using the `plan.anim[id]` delays. A frame that hasn't loaded yet is waited for, not skipped.
  - **Never one big image.** watchOS downsamples large images: a 180×2160 sprite sheet showed up blurry and blocky on a real watch. Keep every image at 180×180. Playback stops on home/done and while the page is hidden.
  - The name sits below the animation, with "Day · n of N" underneath.
  - Segmented progress bar at the top.
  - Invisible tap zones: the left 34% goes to the previous exercise, the right 66% to the next. Swipe also works. On the first exercise, "previous" only nudges; the ‹ button leaves.
  - The whole day is prefetched in the background (see Playback), so a dropped connection mid-workout still works.
  - The tile is square, sized `60vh` and capped at 180px CSS (3D frames are 288px, so they're downscaled, never upscaled). `.name` is wrapped in a plain div because line-clamp breaks on flex items.
- After the last exercise, a "<Day> done" screen appears, showing the next day (or the next week's first day after a week's last day). Taps within 600ms are ignored, and a tap after that returns home.
- Old-WebKit safety: no flex `gap`, no `aspect-ratio`, no `fetch` (XHR), no arrow functions or `const`.
- plan.json is fetched with a cache-busting query. The last good copy is cached in localStorage (`wp.plan`) as an offline fallback; home shows "Offline · saved plan" when that copy is in use. It refetches on `visibilitychange` while on the home screen.
- Sizing uses vw units throughout for small watch viewports. The design target is roughly 184–205px wide.

## 3D renderer (tools/render3d)
- Character: CC0 "Man Base Mesh" (T-shirt + shorts, 24 bones: Hips → Spine02 → Spine01 → Spine → neck → Head; Left/Right Shoulder, Arm, ForeArm, Hand; UpLeg, Leg, Foot, ToeBase). Metres, faces +Z, character's left = +X. No finger bones.
- `curlFingers()` bends the hand mesh into a grip (three joints per finger, thumb outside the finger span curls less) using each vertex's real skinning matrix. Never read `.array` of skin attributes directly: they're interleaved, use getX/getY/getZ/getW.
- Posing: `setHips(pos, bodyQ)`, `rotLocal(bone, x, y, z)`, `solveLimb()` analytic 2-bone IK with a pole (direction the elbow/knee points), `grip(side, point, palmNormal, pole)` (iterates so the palm lands on the point, wrist follows the forearm), `leg(side, ankle, pole, toeDir, up)`, `setHand`, `setFoot`. `palm(side)` = grip centre, where held equipment is placed.
- Each EX[key]: `muscles` default, `cam: { dir, fov }` (auto-fit over the whole rep by `fitCamera`), `tl` timeline of [duration, from, to] segments with minimum-jerk easing (realistic tempo: slower lowering, pauses), `setup()` adds equipment to the scene, `fit()` returns objects the camera must include, `pose(p, t, dt)` with p = 0…1 through the rep, `setMuscle()` sets contraction for the glow.
- Muscles are painted per vertex from the bind pose (bone segments + surface normal) and tinted in the material shader; intensity follows contraction. Names: chest abs lats traps lowerback delts biceps triceps forearms glutes quads hamstrings calves.
- Output: 288 px JPEG (quality 0.8, rendered at 2× and downsampled) with a 10% black edge fade so the tile blends into the black page. `encodeLoop()` in render.mjs turns the frames into loop.mp4 (ffmpeg, H.264 baseline, CRF 24); it's skipped if ffmpeg isn't installed.
- **Adding a movement:** add EX[key] in render.html, review it with the strip command, add the key to MOTIONS + RENDERED (+ a name rule) in motion-map.mjs. Bump RENDER_STYLE in render.mjs when changing anything that should re-render existing exercises.

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
- The 3D character is CC0; the 3D movements, equipment and renders are original to this project. Media © Gym visual (raster fallback, admin library) is redistributed with permission. Rules:
  - Keep the attribution visible.
  - Keep the original 180×180 size (no upscaling) for the raster fallback.
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
  - Vector SVG animations (2026-11-24), replaced the same day: the owner found them too crude.
  - Realistic 3D rendered animations (2026-11-24): 31 movements, covering all 30 plan exercises; other library exercises fall back to raster.
    - First device test: very slow, almost not playing (all frames of the day requested at once). Fixed with smaller frames, video-first playback, priority loading and a gentle prefetch; not yet re-tested on the device.
  - UI polish pass (2026-11-24): admin has SVG icons, a watch-size switcher (41/45/49mm), `/` to focus search, a responsive layout, and keeps working when the dataset is missing
- Not yet done:
  - Real-device test on an Apple Watch browser
- Possible next steps, only if asked:
  - Import the trainer's list from pasted text (fuzzy-match to dataset ids)
  - A watch-side "today" override