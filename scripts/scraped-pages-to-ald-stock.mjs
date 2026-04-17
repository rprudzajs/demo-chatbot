#!/usr/bin/env node
/**
 * Reads data/scraped/pages/*.json (ficha URLs only), maps to Car shape, writes data/ald-stock-base.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PAGES = path.join(ROOT, 'data', 'scraped', 'pages');
const OUT = path.join(ROOT, 'data', 'ald-stock-base.json');

/** Longest first */
const MULTI_WORD_MAKES = [
  'MERCEDES-BENZ',
  'LAND ROVER',
  'RANGE ROVER',
  'ALFA ROMEO',
  'ASTON MARTIN',
  'GREAT WALL',
  'CAN-AM',
  'AUTO EXPERT',
];

function titleCaseMake(s) {
  return s
    .split(/[\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .replace(/Benz/g, 'Benz');
}

function parseYearFromSlug(url) {
  const m = url.match(/\/ficha\/\d+\/([^/?#]+)$/);
  if (!m) return null;
  const seg = m[1].split('-').pop();
  if (!/^(19|20)\d{2}$/.test(seg)) return null;
  return parseInt(seg, 10);
}

function parseYearFromHeadline(headline) {
  const m = headline.match(/\b((?:19|20)\d{2})\s*$/);
  return m ? parseInt(m[1], 10) : null;
}

function parseMakeModel(headline, year) {
  let rest = headline.trim();
  if (year != null) {
    rest = rest.replace(new RegExp(`\\s*${year}\\s*$`), '').trim();
  }
  const upper = rest.toUpperCase();
  for (const raw of MULTI_WORD_MAKES) {
    if (upper.startsWith(raw)) {
      let make = titleCaseMake(raw.replace(/-/g, ' '));
      if (raw === 'MERCEDES-BENZ') make = 'Mercedes-Benz';
      const model = rest.slice(raw.length).trim().replace(/^[\s-]+/, '');
      return { make, model: model || '—' };
    }
  }
  const parts = rest.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { make: '—', model: '—' };
  const make = titleCaseMake(parts[0].replace(/-/g, ' '));
  const model = parts.slice(1).join(' ') || '—';
  return { make, model };
}

/** Ignore “similar vehicles” block (other models mention EV, diesel, etc.) */
function mainListingText(text) {
  const cut = text.split('OTROS VEHÍCULOS SIMILARES')[0];
  return cut || text;
}

function parseClpPrice(text, ogAlt) {
  const body = mainListingText(text);
  const src = `${body}\n${ogAlt || ''}`;
  const m = src.match(/\$\s*([\d.]+)/);
  if (!m) return 0;
  const n = parseInt(m[1].replace(/\./g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseMileage(text, ogAlt) {
  const body = mainListingText(text);
  const src = `${ogAlt || ''}\n${body}`;
  const m = src.match(/([\d.]+)\s*[Kk]m[s]?/);
  if (!m) return 0;
  return parseInt(m[1].replace(/\./g, ''), 10) || 0;
}

function parseTransmission(text) {
  const t = mainListingText(text).toUpperCase();
  if (t.includes('MECÁNICO') || t.includes('MECANICO') || /\bMT\b/.test(t)) {
    return { transmission: 'Mecánica', short: 'MT' };
  }
  return { transmission: 'Automática', short: 'AT' };
}

function asciiUpper(s) {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase();
}

/** Avoid matching "asientos eléctricos" via substring ELÉCTRICO */
function parseFuel(text, headline) {
  const flat = asciiUpper(`${mainListingText(text)} ${headline}`);
  if (
    /\b100%\s*ELECTRICO\b/.test(flat) ||
    /\bZS\s*EV\b/.test(flat) ||
    /\bMG\s+ZS\s+EV\b/.test(flat) ||
    /\bTESLA\b/.test(flat)
  ) {
    return { fuelType: 'Eléctrico', badge: 'ELÉCTRICO' };
  }
  if (/\bHIBRIDO\b/.test(flat) || /\bHYBRID\b/.test(flat)) {
    return { fuelType: 'Híbrido', badge: 'HÍBRIDO' };
  }
  if (
    /\bDIESEL\b/.test(flat) ||
    /\bTDI\b/.test(flat) ||
    /\bHDI\b/.test(flat) ||
    /\bSDV\d/.test(flat) ||
    /\bDCI\b/.test(flat) ||
    /\bBLUEHDI\b/.test(flat)
  ) {
    return { fuelType: 'Diésel', badge: 'DIESEL' };
  }
  return { fuelType: 'Bencina', badge: 'BENCINA' };
}

function parseColor(text) {
  const m = mainListingText(text).match(/COLOR:\s*([^\n]+)/i);
  return m ? m[1].trim() : '—';
}

function parseListSubtitle(text, headline) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.trim() === headline.trim());
  if (i >= 0 && lines[i + 1]) {
    const next = lines[i + 1].trim();
    if (next && !/^AGENDE|^Previous|^Next|^\$/.test(next)) {
      return next.length > 80 ? `${next.slice(0, 77)}…` : next;
    }
  }
  return undefined;
}

function parseEquipment(text) {
  const body = mainListingText(text);
  const start = body.indexOf('EQUIPAMIENTO');
  if (start === -1) return [];
  const endMarkers = ['OTROS VEHÍCULOS SIMILARES', 'ENVIAR A UN AMIGO', 'SOLICITO INFORMACIÓN', 'CÓMO LLEGAR'];
  let end = body.length;
  for (const m of endMarkers) {
    const p = body.indexOf(m, start + 5);
    if (p !== -1 && p < end) end = p;
  }
  const block = body.slice(start, end);
  const skip = new Set([
    'EQUIPAMIENTO',
    'COMODIDAD',
    'SEGURIDAD',
    'ENTRETENIMIENTO',
    'OTROS',
    'DIRECCIÓN',
    'TELÉFONOS',
  ]);
  return block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && l.length < 80 && !skip.has(l))
    .slice(0, 24);
}

function parseDescription(meta, text) {
  const d = meta.description || '';
  const first = d.split('\n').map((x) => x.trim()).filter(Boolean)[0];
  if (first && first.length > 40) {
    return first.replace(/\s*\(\d+\)\s*$/, '').trim().slice(0, 500);
  }
  const m = text.match(/DESCRIPCIÓN\s*\nCOLOR:[^\n]*\n([\s\S]*?)(?:\nAGENDAR|\nEnviar Mensaje)/i);
  if (m) return m[1].trim().slice(0, 500);
  return (meta['og:description'] || '').trim().slice(0, 500);
}

function fichaIdFromUrl(url) {
  const m = url.match(/\/ficha\/(\d+)\//);
  return m ? m[1] : null;
}

function jsonToCar(raw) {
  const url = raw.url || '';
  if (!url.includes('/ficha/')) return null;

  const idNum = fichaIdFromUrl(url);
  if (!idNum) return null;

  const meta = raw.meta || {};
  const headline = (raw.headings && raw.headings[0]) || '';
  const text = raw.text || '';
  const ogAlt = meta['og:image:alt'] || '';

  const year = parseYearFromSlug(url) ?? parseYearFromHeadline(headline) ?? new Date().getFullYear();
  const { make, model } = parseMakeModel(headline, year);
  const price = parseClpPrice(text, ogAlt);
  const mileage = parseMileage(text, ogAlt);
  const { transmission, short: transmissionShort } = parseTransmission(text);
  const { fuelType, badge: fuelBadge } = parseFuel(text, headline);
  const color = parseColor(text);
  const features = parseEquipment(text);
  const listSubtitle = parseListSubtitle(text, headline);
  const imageUrl = meta['og:image'] || `https://picsum.photos/seed/ald-${idNum}/600/600`;
  const description = parseDescription(meta, text);

  return {
    id: `ald-${idNum}`,
    make,
    model,
    year,
    price,
    currency: 'CLP',
    mileage,
    fuelType,
    transmission,
    color,
    description: description || `${make} ${model} ${year} (ald.cl ficha ${idNum}).`,
    imageUrl,
    features: features.length ? features : ['Ver ficha en ald.cl'],
    listHeadline: undefined,
    listSubtitle,
    justArrived: false,
    transmissionShort,
    fuelBadge,
  };
}

function main() {
  if (!fs.existsSync(PAGES)) {
    console.error('Missing folder:', PAGES, '— run scrape first.');
    process.exit(1);
  }

  const files = fs.readdirSync(PAGES).filter((f) => f.endsWith('.json'));
  const cars = [];
  const seen = new Set();

  for (const f of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(PAGES, f), 'utf8'));
    } catch {
      continue;
    }
    const car = jsonToCar(raw);
    if (!car) continue;
    const key = car.id;
    if (seen.has(key)) continue;
    seen.add(key);
    cars.push(car);
  }

  cars.sort((a, b) => {
    const na = parseInt(a.id.replace('ald-', ''), 10);
    const nb = parseInt(b.id.replace('ald-', ''), 10);
    return na - nb;
  });

  fs.writeFileSync(OUT, `${JSON.stringify(cars, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${cars.length} vehicles → ${OUT}`);
}

main();
