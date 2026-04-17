#!/usr/bin/env node
/**
 * Crawl ald.cl with Playwright — **sequential stock → fichas** (no BFS maze).
 *
 * For each listing page **`/stock`**, **`/stock/2`** … **`/stock/N`** (default N=7):
 *   1) Open the grid, scroll/settle, collect `/ficha/…` links + `Ext*` image ids from **that** HTML.
 *   2) Resolve any `Ext{id}` still missing a URL via `GET /ficha/{id}` → `og:url`.
 *   3) **Immediately** open and save **each** car on that page (JSON), then move to the **next** stock page.
 *
 * Stops early if two consecutive stock pages have the same grid fingerprint (site looping last page)
 * or after consecutive 404s. Optional static pages after.
 *
 * Brave / CDP:
 *   SCRAPE_CLEAN=1 SCRAPE_CONNECT_CDP=http://127.0.0.1:9222 npm run scrape:ald
 *
 * Limits:
 *   SCRAPE_MAX_STOCK_PAGE=25       — max /stock/N to try (dedupe stops early if grid repeats)
 *   SCRAPE_STOCK_DEDUPE=1           — stop if two consecutive /stock/N pages are identical
 *   SCRAPE_STOCK_DUPLICATE_STOP=2
 *   SCRAPE_MAX_FICHAS=0             — 0 = all cars found (up to SCRAPE_HARD_CAP)
 *   SCRAPE_HARD_CAP=2500
 *   SCRAPE_INCLUDE_STATIC=1
 *   SCRAPE_CLEAN=1
 *   SCRAPE_RESOLVE_DELAY_MS=450     — between /ficha/{id} probes for Ext* resolution
 *
 * Capture:
 *   SCRAPE_TEXT_MODE=body | SCRAPE_FICHA_SCROLL | SCRAPE_FICHA_SETTLE_MS
 */

import { chromium } from 'playwright';
import { mkdir, writeFile, readdir, unlink } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'scraped');
const PAGES_DIR = path.join(OUT, 'pages');

const START = process.env.SCRAPE_START_URL || 'https://www.ald.cl/stock';
const DELAY_MS = Math.max(200, parseInt(process.env.SCRAPE_DELAY_MS || '1500', 10));
const LISTING_DELAY_MS = Math.max(
  100,
  parseInt(process.env.SCRAPE_LISTING_DELAY_MS || String(Math.min(DELAY_MS, 800)), 10),
);
const TIMEOUT_MS = Math.max(5000, parseInt(process.env.SCRAPE_TIMEOUT_MS || '90000', 10));
const MAX_TEXT_CHARS = 800_000;

/** Try enough /stock/N pages for 90+ cars; SCRAPE_STOCK_DEDUPE stops when the grid repeats */
const MAX_STOCK_PAGE = Math.max(1, parseInt(process.env.SCRAPE_MAX_STOCK_PAGE || '25', 10));
const STOCK_404_STOP = Math.max(1, parseInt(process.env.SCRAPE_STOCK_404_STOP || '3', 10));
const STOCK_SWEEP_DEDUPE =
  process.env.SCRAPE_STOCK_DEDUPE !== '0' && process.env.SCRAPE_STOCK_DEDUPE !== 'false';
const STOCK_DUPLICATE_STOP = Math.max(
  1,
  parseInt(process.env.SCRAPE_STOCK_DUPLICATE_STOP || '2', 10),
);
const LISTING_SETTLE_MS = Math.max(0, parseInt(process.env.SCRAPE_LISTING_SETTLE_MS || '2200', 10));
const WAIT_UNTIL = (process.env.SCRAPE_WAIT_UNTIL || 'load').trim();
const FICHA_SETTLE_MS = Math.max(0, parseInt(process.env.SCRAPE_FICHA_SETTLE_MS || '1400', 10));
const TEXT_MODE = (process.env.SCRAPE_TEXT_MODE || 'body').toLowerCase().trim();
const FICHA_SCROLL =
  process.env.SCRAPE_FICHA_SCROLL !== '0' && process.env.SCRAPE_FICHA_SCROLL !== 'false';
