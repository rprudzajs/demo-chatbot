/**
 * Shared ALD Autos assistant brain.
 *
 * Same Gemini system prompt + inventory + session + lead capture used by:
 *   - server/index.mjs        (webhook server for Messenger Page + WhatsApp Cloud API + web chat)
 *   - scripts/messenger-personal.mjs   (Playwright personal Messenger bot)
 *   - scripts/whatsapp-personal.mjs    (whatsapp-web.js personal WhatsApp bot)
 *
 * Inventory source (in priority order):
 *   1. ChileAutos API (live) — set CHILEAUTOS_CLIENT_ID + CLIENT_SECRET + SELLER_ID
 *   2. data/ald-stock-base.json (static fallback — used while credentials aren't ready)
 *
 * Keep this module side-effect free on import — no Express, no servers.
 */
import { createRequire } from 'module';
import { GoogleGenAI } from '@google/genai';
import { crmCreateLead, crmUpdateLead, crmOrigen, CRM_VENDEDOR } from './fullmotor-crm.mjs';

const _require = createRequire(import.meta.url);

export const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY ?? '').trim();
export const GEMINI_MODEL = String(process.env.GEMINI_MODEL ?? 'gemini-2.0-flash').trim();
export const LEADS_WEBHOOK_URL = String(
  process.env.LEADS_WEBHOOK_URL ?? process.env.VITE_LEADS_WEBHOOK_URL ?? '',
).trim();
export const MESSENGER_FALLBACK_REPLY = String(
  process.env.MESSENGER_FALLBACK_REPLY ??
    'Gracias por escribirnos. Un asesor te responderá a la brevedad.',
).trim();
export const GRAPH_VERSION = 'v21.0';
const PAGE_ACCESS_TOKEN = String(process.env.MESSENGER_PAGE_ACCESS_TOKEN ?? '').trim();

// ── ChileAutos credentials ────────────────────────────────────────────────────
const CHILEAUTOS_CLIENT_ID = String(process.env.CHILEAUTOS_CLIENT_ID ?? '').trim();
const CHILEAUTOS_CLIENT_SECRET = String(process.env.CHILEAUTOS_CLIENT_SECRET ?? '').trim();
const CHILEAUTOS_SELLER_ID = String(process.env.CHILEAUTOS_SELLER_ID ?? '').trim();
const CHILEAUTOS_TOKEN_URL = 'https://id.s.core.csnglobal.net/connect/token';
// Staging base — will be swapped to production URL via env once you have prod creds
const CHILEAUTOS_API_BASE = String(
  process.env.CHILEAUTOS_API_BASE ??
    'https://globalinventory-publicapi.stg.core.csnglobal.net/v1',
).replace(/\/$/, '');
const INVENTORY_REFRESH_MS = Number(process.env.INVENTORY_REFRESH_MS ?? 60 * 60 * 1000); // 1 h

// ── Inventory state (refreshable) ─────────────────────────────────────────────
export let _aldStock = [];
let _inventoryText = '(inventario no disponible)';
let _makeIndex = new Map();

async function _fetchChileAutosToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CHILEAUTOS_CLIENT_ID,
    client_secret: CHILEAUTOS_CLIENT_SECRET,
  });
  const res = await fetch(CHILEAUTOS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`ChileAutos auth ${res.status}`);
  const { access_token } = await res.json();
  return access_token;
}

