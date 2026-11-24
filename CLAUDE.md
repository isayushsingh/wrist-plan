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
site/              deployed as-is (vercel.json → outputDirectory: "site", no build)
  index.html       watch UI (vanilla JS, single file, ES5-ish for old WebKit)
  plan.json        source of truth, written only by admin Save
  gifs/<id>.gif    auto-synced: only the GIFs referenced by plan.json
scripts/setup.mjs  shallow-clones the dataset into ./dataset (gitignored, ~300 MB)
dataset/           github.com/hasaneyldrm/exercises-dataset
```

Commands: `npm run setup` (one-time), `npm run admin` → http://localhost:4321

## Data
plan.json:
```json
{ "version": 1, "updatedAt": "ISO", "attribution": "© Gym visual — https://gymvisual.com/",
  "days": [ { "id": "push", "name": "Push", "exercises": [ { "id": "0025", "label": "Bench Press" } ] } ] }
```
- `id` is the 4-digit dataset id. `label` is the display name shown on the watch.
- Dataset `data/exercises.json` is an array of objects with `id, name, target, body_part, equipment, image (180px jpg), gif_url (180px gif)`. Some names contain the mojibake `в°`, which `cleanName()` turns into `°`.

## Admin server API
- `GET /api/exercises`: slim library list
- `GET|PUT /api/plan`: the PUT validates ids against the dataset (this also guards against path traversal), writes plan.json, and copies or removes GIFs in site/gifs
- `POST /api/publish`: `git add site && git commit && git push`. Vercel auto-deploys from GitHub.
- `/preview/*` serves site/. The admin embeds it in a 198×242 iframe as the "watch preview".
- `/dataset/*` serves dataset media. `serveFile` blocks paths that escape the base folder.

## Watch UI behaviour
- Home: a list of days. The day after the last-opened day gets an accent outline. The last-opened day is stored in localStorage (`wp.lastDay`); every storage call is wrapped in try/catch.
- Exercise screen:
  - The GIF sits on a light rounded tile, because the GIFs have white backgrounds.
  - The name sits below the GIF, with "Day · n of N" underneath.
  - Segmented progress bar at the top.
  - Invisible tap zones: the left 34% goes to the previous exercise, the right 66% to the next. Swipe also works.
  - The next GIF is preloaded.
- After the last exercise, a "<Day> done" screen appears; tap it to return home.
- plan.json is fetched with no-store. The last good copy is cached in localStorage (`wp.plan`) as an offline fallback.
- Sizing uses vw units throughout for small watch viewports. The design target is roughly 184–205px wide.

## Design
- Minimal, dark, OLED black (`#000`).
- Text `#f5f5f7`, dim `#8e8e93`, cards `#141416`, single accent `#c7f464` (lime).
- System font (SF). No frameworks, no build step. Keep both pages single-file.

## Constraints
- Media © Gym visual, redistributed with permission. Rules:
  - Keep the attribution visible.
  - Keep the original 180×180 size (no upscaling).
  - The Vercel site is for personal use only.
- Watch browsers have limited WebKit: avoid modern-only APIs on `site/index.html`, don't rely on service workers, and keep the page light.
- Owner's stack familiarity: Next.js, React, Tailwind, Vercel. Don't migrate this project to them unless asked; zero-dep is intentional.

## Status
- Done:
  - Admin portal: search, filters, add/rename/reorder/delete, live preview, Save and Publish
  - Watch page
  - Sample 6-day plan: Push / Legs / Pull / Push Volume / Legs & Core / Arms. It's placeholder data; the owner will replace it with his trainer's list.
- Not yet done:
  - Real-device test on an Apple Watch browser
  - Git repo and Vercel deploy
- Possible next steps, only if asked:
  - Import the trainer's list from pasted text (fuzzy-match to dataset ids)
  - A watch-side "today" override