# WristPlan

Minimal dark-mode workout viewer for Apple Watch + a local admin portal on your laptop.
Watch shows only: **exercise name + looping animation**. No tracking.

```
admin/      laptop-only portal (Node, zero dependencies)
site/       what gets deployed → the watch page
  index.html  watch UI
  plan.json   your days & exercises (written by admin)
  gifs/       only the animations your plan uses (auto-synced)
dataset/    1,324-exercise library (downloaded by setup, not deployed)
```

## 1. Run the admin portal (laptop)

Requires Node 18+ and git.

```bash
npm run setup     # one-time: downloads the exercise library (~300 MB)
npm run admin     # → open http://localhost:4321
```

- **Left:** days (add with ＋, drag to reorder) + live watch preview
- **Middle:** exercises for the selected day: rename for the watch, drag/↑↓ to reorder, ✕ to remove
- **Right:** search the library, filter by equipment/muscle, hover to animate, click to add
- **Save** (⌘S) writes `site/plan.json` and copies the needed GIFs into `site/gifs/`

When your trainer sends the plan, type each exercise name into search, click the right animation, and rename it to whatever your trainer calls it.

## 2. Deploy (one-time)

```bash
git init && git add . && git commit -m "WristPlan"
gh repo create wristplan --private --source . --push   # or create the repo on github.com and push
```

On vercel.com, use **Add New → Project** and import the repo. `vercel.json` already sets everything up, so there's no build step.

After that, **Save & Publish** in the admin does `git add site && commit && push`, and Vercel redeploys in about 30 seconds.

## 3. Watch

1. On your iPhone, open the Watch app → App Store and install a free watch browser (e.g. **Fern Browser** or **Searchino**).
2. Open your Vercel URL in it and bookmark it. Alternatively, iMessage the link to yourself and tap it on the watch.
3. Using it:
   - Tap a day to open it. The outlined day is the one after the last day you opened.
   - **Tap the right side** of the screen for the next exercise, the **left side** for the previous one, or swipe.
   - The bar at the top shows your progress through the day.

The watch remembers the last plan it loaded. If the network drops mid-workout, the names still show, but GIFs that haven't been loaded yet may not appear.

## Media licence

Animations © **Gym visual** (https://gymvisual.com/), redistributed in the dataset with permission at 180×180, with attribution required. The site keeps the credit line and the original resolution. Keep your Vercel project for personal use. Before making it public or commercial, check Gym visual's terms.