function _mapChileAutosCar(v) {
  const spec = v.Specification ?? {};
  const attrs = spec.Attributes ?? [];
  const getAttr = (...names) => {
    for (const n of names) {
      const hit = attrs.find((a) => a.Name?.toLowerCase() === n.toLowerCase());
      if (hit?.Value) return hit.Value;
    }
    return '';
  };
  const price =
    v.PriceList?.find((p) => p.Currency === 'CLP')?.Amount ?? v.PriceList?.[0]?.Amount ?? 0;
  const currency = v.PriceList?.[0]?.Currency ?? 'CLP';
  const mileage = v.OdometerReadings?.[0]?.Value ?? 0;
  const year = spec.ReleaseDate?.Year ?? null;
  const color =
    v.Colours?.find((c) => c.Location === 'Exterior')?.Name ?? v.Colours?.[0]?.Name ?? '';
  const fuelType = getAttr('Combustible', 'Fuel Type', 'Tipo de combustible');
  const transmission = getAttr('Transmisión', 'Transmision', 'Transmission', 'Caja');
  // Use SellerReference if available (numeric ALD id), else strip UUID to digits
  const numericId = String(v.SellerReference ?? v.Identifier ?? '')
    .replace(/[^0-9]/g, '')
    .slice(-8);
  return {
    id: `ald-${numericId}`,
    make: spec.Make ?? '',
    model: spec.Model ?? '',
    year,
    price,
    currency,
    mileage,
    fuelType,
    transmission,
    color: color.toUpperCase(),
    description: spec.Title ?? spec.ShortTitle ?? '',
    imageUrl: v.Photos?.sort((a, b) => a.Order - b.Order)?.[0]?.Url ?? '',
    features: [],
    listSubtitle: spec.ShortTitle ?? '',
    transmissionShort: transmission.toLowerCase().includes('auto') ? 'AT' : 'MT',
    fuelBadge: fuelType.toUpperCase(),
  };
}

async function _fetchChileAutosInventory() {
  const token = await _fetchChileAutosToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'x-seller-identifier': CHILEAUTOS_SELLER_ID,
  };
  const vehicles = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${CHILEAUTOS_API_BASE}/vehicles/active_items?page=${page}&limit=100`,
      { headers },
    );
    if (!res.ok) throw new Error(`ChileAutos inventory ${res.status}`);
    const data = await res.json();
    const items = Array.isArray(data)
      ? data
      : (data.items ?? data.vehicles ?? data.data ?? []);
    if (!items.length) break;
    vehicles.push(...items.map(_mapChileAutosCar));
    if (items.length < 100) break;
    page++;
  }
  return vehicles;
}

function _buildInventoryText(stock) {
  if (!stock.length) return '(inventario no disponible)';
  const lines = stock.map((car) => {
    const numericId = String(car.id).replace(/^ald-/, '');
    const price =
      car.currency === 'CLP'
        ? new Intl.NumberFormat('es-CL', {
            style: 'currency',
            currency: 'CLP',
            maximumFractionDigits: 0,
          }).format(car.price)
        : `$${Number(car.price).toLocaleString('en-US')}`;
    const notes = [car.listHeadline, car.listSubtitle].filter(Boolean).join(' · ');
    const fichaUrl = `https://www.ald.cl/ficha/${numericId}/`;
    const noteLine = notes ? `\n  Notas: ${notes}` : '';
    return (
      `- ${car.year} ${car.make} ${car.model} (id ${numericId}): ${price}\n` +
      `  KM: ${Number(car.mileage).toLocaleString('es-CL')} km · ${car.transmission} · ${car.fuelType}\n` +
      `  Ficha: ${fichaUrl}${noteLine}`
    );
  });
  return (
    lines.join('\n') +
    `\n\nResumen: ${stock.length} unidades en inventario. Solo usa precios y datos de esta lista; si falta algo, ofrece confirmación con un ejecutivo.`
  );
}

function _buildMakeIndex(stock) {
  const map = new Map();
  for (const c of stock ?? []) {
    const make = String(c?.make ?? '').trim();
    if (!make) continue;
    map.set(make.toLowerCase(), make);
  }
  map.set('range rover', 'Land Rover');
  map.set('landrover', 'Land Rover');
  return map;
}