const RESOLVE_DELAY_MS = Math.max(0, parseInt(process.env.SCRAPE_RESOLVE_DELAY_MS || '450', 10));
const MAX_LD_CHUNK = Math.max(1000, parseInt(process.env.SCRAPE_MAX_LD_CHUNK || '120000', 10));
const MAX_FICHAS =
  process.env.SCRAPE_MAX_FICHAS === undefined || process.env.SCRAPE_MAX_FICHAS === ''
    ? 0
    : Math.max(0, parseInt(process.env.SCRAPE_MAX_FICHAS, 10));
const HARD_CAP = Math.max(50, parseInt(process.env.SCRAPE_HARD_CAP || '2500', 10));
const INCLUDE_STATIC =
  process.env.SCRAPE_INCLUDE_STATIC !== '0' && process.env.SCRAPE_INCLUDE_STATIC !== 'false';
const SCRAPE_CLEAN = process.env.SCRAPE_CLEAN === '1' || process.env.SCRAPE_CLEAN === 'true';

const CDP_URL = (process.env.SCRAPE_CONNECT_CDP || '').trim();
const BRAVE_PATH = (process.env.SCRAPE_BRAVE_PATH || '').trim();
const USE_BRAVE =
  process.env.SCRAPE_USE_BRAVE === '1' ||
  process.env.SCRAPE_USE_BRAVE === 'true' ||
  Boolean(BRAVE_PATH);
const HEADLESS =
  process.env.SCRAPE_HEADED !== '1' && process.env.SCRAPE_HEADED !== 'true';

function defaultBraveExecutable() {
  if (process.platform === 'darwin') {
    return '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
  }
  if (process.platform === 'win32') {
    return 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
  }
  return '/usr/bin/brave-browser';
}

function canonicalOrigin(u) {
  const x = new URL(u);
  return `${x.protocol}//${x.hostname}`;
}

function registrableHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Treat www and non-www as the same site (links often mix both). */
function sameRegistrableOrigin(a, b) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.protocol === ub.protocol && registrableHost(a) === registrableHost(b);
  } catch {
    return false;
  }
}

