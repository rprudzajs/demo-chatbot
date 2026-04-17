# Scraped website content (ald.cl)

## Why this exists

The in-IDE browser often **cannot open** ald.cl without your **VPN** (same for automated hosts). These scripts run **on your machine** so you can crawl while connected the same way you browse.

## Permission

Use scraping **only with the site owner’s consent** and reasonable rate limits. This crawler uses a **delay between pages** and a **max page cap**; adjust via env vars, do not hammer the server.

## One-time: install Playwright browser

```bash
npm install
npx playwright install chromium
```

(`chromium` is only required if you **do not** use Brave; see below.)

## Using Brave (recommended if ald.cl only works in Brave + VPN)

Playwright drives **Chromium-family** browsers. Two patterns:

### 1) Launch Brave from the script

Uses the Brave app on your Mac/PC. **Turn VPN on at the OS level** before running. A **visible window** often behaves more like your manual session than headless Chromium:

```bash
SCRAPE_USE_BRAVE=1 SCRAPE_HEADED=1 SCRAPE_START_URL=https://www.ald.cl/stock npm run scrape:ald
```

Custom install path:

```bash
SCRAPE_BRAVE_PATH="/path/to/Brave Browser" SCRAPE_HEADED=1 npm run scrape:ald
```

### 2) Attach to a Brave you started (real “session” via CDP)

This connects to **an already running** Brave over Chrome DevTools Protocol — same tech as “inspect”. Useful if you want **Shields**, **extensions**, or you logged in somewhere manually first.

1. **Quit Brave** (or use a **separate profile** — avoid remote-debug on your main profile on untrusted networks).
2. Start Brave with a **dedicated profile** and debugging port, e.g. **macOS**:

   ```bash
   "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
     --remote-debugging-port=9222 \
     --user-data-dir="$HOME/Library/Application Support/BraveSoftware/Brave-Browser-Scrape"
   ```

3. In that window, open the site (VPN on if needed), then in another terminal:

   ```bash
   SCRAPE_CONNECT_CDP=http://127.0.0.1:9222 SCRAPE_START_URL=https://www.ald.cl/stock npm run scrape:ald
   ```

The script opens a **new tab** inside that Brave, crawls, then **closes only that tab** — it does **not** quit Brave.

**Security:** `--remote-debugging-port` exposes control of the browser to anything on your machine that can reach that port; use a **scraping-only profile** and turn it off when finished.

## Crawl

From the repo root (VPN on if needed):

```bash
npm run scrape:ald
```

Optional:

```bash
SCRAPE_START_URL=https://www.ald.cl/stock SCRAPE_DELAY_MS=1500 npm run scrape:ald
```

The crawler is **sequential**: **`/stock`** (page 1) → collect every car on that grid → **open and save each ficha immediately** → **`/stock/2`** → repeat … up to **`SCRAPE_MAX_STOCK_PAGE`** (default **25**). **Dedupe** stops sooner if two consecutive pages show the same grid (site looping). No site-wide BFS. Between listing pages it resolves **`Ext{vehicleId}`** image ids from the grid HTML via **`/ficha/{id}`** when a tile has no `<a href="/ficha/…">`. Then optional static pages.

**SPA / missing tiles:** grids are JS-rendered; the script scrolls and waits. **`inventory-state.json`** records scraped ids, Ext ids seen, and any Ext id that could not be resolved.

- **`SCRAPE_RESOLVE_DELAY_MS`** — Pause between each **`/ficha/{numericId}`** probe when resolving **Ext\*** (default **450**).
- **`SCRAPE_START_URL`** — Used for **site origin** only (e.g. `https://www.ald.cl/stock`); listing URLs are always **`/stock`** and **`/stock/N`**.
- **`SCRAPE_MAX_STOCK_PAGE`** — Last listing page tried: **`/stock`** … **`/stock/N`** (default **25**). Stops earlier if **dedupe** sees a repeated grid, or after **`SCRAPE_STOCK_404_STOP`** consecutive **404**s (default **3**).
- **`SCRAPE_STOCK_DEDUPE`** — **`1`** (default): stop when **`SCRAPE_STOCK_DUPLICATE_STOP`** consecutive **`/stock/N`** pages have the **same** ficha+`Ext*` fingerprint (site looping the last page). Set **`0`** to disable.
- **`SCRAPE_STOCK_DUPLICATE_STOP`** — How many identical consecutive listing pages trigger dedupe stop (default **2**).
- **`SCRAPE_FICHA_SETTLE_MS`** — Extra wait after each saved ficha `load` (default **1400**) so JS-heavy detail pages render.
- **`SCRAPE_TEXT_MODE`** — **`body`** (default) saves **all visible text** on the page; **`main`** only `<main>`.
- **`SCRAPE_FICHA_SCROLL`** — **`1`** (default) scrolls detail pages before extract so lazy blocks appear; **`0`** to skip.
- Merged **`corpus.md`** includes **headings**, **meta tags**, **JSON-LD** blocks, then **visible text** when present in JSON.
- **`SCRAPE_LISTING_SETTLE_MS`** — Wait after load before scrolling (default **2200**); helps JS-rendered grids.
- **`SCRAPE_WAIT_UNTIL`** — **`load`** (default), **`domcontentloaded`**, **`commit`**, or **`networkidle`**.
- **`SCRAPE_MAX_FICHAS`** — Cap saved vehicle pages; **`0`** = all discovered (up to **`SCRAPE_HARD_CAP`**, default **2500**).
- **`SCRAPE_HARD_CAP`** — Safety ceiling on fichas (default **2500**).
- **`SCRAPE_DELAY_MS`** — Pause after each **ficha** (default **1500**).
- **`SCRAPE_LISTING_DELAY_MS`** — Pause after each **stock listing** page before the next **`/stock/N`** (default **800** or `DELAY` if smaller).
- **`SCRAPE_INCLUDE_STATIC`** — Set **`0`** to skip home / consignación / financiamiento / contacto.
- **`SCRAPE_CLEAN`** — Set **`1`** to delete existing `pages/*.json` and `*.error.txt` before a run (fresh corpus).
- **`SCRAPE_TIMEOUT_MS`** — Navigation timeout (default **90000**).

Full re-scrape example (VPN + Brave CDP on **9222**):

```bash
SCRAPE_CLEAN=1 SCRAPE_CONNECT_CDP=http://127.0.0.1:9222 npm run scrape:ald
npm run scrape:ald:merge
```

**Inventory report (no browser):**

```bash
npm run scrape:ald:report
```

Outputs:

- `pages/*.json` — `{ url, title, status, text, fetchedAt }` per page (raw text from `main` or `body`).
- `manifest.json` — list of URLs visited + `resolvedFromExt` when applicable.
- `inventory-state.json` — **scraped ficha ids**, Ext ids seen on listings, unresolved Ext ids (if any).

## Merge into one document (for RAG / review)

```bash
npm run scrape:ald:merge
```

Creates **`corpus.md`** — all pages with `##` headings and `Source:` lines. You can split this into chunks later or feed sections into your vector DB.

## Git

Raw `pages/*.json` and `manifest.json` are **gitignored** (large, environment-specific). Commit **`corpus.md`** only if the client approves and it contains no secrets.