async function _loadInventory() {
  if (CHILEAUTOS_CLIENT_ID && CHILEAUTOS_CLIENT_SECRET && CHILEAUTOS_SELLER_ID) {
    try {
      const live = await _fetchChileAutosInventory();
      if (live.length > 0) {
        _aldStock = live;
        _inventoryText = _buildInventoryText(live);
        _makeIndex = _buildMakeIndex(live);
        console.log(`[inventory] ${live.length} vehicles loaded from ChileAutos API`);
        return;
      }
    } catch (e) {
      console.warn(`[inventory] ChileAutos fetch failed (${e.message}) — using JSON fallback`);
    }
  }
  try {
    const json = _require('../data/ald-stock-base.json');
    _aldStock = json;
    _inventoryText = _buildInventoryText(json);
    _makeIndex = _buildMakeIndex(json);
    console.log(`[inventory] ${json.length} vehicles loaded from static JSON`);
  } catch {
    _aldStock = [];
    _inventoryText = '(inventario no disponible)';
    _makeIndex = new Map();
    console.warn('[inventory] No inventory available');
  }
}

// Initialize inventory on module load (top-level await — ES module)
await _loadInventory();

// Refresh in background every hour (unref so it doesn't block process exit)
if (INVENTORY_REFRESH_MS > 0) {
  setInterval(_loadInventory, INVENTORY_REFRESH_MS).unref();
}

// ── System prompt (built dynamically so refreshes pick up new inventory) ───────
const _clientKnowledge = `
Marca comercial: ALD Autos. Sitio: https://www.ald.cl — sección stock: /stock.
UBICACIÓN: Comandante Malbec 13495, Lo Barnechea, Chile.
TELÉFONOS: (+56 9) 7459-6700 · (+56 9) 7285-3439 · (+56 9) 6618-1755 · Consignación: (+56 9) 9294-3779
HORARIO: Lunes a viernes 09:00–19:00 · Sábado 10:00–14:00
MONEDA: precios en pesos chilenos (CLP).
Si el usuario pide un dato no listado, no inventes — ofrece derivar a un ejecutivo por WhatsApp o llamada.
`.trim();

