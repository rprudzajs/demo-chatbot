#!/usr/bin/env node
/**
 * Lee `data/scraped/pages/*.json` + opcional `inventory-state.json` y resume
 * qué IDs de ficha tienes en disco vs qué Ext* aparecieron en el último crawl.
 *
 *   node scripts/ald-inventory-report.mjs
 */
import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PAGES = path.join(ROOT, 'data', 'scraped', 'pages');
const STATE = path.join(ROOT, 'data', 'scraped', 'inventory-state.json');

function fichaIdFromUrl(url) {
  const m = String(url).match(/\/ficha\/(\d+)\//);
  return m ? parseInt(m[1], 10) : 0;
}

async function main() {
  const names = (await readdir(PAGES).catch(() => [])).filter((f) => f.endsWith('.json'));
  const idsOnDisk = new Set();
  const urls = [];

  for (const f of names) {
    const raw = await readFile(path.join(PAGES, f), 'utf8');
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!doc.url || !String(doc.url).includes('/ficha/')) continue;
    const id = fichaIdFromUrl(doc.url);
    if (id) {
      idsOnDisk.add(id);
      urls.push({ id, url: doc.url, title: doc.title });
    }
  }

  const sorted = [...idsOnDisk].sort((a, b) => a - b);
  let state = null;
  try {
    state = JSON.parse(await readFile(STATE, 'utf8'));
  } catch {
    /* no state file yet */
  }

  console.log('=== ALD inventario en disco (data/scraped/pages) ===\n');
  console.log(`Fichas guardadas: ${sorted.length}`);
  if (sorted.length) {
    console.log(`IDs: ${sorted.join(', ')}`);
  }
  console.log('');

  if (state) {
    console.log('=== Último crawl (inventory-state.json) ===\n');
    console.log(`Actualizado: ${state.updatedAt || '?'}`);
    console.log(`URLs descubiertas (set): ${state.discoveredFichaUrlCount ?? '?'}`);
    console.log(`Resueltas vía Ext→/ficha/{{id}}: ${state.resolvedFromExtCount ?? 0}`);
    if (state.extIdsSeenOnListingPages?.length) {
      console.log(`Ext* vistos en listados: ${state.extIdsSeenOnListingPages.length}`);
    }
    if (state.unresolvedExtIds?.length) {
      console.log(
        `\nExt* sin resolver (sin ficha válida al probar /ficha/{id}): ${state.unresolvedExtIds.join(', ')}`,
      );
    }
    const scraped = new Set(state.scrapedFichaIds || []);
    const missingFromState = sorted.filter((id) => !scraped.has(id));
    if (missingFromState.length && state.scrapedFichaIds?.length) {
      console.log(
        `\nNota: hay JSON en pages con IDs que no figuran en scrapedFichaIds del state (¿merge manual?): ${missingFromState.join(', ')}`,
      );
    }
    console.log('');
  } else {
    console.log('(No hay inventory-state.json — ejecuta npm run scrape:ald para generarlo.)\n');
  }

  console.log('=== Por qué faltan autos ===');
  console.log(`
1) El listado es SPA: sin Playwright casi no hay <a href="/ficha/..."> en el HTML inicial.
2) "Otros vehículos similares" a veces solo muestran texto; los thumbnails usan Ext{{id}} en la URL de imagen.
3) El scraper ahora extrae esos Ext* y abre https://www.ald.cl/ficha/{{id}} para obtener la URL canónica.
4) Si aún faltan, sube SCRAPE_MAX_STOCK_PAGE o revisa VPN/listing (el crawl es secuencial por página de stock).
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
