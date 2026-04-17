# Local inventory photos (`public/inventory/`)

The demo lists vehicles from `data/ald-stock-base.json`. Each row has an `imageUrl`.

**Goal:** Stop depending on the dealer CDN in the browser (hotlink / referrer issues) by **shipping the same JPEGs inside the app** under `public/inventory/`. Vite copies `public/` into `dist/`, and Railway serves those files from your domain.

This is **self-hosting** the image files (static assets). It is not a separate image host: the files live in the repo and deploy with the build.

## One-time setup on your Mac

1. From the project root, with internet access to `rtautomotriz.com`:

   ```bash
   npm run mirror:inventory-images
   ```

2. If Playwright complains about browsers:

   ```bash
   npx playwright install chromium
   ```

3. Commit the new files:

   - `public/inventory/*.jpg` (and similar)
   - Updated `data/ald-stock-base.json` (`imageUrl` values like `/inventory/Ext224791-1.jpg`)

4. Deploy as usual (`railway up` or git push).

## What the script does

1. Reads every unique `imageUrl` in `data/ald-stock-base.json`.
2. Tries to **download** each image with browser-like headers (best quality).
3. If download fails, opens the URL in **headless Chromium** and saves a **screenshot** (fallback).
4. Rewrites `imageUrl` to `/inventory/<filename>` only when all URLs are mirrored (or set `MIRROR_PARTIAL_JSON=1` to map only successes).

## Note on “screenshots”

Downloading the original file is preferred; screenshots are a fallback when the server blocks scripted downloads. Both end up as files under `public/inventory/`.