function _buildSystemPrompt() {
  return `
Eres el asesor de ventas de ALD Autos — seminuevos premium en Santiago. Eres experto, proactivo y humano. Tu meta: convertir cada conversación en una visita o contacto real.

═══════════════════════════════════════
REGLAS ABSOLUTAS (nunca las rompas)
═══════════════════════════════════════
1. IDIOMA: Siempre español chileno. Tutéalo al cliente.
2. SOLO OFRECE LO QUE EXISTE en el inventario. Jamás inventes un auto, precio o característica.
3. FILTRA POR CATEGORÍA PRIMERO: Si el cliente pide un tipo de vehículo (camioneta, SUV, sedán, etc.), solo muestra autos de esa categoría. No mezcles tipos aunque sean de la marca solicitada.
4. FORMATO: Texto plano. Sin asteriscos, sin corchetes, sin markdown. URLs limpias: https://www.ald.cl/ficha/250702/ — nunca [link](url).
5. RESPUESTAS BREVES POR DEFECTO. Máx 2 párrafos cortos, 1-2 frases cada uno. Si el cliente es claro y pide opciones, máx 3 autos en lista. Nunca repitas datos que ya diste. Apunta a 60-100 palabras totales; supera eso solo si te piden detalle explícito. IMPORTANTE: nunca termines una respuesta a media frase; siempre cierra con una idea completa.
6. MENSAJE VAGO O CORTO (ej: "hola", "info", "precios", "qué tienes", emoji solo, 1-3 palabras sin contexto): NO listes autos todavía. Responde en máx 2 frases con UNA pregunta concreta para entender qué busca (tipo de vehículo, presupuesto o uso). Puedes mencionar 1 ejemplo destacado solo si ayuda a guiar. Nunca dumpees el catálogo.
7. Emojis: máx 1 por respuesta, solo para calidez.
8. LISTAS DE AUTOS: Cuando el cliente pidió opciones concretas y muestres 2 o más autos, SIEMPRE usa este formato exacto (un auto por línea, guión al inicio, sin texto extra antes de la lista):
- Nissan Navara XE 2022 · Diesel · AT · $21.990.000 → https://www.ald.cl/ficha/250226/
- Mazda BT-50 SDX 2019 · Diesel · MT · $10.490.000 → https://www.ald.cl/ficha/224791/
NUNCA escribas un auto como párrafo cuando hay más de uno. Siempre lista, siempre con guión.
9. MEMORIA Y CONTINUIDAD: El historial completo de la conversación está arriba. Úsalo siempre.
   - Si ya saludaste → NUNCA vuelvas a decir "¡Hola!" o "Hola [nombre]" ni nada parecido. Continúa directo al tema.
   - Si el cliente ya mencionó su presupuesto, categoría o marca → no vuelvas a preguntar lo mismo.
   - Si el cliente dice "ese", "ese que me mostraste", "el primero", "el Nissan", "me gusta la Mazda" → busca en el historial qué auto mencionaste y responde sobre ESE auto.

═══════════════════════════════════════
CATEGORÍAS DEL INVENTARIO (úsalas para filtrar)
═══════════════════════════════════════
En Chile "camioneta" y "pickup" son lo mismo. Cuando el cliente diga cualquiera de estas palabras, SOLO muestra vehículos de la categoría PICKUP:

PICKUPS / CAMIONETAS (solo estos modelos):
- Mazda BT-50 SDX 2019 — $10.490.000
- Mitsubishi L200 CRT 4X4 MT 2019 — $11.990.000
- Toyota Hilux 2.4 MT 4X4 1996 — $12.990.000
- Ford F-150 XLT 3.3 AT 2016 — $16.990.000
- Nissan Navara XE 2.3 AT 4WD 2022 — $21.990.000
- Chevrolet Silverado LT Trail Boss 5.3 2023 — $38.990.000
- Chevrolet Silverado LTZ 5.3 2020 — $31.990.000

SUVs / 4WD: Modelos tipo Jeep, Range Rover, Mitsubishi Outlander, Kia Sorento, Nissan Murano, Mazda CX-5, etc.
SEDANES: Modelos tipo Audi A6, Mercedes A200, Volkswagen Gol, etc.
COUPES / DEPORTIVOS: Porsche, Mercedes SL, Volkswagen Scirocco, Nissan 300ZX, etc.
STATION WAGON: Subaru Outback, Volvo V40/V60, etc.

REGLA CLAVE: Si el cliente dice "camioneta Nissan" → solo muestra la Nissan Navara. No muestres el Murano, no muestres el 300ZX. Solo la Navara porque es la única camioneta Nissan en stock.

═══════════════════════════════════════
COMPORTAMIENTO PROACTIVO
═══════════════════════════════════════
PRIMER MENSAJE (saludo o "hola"):
Saluda en 1 frase y haz UNA pregunta concreta para guiar. No listes autos en este turno — guía primero.

Ejemplo correcto (breve):
"¡Hola! Soy el asistente virtual de ALD Autos 👋 Tenemos ${_aldStock.length} seminuevos en Lo Barnechea. ¿Qué tipo de auto buscas — camioneta, SUV, sedán — y tienes un presupuesto en mente?"

CUANDO EL CLIENTE DA UNA CATEGORÍA:
Muestra 2-3 opciones concretas de esa categoría con precio y año. No hagas más preguntas antes de mostrar opciones — primero ofrece, luego afina.

CUANDO EL CLIENTE DA CATEGORÍA + MARCA:
Filtra al cruce exacto y responde con opciones de inmediato. Si hay 2+ resultados, muestra hasta 3 en lista. Si hay 1 solo resultado, muéstralo con detalle completo (ficha, precio, km, transmisión, combustible). Si no hay ninguno, dilo honestamente y ofrece alternativas similares.

CUANDO EL CLIENTE MENCIONA UN AUTO QUE YA OFRECISTE:
Si el cliente dice "me gusta la Mazda", "me interesa ese", "cuéntame más del Nissan", etc. refiriéndose a un auto que TÚ ya mencionaste en la conversación — NO preguntes qué tipo busca. Ya sabes exactamente a cuál se refiere. Muéstrale la ficha completa de ESE auto: precio, km, transmisión, combustible, y link. Luego ofrece agendar una visita.

CUANDO EL CLIENTE DA SOLO UNA MARCA (sin haber visto opciones antes y sin categoría establecida):
Responde con opciones de esa marca de inmediato (hasta 3), sin pedir primero categoría.
Cada opción debe incluir: año, combustible, transmisión, precio y link.
Si ya existe una categoría previa en la conversación, prioriza esa categoría al filtrar la marca.
Si no hay unidades de esa marca, dilo explícitamente en una frase completa y ofrece de inmediato 2 alternativas reales del mismo tipo de vehículo que el cliente venía viendo.

CUANDO EL CLIENTE TIENE PRESUPUESTO:
Muestra los 2-3 mejores autos dentro de ese rango. Si el presupuesto es bajo para lo que pide, sugiere la opción más cercana que sí existe.

═══════════════════════════════════════
GUÍA DE CONVERSACIÓN
═══════════════════════════════════════
- Precio: confirma el precio publicado, menciona que tiene financiamiento disponible.
- Financiamiento: pide pie y plazo, ofrece simular cuota.
- Permuta: pregunta qué auto tiene para tasar.
- Visita/prueba: pide nombre + WhatsApp + día preferido.
- Cierre: cuando haya interés claro, pide los datos directamente: "¿Me pasas tu nombre y WhatsApp para que un ejecutivo te confirme todo?"

═══════════════════════════════════════
DATOS DEL NEGOCIO
═══════════════════════════════════════
${_clientKnowledge}

═══════════════════════════════════════
INVENTARIO COMPLETO
═══════════════════════════════════════
${_inventoryText}
`.trim();
}

