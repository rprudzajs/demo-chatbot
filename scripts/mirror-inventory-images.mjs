/**
 * Copies each vehicle photo from data/ald-stock-base.json into public/inventory/
 * and rewrites imageUrl to /inventory/<file> so the app serves them from your domain
 * (no third-party hotlinking).
 *
 * Prefer downloading the JPEG bytes (full quality). If fetch fails, falls back to
 * Playwright: open the image URL and capture a screenshot (slightly lower fidelity).
 *
 * Run on a machine that can resolve https://www.rtautomotriz.com (your laptop is fine):
 *   npm run mirror:inventory-images
 *
 * By default, data/ald-stock-base.json is updated only when every URL succeeds.
 *   MIRROR_PARTIAL_JSON=1  — rewrite URLs only for files that were saved; leave others remote
 *
 * Requires: devDependency playwright (npx playwright install chromium if needed)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const stockPath = path.join(root, 'data', 'ald-stock-base.json');
const outDir = path.join(root, 'public', 'inventory');

const partialJson = process.env.MIRROR_PARTIAL_JSON === '1';

function urlToLocalName(url) {
  try {
    const u = new URL(url);
    let base = path.basename(u.pathname.split('/').pop() || 'image.jpg');
    if (!base || base === '/') base = 'image.jpg';
    const q = u.search ? u.search.replace(/[^a-zA-Z0-9]/g, '') : '';
    const name = q ? `${base.replace(/\.[a-z]+$/i, '')}_${q}${path.extname(base) || '.jpg'}` : base;
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
  } catch {
    return `img_${Math.random().toString(36).slice(2)}.jpg`;
  }
}

function urlVariants(url) {
  const out = [url];
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.startsWith('www.')) {
      const a = new URL(url);
      a.hostname = host.slice(4);
      out.push(a.toString());
    } else {
      const b = new URL(url);
      b.hostname = `www.${host}`;
      out.push(b.toString());
    }
  } catch {
    /* ignore */
  }
  return [...new Set(out)];
}

async function fetchBytes(url) {
  let lastErr;
  for (const u of urlVariants(url)) {
    try {
      const res = await fetch(u, {
        redirect: 'follow',
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Referer: 'https://www.rtautomotriz.com/',
        },
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} for ${u}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 200) {
        lastErr = new Error(`Too small (${buf.length}b) for ${u}`);
        continue;
      }
      return buf;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('fetch failed');
}

async function screenshotImageUrl(browser, url, outPath) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1050 } });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.screenshot({ path: outPath, type: 'jpeg', quality: 90, fullPage: false });
  } finally {
    await page.close();
  }
}

async function main() {
  const raw = fs.readFileSync(stockPath, 'utf8');
  const cars = JSON.parse(raw);
  const urls = [...new Set(cars.map((c) => c.imageUrl))];

  fs.mkdirSync(outDir, { recursive: true });

  const map = new Map();
  let browser;

  try {
    for (const url of urls) {
      const name = urlToLocalName(url);
      const dest = path.join(outDir, name);
      const rel = `/inventory/${name}`;

      if (fs.existsSync(dest) && fs.statSync(dest).size > 200) {
        map.set(url, rel);
        console.log('exists', rel);
        continue;
      }

      let ok = false;
      try {
        const bytes = await fetchBytes(url);
        fs.writeFileSync(dest, bytes);
        map.set(url, rel);
        console.log('fetch', rel, `(${bytes.length} bytes)`);
        ok = true;
      } catch (e) {
        console.warn('fetch failed:', url, String(e.message || e));
      }

      if (!ok) {
        try {
          if (!browser) {
            const { chromium } = await import('playwright');
            browser = await chromium.launch({ headless: true });
          }
          await screenshotImageUrl(browser, url, dest);
          map.set(url, rel);
          console.log('screenshot', rel);
          ok = true;
        } catch (e) {
          console.error('screenshot failed:', url, String(e.message || e));
        }
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  const failed = urls.filter((u) => !map.has(u));
  if (failed.length && !partialJson) {
    console.error('\nFailed URLs (', failed.length, '). Not writing JSON. Fix network or run with MIRROR_PARTIAL_JSON=1\n');
    failed.slice(0, 10).forEach((u) => console.error(' -', u));
    if (failed.length > 10) console.error(' ...');
    process.exit(1);
  }

  for (const c of cars) {
    const r = map.get(c.imageUrl);
    if (r) c.imageUrl = r;
  }

  fs.writeFileSync(stockPath, JSON.stringify(cars, null, 2) + '\n', 'utf8');
  console.log('\nWrote', stockPath, '— local images:', map.size, '/', urls.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