/** Strip trailing slash except root. */
function normalizePathname(pathname) {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function normalizeFichaUrl(href, pageBaseUrl, siteOrigin) {
  try {
    const u = new URL(href, pageBaseUrl);
    if (!/^https?:$/i.test(u.protocol)) return null;
    if (!sameRegistrableOrigin(u.href, siteOrigin)) return null;
    const p = normalizePathname(u.pathname);
    if (!/^\/ficha\/\d+\/[^/]+$/.test(p)) return null;
    const slug = p.split('/').pop() || '';
    const bad = new Set(['home', 'stock', 'consignacion', 'financiamiento', 'contacto', 'ficha']);
    if (bad.has(slug.toLowerCase())) return null;
    u.hash = '';
    u.search = '';
    return u.origin + p;
  } catch {
    return null;
  }
}

function fichaIdFromUrl(url) {
  const m = url.match(/\/ficha\/(\d+)\//);
  return m ? parseInt(m[1], 10) : 0;
}

function slugFromUrl(url) {
  return Buffer.from(url)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
    .slice(0, 96);
}

/** Scroll listing pages so lazy-loaded cards inject <a href="/ficha/..."> into the DOM. */
async function settleListingDom(page) {
  if (LISTING_SETTLE_MS > 0) {
    await new Promise((r) => setTimeout(r, LISTING_SETTLE_MS));
  }
  await page.evaluate(async () => {
    const step = 600;
    const pause = 80;
    for (let round = 0; round < 2; round += 1) {
      for (let i = 0; i < 45; i += 1) {
        const { scrollHeight, clientHeight, scrollTop } = document.documentElement;
        window.scrollBy(0, step);
        await new Promise((r) => setTimeout(r, pause));
        if (scrollTop + clientHeight >= scrollHeight - 8) break;
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((r) => setTimeout(r, 400));
    }
  });
  const more = [
    'button:has-text("Cargar")',
    'button:has-text("Ver más")',
    'a:has-text("Ver más")',
    '[class*="load-more" i]',
  ];
  for (const sel of more) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
      await loc.click({ timeout: 3000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
}

/** Also catch /ficha/… URLs embedded in JSON inside HTML (SPA hydrates). */
function extractFichasFromHtml(html, siteOrigin) {
  const out = new Set();
  const re = /\/ficha\/(\d+)\/([^"'\s<>?#\\]+)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const path = `/ficha/${m[1]}/${m[2].replace(/\/+$/, '')}`;
    if (path.split('/').length !== 4) continue;
    try {
      const full = new URL(path, siteOrigin).href;
      const n = normalizeFichaUrl(full, full, siteOrigin);
      if (n) out.add(n);
    } catch {
      /* skip */
    }
  }
  return out;
}

/**
 * ALD stock photos use https://www.RTautomotriz.com/images/ALD/Ext{vehicleId}-1.jpg — the numeric part
 * matches the internal ficha id. Similar-vehicle strips often expose these without traditional <a href>.
 */
function extractExtVehicleIds(html) {
  const out = new Set();
  if (!html) return out;
  const re = /(?:ALD\/)?Ext(\d{5,})(?:-\d+)?\.(?:jpe?g|webp|png)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.add(m[1]);
  }
  return out;
}

function fichaUrlSetHasId(urlSet, id) {
  const n = typeof id === 'number' ? id : parseInt(id, 10);
  if (!n) return false;
  for (const u of urlSet) {
    if (fichaIdFromUrl(u) === n) return true;
  }
  return false;
}

/**
 * Short URL https://www.ald.cl/ficha/{id} returns 200 HTML with meta og:url → canonical slug URL.
 */
async function resolveFichaUrlFromNumericId(page, id, siteOrigin) {
  const n = typeof id === 'number' ? id : parseInt(id, 10);
  if (!n || n < 10_000) return null;
  const shortUrl = `${siteOrigin.replace(/\/+$/, '')}/ficha/${n}`;
  const wu = ['load', 'domcontentloaded', 'commit', 'networkidle'].includes(WAIT_UNTIL)
    ? WAIT_UNTIL
    : 'load';
  try {
    const res = await page.goto(shortUrl, { waitUntil: wu, timeout: TIMEOUT_MS });
    const st = res?.status() ?? 0;
    if (st === 404) return null;
    await new Promise((r) => setTimeout(r, Math.min(800, FICHA_SETTLE_MS)));
    const og = await page
      .locator('meta[property="og:url"]')
      .getAttribute('content')
      .catch(() => null);
    if (og) {
      try {
        const u = new URL(og.split('?')[0]);
        if (sameRegistrableOrigin(u.href, siteOrigin) && fichaIdFromUrl(u.href) === n) {
          const norm = normalizeFichaUrl(u.href, u.href, siteOrigin);
          if (norm) return norm;
        }
      } catch {
        /* skip */
      }
    }
    const html = await page.content();
    for (const f of extractFichasFromHtml(html, siteOrigin)) {
      if (fichaIdFromUrl(f) === n) return f;
    }
    return null;
  } catch {
    return null;
  }
}

async function cleanPagesDir() {
  const names = await readdir(PAGES_DIR).catch(() => []);
  for (const f of names) {
    if (f.endsWith('.json') || f.endsWith('.error.txt')) {
      await unlink(path.join(PAGES_DIR, f)).catch(() => {});
    }
  }
}

async function discoverOneListing(page, norm, siteOrigin, fichas, listingVisited, extIds) {
  const wu = ['load', 'domcontentloaded', 'commit', 'networkidle'].includes(WAIT_UNTIL)
    ? WAIT_UNTIL
    : 'load';
  let hrefs = [];
  let status = 0;
  try {
    const res = await page.goto(norm, {
      waitUntil: wu,
      timeout: TIMEOUT_MS,
    });
    status = res?.status() ?? 0;
    if (status === 404) {
      return { status: 404, hrefs: [], sweepSig: '' };
    }

    await settleListingDom(page);

    const html = await page.content();
    /** Per-page signature for /stock/N sweep: detect “last page” looped as 8, 9, … */
    const pageFichas = new Set();
    const pageExt = new Set();

    for (const f of extractFichasFromHtml(html, siteOrigin)) {
      fichas.add(f);
      pageFichas.add(f);
    }
    for (const id of extractExtVehicleIds(html)) {
      extIds.add(id);
      pageExt.add(id);
    }

    hrefs = await page.$$eval('a[href]', (anchors, base) => {
      const out = [];
      for (const a of anchors) {
        const h = a.getAttribute('href');
        if (!h || h.startsWith('mailto:') || h.startsWith('tel:') || h.startsWith('javascript:'))
          continue;
        try {
          out.push(new URL(h, base).href);
        } catch {
          /* skip */
        }
      }
      return [...new Set(out)];
    }, norm);

    for (const h of hrefs) {
      const f = normalizeFichaUrl(h, norm, siteOrigin);
      if (f) {
        fichas.add(f);
        pageFichas.add(f);
      }
    }

    const sweepSig = `${[...pageFichas].sort().join('\n')}##${[...pageExt].sort().join(',')}`;
    return { status, hrefs, sweepSig };
  } finally {
    listingVisited.add(norm);
  }
}

/** Load one `/stock` or `/stock/N` URL and return cars visible on that page only. */
async function scrapeSingleStockListingPage(page, norm, siteOrigin) {
  const fichas = new Set();
  const extIds = new Set();
  const visited = new Set();
  const result = await discoverOneListing(page, norm, siteOrigin, fichas, visited, extIds);
  return {
    status: result.status,
    sweepSig: result.sweepSig,
    fichaUrls: [...fichas],
    extIds: [...extIds],
  };
}

/** Scroll saved pages so lazy tabs/galleries mount before we read the DOM. */
async function settleDetailPageForSave(page) {
  if (!FICHA_SCROLL) return;
  await page.evaluate(async () => {
    const step = 450;
    const pause = 70;
    for (let r = 0; r < 2; r += 1) {
      for (let i = 0; i < 35; i += 1) {
        const { scrollHeight, clientHeight, scrollTop } = document.documentElement;
        window.scrollBy(0, step);
        await new Promise((x) => setTimeout(x, pause));
        if (scrollTop + clientHeight >= scrollHeight - 6) break;
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((x) => setTimeout(x, 350));
    }
    window.scrollTo(0, 0);
    await new Promise((x) => setTimeout(x, 250));
  });
}

async function extractDomSnapshot(page) {
  return page.evaluate(() => {
    const t = (el) => (el && el.innerText ? el.innerText : '') || '';
    const main = document.querySelector('main');
    const bodyText = t(document.body);
    const mainText = t(main);

    const meta = {};
    for (const m of document.querySelectorAll('meta[name], meta[property]')) {
      const k = m.getAttribute('name') || m.getAttribute('property');
      const c = m.getAttribute('content');
      if (k && c) meta[k] = c;
    }

    const jsonLdRaw = [];
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      const raw = s.textContent?.trim();
      if (raw) jsonLdRaw.push(raw);
    }

    const headings = [...document.querySelectorAll('h1, h2, h3')]
      .map((e) => e.innerText.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 40);

    const canonical =
      document.querySelector('link[rel="canonical"]')?.getAttribute('href') || null;

    return { bodyText, mainText, meta, jsonLdRaw, headings, canonical };
  });
}

async function savePageJson(page, url, index, siteOrigin, harvest) {
  const wu = ['load', 'domcontentloaded', 'commit', 'networkidle'].includes(WAIT_UNTIL)
    ? WAIT_UNTIL
    : 'load';
  const res = await page.goto(url, {
    waitUntil: wu,
    timeout: TIMEOUT_MS,
  });
  const status = res?.status() ?? 0;
  await new Promise((r) => setTimeout(r, FICHA_SETTLE_MS));
  await settleDetailPageForSave(page);

  const title = await page.title();
  const snap = await extractDomSnapshot(page);

  const baseText =
    TEXT_MODE === 'main'
      ? snap.mainText || snap.bodyText
      : snap.bodyText || snap.mainText;
  const trimmed = (baseText || '').replace(/\s+\n/g, '\n').trim().slice(0, MAX_TEXT_CHARS);

  const jsonLd = snap.jsonLdRaw.slice(0, 25).map((chunk) => chunk.slice(0, MAX_LD_CHUNK));

  const payload = {
    url,
    title,
    status,
    text: trimmed,
    textMode: TEXT_MODE,
    textLength: trimmed.length,
    canonical: snap.canonical,
    headings: snap.headings,
    meta: snap.meta,
    jsonLd,
    fetchedAt: new Date().toISOString(),
  };

  const file = path.join(PAGES_DIR, `${String(index).padStart(3, '0')}-${slugFromUrl(url)}.json`);
  await writeFile(file, JSON.stringify(payload, null, 2), 'utf8');

  if (harvest && siteOrigin) {
    const html = await page.content();
    for (const id of extractExtVehicleIds(html)) {
      harvest.extIds.add(id);
    }
    for (const f of extractFichasFromHtml(html, siteOrigin)) {
      harvest.fichaUrls.add(f);
    }
  }

  return payload;
}

async function main() {
  await mkdir(PAGES_DIR, { recursive: true });
  if (SCRAPE_CLEAN) {
    console.log('SCRAPE_CLEAN=1 → clearing previous pages/*.json and *.error.txt');
    await cleanPagesDir();
  }

  const startUrl = new URL(START).href;
  const siteOrigin = canonicalOrigin(startUrl);

  console.log(`Site origin: ${siteOrigin}`);
  console.log(
    `Strategy: /stock → save each car on that page → /stock/2 → … → /stock/${MAX_STOCK_PAGE} (then stop if duplicate grid or 404 streak)`,
  );
  console.log(
    `Delays: listing ${LISTING_DELAY_MS}ms | ficha ${DELAY_MS}ms | Ext resolve ${RESOLVE_DELAY_MS}ms`,
  );
  console.log(
    `Stock dedupe=${STOCK_SWEEP_DEDUPE} (stop after ${STOCK_DUPLICATE_STOP} repeated grids) | 404 stop ${STOCK_404_STOP}`,
  );
  console.log(
    `Fichas: ${MAX_FICHAS === 0 ? `all (hard cap ${HARD_CAP})` : `max ${MAX_FICHAS}`} | static: ${INCLUDE_STATIC}`,
  );
  console.log(`Save: text=${TEXT_MODE} | ficha scroll=${FICHA_SCROLL} | ficha settle=${FICHA_SETTLE_MS}ms`);

  let browser;
  let attachedOverCdp = false;
  let context;
  let page;

  if (CDP_URL) {
    browser = await chromium.connectOverCDP(CDP_URL);
    attachedOverCdp = true;
    console.log(`Mode: attach via CDP (${CDP_URL}) — browser left running after exit`);
    const contexts = browser.contexts();
    if (!contexts.length) {
      throw new Error('No contexts on CDP connection. Start Brave with --remote-debugging-port=...');
    }
    context = contexts[0];
    page = await context.newPage();
  } else {
    const launchOpts = { headless: HEADLESS };
    const exe = BRAVE_PATH || (USE_BRAVE ? defaultBraveExecutable() : null);
    if (exe) {
      launchOpts.executablePath = exe;
      console.log(`Mode: launch ${exe} (headless=${HEADLESS})`);
    } else {
      console.log(`Mode: Playwright Chromium (headless=${HEADLESS})`);
    }
    browser = await chromium.launch(launchOpts);
    context = await browser.newContext({
      locale: 'es-CL',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });
    page = await context.newPage();
  }

  let saveIndex = 0;
  const savedUrls = [];
  const savedFichaIds = new Set();

  try {
    const stats = { resolvedFromExt: 0, unresolvedExtIds: new Set() };
    const allListingExtIds = new Set();
    const allDiscoveredFichaUrls = new Set();
    let lastSweepSig = null;
    let consecutiveDuplicateSweep = 0;
    let consecutive404 = 0;
    const maxTotalFichas = MAX_FICHAS === 0 ? HARD_CAP : Math.min(MAX_FICHAS, HARD_CAP);
    let hitCap = false;

    for (let num = 1; num <= MAX_STOCK_PAGE; num += 1) {
      const norm = num === 1 ? `${siteOrigin}/stock` : `${siteOrigin}/stock/${num}`;
      console.log(`\n=== Stock page ${num}/${MAX_STOCK_PAGE}: ${norm} ===\n`);

      let row;
      try {
        row = await scrapeSingleStockListingPage(page, norm, siteOrigin);
      } catch (e) {
        console.error(`  FAIL listing: ${e.message}`);
        consecutive404 += 1;
        if (consecutive404 >= STOCK_404_STOP) break;
        await new Promise((r) => setTimeout(r, LISTING_DELAY_MS));
        continue;
      }

      if (row.status === 404) {
        consecutive404 += 1;
        lastSweepSig = null;
        consecutiveDuplicateSweep = 0;
        console.error(`  (404) consecutive ${consecutive404}/${STOCK_404_STOP}`);
        if (consecutive404 >= STOCK_404_STOP) break;
        await new Promise((r) => setTimeout(r, LISTING_DELAY_MS));
        continue;
      }
      consecutive404 = 0;

      if (
        STOCK_SWEEP_DEDUPE &&
        num > 1 &&
        row.sweepSig &&
        lastSweepSig !== null &&
        row.sweepSig === lastSweepSig
      ) {
        consecutiveDuplicateSweep += 1;
        console.error(
          `  (duplicate grid vs previous stock page) ${consecutiveDuplicateSweep}/${STOCK_DUPLICATE_STOP}`,
        );
        if (consecutiveDuplicateSweep >= STOCK_DUPLICATE_STOP) {
          console.error('  Stopping: same listing fingerprint as previous page (pagination loop).');
          break;
        }
      } else {
        consecutiveDuplicateSweep = 0;
      }
      lastSweepSig = row.sweepSig || lastSweepSig;

      for (const eid of row.extIds) {
        allListingExtIds.add(eid);
      }

      const pageFichas = new Set(row.fichaUrls);
      for (const idStr of row.extIds) {
        const id = parseInt(idStr, 10);
        if (!id || fichaUrlSetHasId(pageFichas, id)) continue;
        process.stdout.write(`  [Ext→ficha] id ${id}\n`);
        const resolved = await resolveFichaUrlFromNumericId(page, id, siteOrigin);
        if (resolved) {
          pageFichas.add(resolved);
          stats.resolvedFromExt += 1;
        } else {
          stats.unresolvedExtIds.add(id);
        }
        if (RESOLVE_DELAY_MS > 0) {
          await new Promise((r) => setTimeout(r, RESOLVE_DELAY_MS));
        }
      }

      const ordered = [...pageFichas].sort((a, b) => fichaIdFromUrl(a) - fichaIdFromUrl(b));
      console.log(`  ${ordered.length} car(s) on this page — fetching each now\n`);

      for (let i = 0; i < ordered.length; i += 1) {
        if (savedFichaIds.size >= maxTotalFichas) {
          console.error('  HARD_CAP / MAX_FICHAS reached.');
          hitCap = true;
          break;
        }
        const fichaUrl = ordered[i];
        const fid = fichaIdFromUrl(fichaUrl);
        allDiscoveredFichaUrls.add(fichaUrl);
        if (savedFichaIds.has(fid)) {
          process.stdout.write(`  [skip already saved] ${fichaUrl}\n`);
          continue;
        }
        saveIndex += 1;
        process.stdout.write(`  [page ${num} car ${i + 1}/${ordered.length}] ${fichaUrl}\n`);
        try {
          await savePageJson(page, fichaUrl, saveIndex, siteOrigin, null);
          savedUrls.push(fichaUrl);
          savedFichaIds.add(fid);
        } catch (e) {
          console.error(`    FAIL: ${e.message}`);
          const errFile = path.join(
            PAGES_DIR,
            `${String(saveIndex).padStart(3, '0')}-${slugFromUrl(fichaUrl)}.error.txt`,
          );
          await writeFile(errFile, `${fichaUrl}\n\n${String(e)}`, 'utf8');
        }
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }

      if (hitCap) break;

      await new Promise((r) => setTimeout(r, LISTING_DELAY_MS));
    }

    if (INCLUDE_STATIC) {
      const staticPaths = ['/home', '/consignacion', '/financiamiento', '/contacto'];
      console.log('\n--- Phase 3: static pages ---\n');
      for (const p of staticPaths) {
        const url = `${siteOrigin}${p}`;
        saveIndex += 1;
        process.stdout.write(`[static] ${url}\n`);
        try {
          await savePageJson(page, url, saveIndex, siteOrigin, null);
          savedUrls.push(url);
        } catch (e) {
          console.error(`  FAIL: ${e.message}`);
        }
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    }

    const scrapedFichaIds = [...savedFichaIds].sort((a, b) => a - b);
    const listingExtSnapshot = [...allListingExtIds].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    const inventoryState = {
      updatedAt: new Date().toISOString(),
      origin: siteOrigin,
      strategy: 'sequential-stock-then-each-ficha',
      stockPagesScanned: `1…${MAX_STOCK_PAGE} (/stock and /stock/N)`,
      scrapedFichaIds,
      scrapedFichaCount: scrapedFichaIds.length,
      discoveredFichaUrlCount: allDiscoveredFichaUrls.size,
      extIdsSeenOnListingPages: listingExtSnapshot,
      resolvedFromExtCount: stats.resolvedFromExt,
      unresolvedExtIds: [...stats.unresolvedExtIds].sort((a, b) => a - b),
      note:
        'scrapedFichaIds = IDs written this run. Each stock page was fully scraped before advancing. unresolvedExtIds = Ext* on a grid without a working /ficha/{id} short URL.',
    };
    await writeFile(
      path.join(OUT, 'inventory-state.json'),
      JSON.stringify(inventoryState, null, 2),
      'utf8',
    );

    const manifest = {
      startUrl,
      origin: siteOrigin,
      mode: 'sequential-stock-pages',
      maxStockPage: MAX_STOCK_PAGE,
      crawledAt: new Date().toISOString(),
      discoveredFichas: allDiscoveredFichaUrls.size,
      savedCount: savedUrls.length,
      resolvedFromExt: stats.resolvedFromExt,
      urls: savedUrls,
      inventoryStateFile: 'inventory-state.json',
    };
    await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    console.log(`\nDone. ${savedUrls.length} JSON files → ${PAGES_DIR}`);
    console.log(`Inventory report → ${path.join(OUT, 'inventory-state.json')}`);
    console.log('Merge: npm run scrape:ald:merge');
  } finally {
    if (attachedOverCdp) {
      await page.close().catch(() => {});
      console.log('\nClosed automation tab only; browser still running.');
    } else {
      await browser.close();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