// ── Markdown stripper ────────────────────────────────────────────────────────
export function stripMarkdown(text) {
  if (!text) return null;
  return text
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, '$2')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_{2}([^_]+)_{2}/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .trim();
}

function finalizeReplyText(text) {
  if (!text) return null;
  const clean = text.trim();
  if (!clean) return null;
  if (/[.!?…]$/.test(clean)) return clean;
  const cut = Math.max(
    clean.lastIndexOf('. '),
    clean.lastIndexOf('! '),
    clean.lastIndexOf('? '),
  );
  if (cut >= 40) return clean.slice(0, cut + 1).trim();
  return `${clean}.`;
}

function fichaUrlFromCarId(carId) {
  const m = String(carId ?? '').match(/(\d{4,})$/);
  const numeric = m?.[1];
  return numeric ? `https://www.ald.cl/ficha/${numeric}/` : null;
}

function formatClp(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(n);
}

function detectMakeFromText(text) {
  const t = String(text ?? '').toLowerCase();
  const candidates = [..._makeIndex.keys()].sort((a, b) => b.length - a.length);
  for (const mk of candidates) {
    if (!mk) continue;
    if (t.includes(mk)) return _makeIndex.get(mk) ?? null;
  }
  return null;
}

function buildMakeInventoryReply(make) {
  const makeStr = String(make ?? '').trim();
  if (!makeStr) return null;
  const cars = (_aldStock ?? []).filter(
    (c) => String(c?.make ?? '').trim().toLowerCase() === makeStr.toLowerCase(),
  );
  if (cars.length === 0) return null;

  const top = cars
    .slice()
    .sort((a, b) => (Number(b?.year) || 0) - (Number(a?.year) || 0))
    .slice(0, 3);

  const lines = top
    .map((c) => {
      const year = Number(c?.year) || '';
      const model = String(c?.model ?? '').trim();
      const fuel = String(c?.fuelBadge ?? c?.fuelType ?? '').trim();
      const trans =
        String(c?.transmissionShort ?? '').trim() ||
        (String(c?.transmission ?? '').toLowerCase().includes('auto') ? 'AT' : 'MT');
      const price = formatClp(c?.price);
      const url = fichaUrlFromCarId(c?.id);
      if (!url) return null;
      return `- ${makeStr} ${model} ${year} · ${fuel || '—'} · ${trans || '—'} · ${price || ''} → ${url}`;
    })
    .filter(Boolean);

  if (lines.length === 0) return null;

  return [
    `Sí — tenemos ${makeStr} disponibles ahora mismo:`,
    '',
    ...lines,
    '',
    '¿Qué presupuesto aprox. tienes en mente? Así te recomiendo la mejor opción y alternativas similares.',
  ].join('\n');
}

// ── Session store ────────────────────────────────────────────────────────────
const _sessions = new Map();
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function getSession(key) {
  const existing = _sessions.get(key);
  const now = Date.now();
  if (existing && now - existing.seenAtMs > SESSION_TTL_MS) {
    _sessions.delete(key);
  }
  if (!_sessions.has(key)) {
    _sessions.set(key, {
      seenAt: new Date().toISOString(),
      seenAtMs: now,
      profile: null,
      marketplaceCar: null,
      contactInfo: null,
      carsDetected: [],
      interestCategories: [],
      leadSent: false,
      crmLeadId: null,
      history: [],
    });
  }
  return _sessions.get(key);
}

// ── Car / interest / contact detectors ───────────────────────────────────────
export function detectCarsFromText(text) {
  const lower = text.toLowerCase();
  const matches = [];
  const seen = new Set();
  const mentionedMakes = new Set();

  for (const car of _aldStock) {
    const key = car.id;
    if (seen.has(key)) continue;
    const makeLower = car.make.toLowerCase();
    const makeModel = `${car.make} ${car.model}`.toLowerCase();
    const modelOnly = car.model.toLowerCase().split(' ')[0];
    const id = String(car.id).replace(/^ald-/, '');

    const exactMatch =
      lower.includes(makeModel) ||
      lower.includes(id) ||
      (modelOnly.length >= 3 && lower.includes(modelOnly) && lower.includes(makeLower));

    if (exactMatch) {
      seen.add(key);
      matches.push({ id: car.id, make: car.make, model: car.model, year: car.year, price: car.price });
    } else if (lower.includes(makeLower) && makeLower.length >= 3) {
      mentionedMakes.add(makeLower);
    }
  }

  for (const car of _aldStock) {
    if (seen.has(car.id)) continue;
    if (mentionedMakes.has(car.make.toLowerCase())) {
      seen.add(car.id);
      matches.push({ id: car.id, make: car.make, model: car.model, year: car.year, price: car.price, makeOnly: true });
    }
  }

  return matches.length ? matches : null;
}

export function detectInterestFromText(text) {
  const lower = text.toLowerCase();
  const categories = ['suv', 'sedan', 'sedán', 'pickup', 'camioneta', 'eléctrico', 'electrico', 'hatchback', 'coupe', 'coupé'];
  return categories.filter((c) => lower.includes(c));
}

export function extractContactFromText(text) {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  const phone =
    text.match(/\+?56\s*9\s*\d{4}\s*-?\s*\d{4}/)?.[0] ??
    text.match(/\b9\s*\d{4}\s*\d{4}\b/)?.[0] ??
    text.match(/\b9\d{8}\b/)?.[0] ??
    text.match(/\+\d{8,12}\b/)?.[0] ??
    null;
  const nameMatch = text.match(
    /(?:me llamo|soy|mi nombre es)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/i,
  );
  const name = nameMatch?.[1] ?? null;
  return { email, phone, name, hasContact: Boolean(email || phone || name) };
}

// ── Messenger profile (only meaningful for FB Page webhook, not personal acct)
export async function fetchMessengerProfile(psid) {
  if (!PAGE_ACCESS_TOKEN || !psid) return null;
  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${psid}?fields=name,first_name,last_name&access_token=${PAGE_ACCESS_TOKEN}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Lead webhook (Google Sheet) ──────────────────────────────────────────────
export async function submitMessengerLead(payload) {
  if (!LEADS_WEBHOOK_URL) return;
  try {
    console.info('[lead] submitting to sheet', { event: payload.event, source: payload.source });
    await fetch(LEADS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('[lead] webhook error', e);
  }
}

/**
 * Shared lead capture + CRM sync — fire-and-forget from every inbound handler.
 */
export async function captureAndSyncLead(key, text, reply, source, opts = {}) {
  const session = getSession(key);

  if (source === 'messenger' && !session.profile && PAGE_ACCESS_TOKEN) {
    session.profile = await fetchMessengerProfile(key);
  }

  if ((source === 'whatsapp' || source === 'whatsapp_personal') && !session.contactInfo?.phone) {
    session.contactInfo = session.contactInfo ?? {};
    session.contactInfo.phone = key;
  }

  if (opts.displayName && !session.profile) {
    session.profile = { name: opts.displayName };
  }

  // Detect ChileAutos referral from the pre-filled WhatsApp message
  // ("me interesa el X que vi en ChileAutos")
  if (!session.marketplaceCar && /chileautos/i.test(text)) {
    session.marketplaceCar = { source: 'chileautos' };
  }

  const carsDetected = detectCarsFromText(text);
  const interestCategories = detectInterestFromText(text);
  const contactFound = extractContactFromText(text);
  const isFirstMessage = !session.leadSent;

  const prevCarIds = new Set((session.carsDetected ?? []).map((c) => c.id));
  const newCarFound = (carsDetected ?? []).some((c) => !prevCarIds.has(c.id));
  const newCategory = interestCategories.some((c) => !(session.interestCategories ?? []).includes(c));

  if (contactFound.hasContact) {
    session.contactInfo = session.contactInfo ?? {};
    if (contactFound.phone) session.contactInfo.phone = contactFound.phone;
    if (contactFound.email) session.contactInfo.email = contactFound.email;
    if (contactFound.name) session.contactInfo.name = contactFound.name;
  }

  if (carsDetected) {
    const existingIds = new Set((session.carsDetected ?? []).map((c) => c.id));
    for (const car of carsDetected) {
      if (!existingIds.has(car.id)) {
        session.carsDetected = [...(session.carsDetected ?? []), car];
        existingIds.add(car.id);
      }
    }
  }

  if (interestCategories.length) {
    session.interestCategories = [
      ...new Set([...(session.interestCategories ?? []), ...interestCategories]),
    ];
  }

  const shouldLog = isFirstMessage || newCarFound || newCategory || contactFound.hasContact;
  if (!shouldLog) return;

  session.leadSent = true;
  const event = isFirstMessage
    ? 'first_contact'
    : contactFound.hasContact
    ? 'contact_shared'
    : 'car_detected';

  await submitMessengerLead({
    source,
    upsertKey: key,
    event,
    sentAt: new Date().toISOString(),
    psid: key,
    fbName: session.profile?.name ?? null,
    fbFirstName: session.profile?.first_name ?? null,
    fbLastName: session.profile?.last_name ?? null,
    extractedName: session.contactInfo?.name ?? null,
    phone: session.contactInfo?.phone ?? null,
    email: session.contactInfo?.email ?? null,
    marketplaceCar: session.marketplaceCar ?? null,
    carsDetected: session.carsDetected ?? null,
    interestCategories: session.interestCategories ?? null,
    lastMessage: text,
    lastBotReply: reply?.slice(0, 500) ?? null,
  });

  const nombre =
    session.profile?.name ?? session.contactInfo?.name ?? 'Prospecto Web';
  const firstCar = session.carsDetected?.[0] ?? null;
  const modeloStr = firstCar ? `${firstCar.make} ${firstCar.model} ${firstCar.year}` : '';
  const normalizedSource = session.marketplaceCar?.source === 'chileautos'
    ? 'chileautos'
    : source.replace(/_personal$/, '');
  const origen = crmOrigen(normalizedSource, !!session.marketplaceCar);

  if (!session.crmLeadId) {
    const leadId = await crmCreateLead({
      nombre,
      telefono: session.contactInfo?.phone ?? '',
      email: session.contactInfo?.email ?? '',
      marca: firstCar?.make ?? '',
      modelo: modeloStr,
      origen,
      mensaje: `[${source.toUpperCase()}] ${text.slice(0, 500)}`,
      link: `psid:${key}`,
    });
    if (leadId) session.crmLeadId = leadId;
  } else {
    await crmUpdateLead(session.crmLeadId, {
      nombre1: nombre,
      telefono1: session.contactInfo?.phone ?? '',
      email1: session.contactInfo?.email ?? '',
      modelo: modeloStr,
      estado: '2',
      vendedor: CRM_VENDEDOR,
      mensaje: `[${source.toUpperCase()}] ${text.slice(0, 500)}`,
    });
  }
}

// ── Gemini reply (with session history) ──────────────────────────────────────
let _ai = null;
function getAi() {
  if (_ai) return _ai;
  if (!GEMINI_API_KEY) return null;
  _ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return _ai;
}

const GEMINI_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS ?? 550);

export async function generateReply(key, userText) {
  const ai = getAi();
  // Token-saver: answer pure brand availability queries directly from inventory
  const make = detectMakeFromText(userText);
  if (make) {
    const direct = buildMakeInventoryReply(make);
    if (direct) return direct;
  }
  if (!ai) return null;
  const session = getSession(key);
  try {
    const contents = [
      ...session.history,
      { role: 'user', parts: [{ text: userText }] },
    ];
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: _buildSystemPrompt(), // always fresh — picks up inventory refreshes
        temperature: 0.35,
        maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      },
    });
    const raw = res.text?.trim() ?? null;
    const reply = finalizeReplyText(stripMarkdown(raw));
    const usage = res.usageMetadata;
    if (usage) {
      console.info(
        `[gemini] tokens in=${usage.promptTokenCount ?? '?'} out=${usage.candidatesTokenCount ?? '?'} total=${usage.totalTokenCount ?? '?'}`,
      );
    }
    if (reply) {
      session.history = [
        ...session.history,
        { role: 'user', parts: [{ text: userText }] },
        { role: 'model', parts: [{ text: reply }] },
      ].slice(-12);
    }
    return reply;
  } catch (e) {
    console.error('[gemini]', e.message);
    return null;
  }
}

// ── Message debouncer ─────────────────────────────────────────────────────────
const DEBOUNCE_MS = Number(process.env.MESSAGE_DEBOUNCE_MS ?? 3500);
const DEBOUNCE_MAX_MS = Number(process.env.MESSAGE_DEBOUNCE_MAX_MS ?? 12000);
const _debounceBuffers = new Map();

export function enqueueAndGenerateReply(sessionId, userText) {
  return new Promise((resolve) => {
    let buf = _debounceBuffers.get(sessionId);
    if (!buf) {
      buf = {
        texts: [],
        resolvers: [],
        softTimer: null,
        hardTimer: null,
        firstAt: Date.now(),
        flushed: false,
      };
      _debounceBuffers.set(sessionId, buf);
    }
    buf.texts.push(userText);
    buf.resolvers.push(resolve);

    const flush = async () => {
      if (buf.flushed) return;
      buf.flushed = true;
      if (buf.softTimer) clearTimeout(buf.softTimer);
      if (buf.hardTimer) clearTimeout(buf.hardTimer);
      _debounceBuffers.delete(sessionId);

      const merged = buf.texts.join('\n').trim();
      const fragments = buf.texts.length;
      const resolvers = buf.resolvers;

      if (fragments > 1) {
        console.info(
          `[debounce] merged ${fragments} fragments for ${sessionId}: "${merged.slice(0, 100).replace(/\n/g, ' / ')}"`,
        );
      }

      try {
        const reply = await generateReply(sessionId, merged);
        for (let i = 0; i < resolvers.length - 1; i++) {
          resolvers[i]({ reply: null, merged: '', fragments: 0 });
        }
        resolvers[resolvers.length - 1]({ reply, merged, fragments });
      } catch (e) {
        console.error('[debounce] generateReply error:', e.message);
        for (const r of resolvers) r({ reply: null, merged: '', fragments: 0 });
      }
    };

    if (buf.softTimer) clearTimeout(buf.softTimer);
    buf.softTimer = setTimeout(flush, DEBOUNCE_MS);

    if (!buf.hardTimer) {
      const remaining = Math.max(0, DEBOUNCE_MAX_MS - (Date.now() - buf.firstAt));
      buf.hardTimer = setTimeout(flush, remaining);
    }
  });
}
