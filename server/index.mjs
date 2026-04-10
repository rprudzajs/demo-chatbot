/**
 * Single process: Meta webhooks (Messenger Page + WhatsApp Cloud API) + static Vite `dist/`.
 *
 * Env (Railway, server-only):
 *   META_WEBHOOK_VERIFY_TOKEN   — shared verify string for Messenger + WhatsApp webhooks
 *   MESSENGER_VERIFY_TOKEN       — fallback if META_WEBHOOK_VERIFY_TOKEN unset
 *   MESSENGER_PAGE_ACCESS_TOKEN  — Page token; Messenger Send API
 *   MESSENGER_PAGE_ID            — numeric Page id; use with token (avoids /me errors)
 *   WHATSAPP_PHONE_NUMBER_ID     — Cloud API phone-number id (numeric)
 *   WHATSAPP_ACCESS_TOKEN        — Cloud API token (never expose to browser)
 *   META_APP_SECRET              — optional; verifies X-Hub-Signature-256 for POST
 *   MESSENGER_AUTO_REPLY         — optional Messenger text fallback (if Gemini fails)
 *   WHATSAPP_AUTO_REPLY          — optional WhatsApp text fallback (if Gemini fails)
 *   GEMINI_API_KEY               — Gemini AI key for auto-replies on both channels
 *   GEMINI_MODEL                 — optional; default gemini-2.0-flash
 *   MESSENGER_FALLBACK_REPLY     — optional; used if Gemini fails and AUTO_REPLY unset
 *   LEADS_WEBHOOK_URL            — Google Apps Script sheet webhook URL
 *   FULLMOTOR_CRM_EMAIL          — FullMotor CRM account email for lead sync
 *   FULLMOTOR_CRM_PASSWORD       — FullMotor CRM account password
 *   FULLMOTOR_CRM_VENDEDOR       — salesperson email assigned to auto-created leads
 */
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { GoogleGenAI } from '@google/genai';
import { crmCreateLead, crmUpdateLead, crmOrigen, CRM_VENDEDOR } from './fullmotor-crm.mjs';

const _require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

const PORT = Number(process.env.PORT) || 3000;
const VERIFY_TOKEN = String(
  process.env.META_WEBHOOK_VERIFY_TOKEN ?? process.env.MESSENGER_VERIFY_TOKEN ?? '',
).trim();
const PAGE_ACCESS_TOKEN = String(process.env.MESSENGER_PAGE_ACCESS_TOKEN ?? '').trim();
const MESSENGER_PAGE_ID = String(process.env.MESSENGER_PAGE_ID ?? '').trim();
const APP_SECRET = String(process.env.META_APP_SECRET ?? '').trim();
const MESSENGER_AUTO_REPLY = String(process.env.MESSENGER_AUTO_REPLY ?? '').trim();
const WHATSAPP_PHONE_NUMBER_ID = String(process.env.WHATSAPP_PHONE_NUMBER_ID ?? '').trim();
const WHATSAPP_ACCESS_TOKEN = String(process.env.WHATSAPP_ACCESS_TOKEN ?? '').trim();
const WHATSAPP_AUTO_REPLY = String(process.env.WHATSAPP_AUTO_REPLY ?? '').trim();
const MAKE_INBOUND_SECRET = String(process.env.MAKE_INBOUND_SECRET ?? '').trim();
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY ?? '').trim();
const GEMINI_MODEL = String(process.env.GEMINI_MODEL ?? 'gemini-2.0-flash').trim();
const MESSENGER_FALLBACK_REPLY = String(
  process.env.MESSENGER_FALLBACK_REPLY ??
    'Gracias por escribirnos. Un asesor te responderá a la brevedad.',
).trim();
const LEADS_WEBHOOK_URL = String(process.env.LEADS_WEBHOOK_URL ?? process.env.VITE_LEADS_WEBHOOK_URL ?? '').trim();
const GRAPH_VERSION = 'v21.0';

/**
 * PSIDs are long numeric strings. JSON numbers lose precision (> Number.MAX_SAFE_INTEGER) — Make must map psid as string.
 * Strips accidental < > from mapped values.
 */
function normalizeMessengerPsid(raw) {
  if (raw == null) return '';
  if (typeof raw === 'number') {
    console.warn(
      '[make-messenger] psid sent as JSON number — precision may be lost. Map PSID as text/string in Make JSON.',
    );
  }
  let s = String(raw).trim().replace(/^<+/, '').replace(/>+$/, '').trim();
  if (!/^\d+$/.test(s)) return '';
  return s;
}

// ── Full car-brain system prompt (same brain as the demo website) ──
const _aldStock = (() => {
  try {
    return _require('../data/ald-stock-base.json');
  } catch {
    return [];
  }
})();

const _inventoryText = (() => {
  if (!_aldStock.length) return '(inventario no disponible)';
  const lines = _aldStock.map((car) => {
    const numericId = String(car.id).replace(/^ald-/, '');
    const price = car.currency === 'CLP'
      ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(car.price)
      : `$${Number(car.price).toLocaleString('en-US')}`;
    const notes = [car.listHeadline, car.listSubtitle].filter(Boolean).join(' · ');
    const fichaUrl = `https://www.ald.cl/ficha/${numericId}/`;
    const noteLine = notes ? `\n  Notas: ${notes}` : '';
    return `- ${car.year} ${car.make} ${car.model} (id ${numericId}): ${price}\n  KM: ${Number(car.mileage).toLocaleString('es-CL')} km · ${car.transmission} · ${car.fuelType}\n  Ficha: ${fichaUrl}${noteLine}`;
  });
  return lines.join('\n') + `\n\nResumen: ${_aldStock.length} unidades en inventario. Solo usa precios y datos de esta lista; si falta algo, ofrece confirmación con un ejecutivo.`;
})();

const _clientKnowledge = `
Marca comercial: ALD Autos. Sitio: https://www.ald.cl — sección stock: /stock.
UBICACIÓN: Comandante Malbec 13495, Lo Barnechea, Chile.
TELÉFONOS: (+56 9) 7459-6700 · (+56 9) 7285-3439 · (+56 9) 6618-1755 · Consignación: (+56 9) 9294-3779
HORARIO: Lunes a viernes 09:00–19:00 · Sábado 10:00–14:00
MONEDA: precios en pesos chilenos (CLP).
Si el usuario pide un dato no listado, no inventes — ofrece derivar a un ejecutivo por WhatsApp o llamada.
`.trim();

const MESSENGER_GEMINI_SYSTEM = `
Eres el asesor de ventas de ALD Autos — seminuevos premium en Santiago. Eres experto, proactivo y humano. Tu meta: convertir cada conversación en una visita o contacto real.

═══════════════════════════════════════
REGLAS ABSOLUTAS (nunca las rompas)
═══════════════════════════════════════
1. IDIOMA: Siempre español chileno. Tutéalo al cliente.
2. SOLO OFRECE LO QUE EXISTE en el inventario. Jamás inventes un auto, precio o característica.
3. FILTRA POR CATEGORÍA PRIMERO: Si el cliente pide un tipo de vehículo (camioneta, SUV, sedán, etc.), solo muestra autos de esa categoría. No mezcles tipos aunque sean de la marca solicitada.
4. FORMATO: Texto plano. Sin asteriscos, sin corchetes, sin markdown. URLs limpias: https://www.ald.cl/ficha/250702/ — nunca [link](url).
5. Respuestas cortas: máx 3 párrafos, 2 frases cada uno. Separa párrafos con línea en blanco.
6. Emojis: máx 1-2 por respuesta, solo para calidez.
7. LISTAS DE AUTOS: Cuando muestres 2 o más autos, SIEMPRE usa este formato exacto (un auto por línea, guión al inicio, sin texto extra antes de la lista):
- Nissan Navara XE 2022 · Diesel · AT · $21.990.000 → https://www.ald.cl/ficha/250226/
- Mazda BT-50 SDX 2019 · Diesel · MT · $10.490.000 → https://www.ald.cl/ficha/224791/
NUNCA escribas un auto como párrafo cuando hay más de uno. Siempre lista, siempre con guión.
8. MEMORIA Y CONTINUIDAD: El historial completo de la conversación está arriba. Úsalo siempre.
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
No preguntes qué buscan — ya lo harás después. Primero preséntate brevemente y muestra 2-3 autos destacados del inventario (mezcla de categorías y rangos de precio). Luego pregunta qué tipo de auto les interesa.

Ejemplo de apertura correcta:
"¡Hola! Soy el asesor de ALD Autos 👋 Tenemos 95 autos seminuevos en Lo Barnechea.

Algunos destacados de hoy: Nissan Navara 2022 pickup 4WD ($21.990.000), Jeep Wrangler Rubicon 2021 ($39.990.000), Mercedes-Benz A200 2020 ($22.990.000).

¿Qué tipo de vehículo estás buscando? ¿Tienes algún presupuesto en mente?"

CUANDO EL CLIENTE DA UNA CATEGORÍA:
Muestra 2-3 opciones concretas de esa categoría con precio y año. No hagas más preguntas antes de mostrar opciones — primero ofrece, luego afina.

CUANDO EL CLIENTE DA CATEGORÍA + MARCA:
Filtra al cruce exacto. Si hay 1 solo resultado, muéstralo con detalle completo (ficha, precio, km, transmisión). Si no hay ninguno, dilo honestamente y ofrece alternativas similares.

CUANDO EL CLIENTE MENCIONA UN AUTO QUE YA OFRECISTE:
Si el cliente dice "me gusta la Mazda", "me interesa ese", "cuéntame más del Nissan", etc. refiriéndose a un auto que TÚ ya mencionaste en la conversación — NO preguntes qué tipo busca. Ya sabes exactamente a cuál se refiere. Muéstrale la ficha completa de ESE auto: precio, km, transmisión, combustible, y link. Luego ofrece agendar una visita.

CUANDO EL CLIENTE DA SOLO UNA MARCA (sin haber visto opciones antes y sin categoría establecida):
NUNCA listes todos los autos de esa marca — son tipos muy distintos y eso confunde.
Primero pregunta: "¿Qué tipo de vehículo buscas — camioneta, SUV, sedán?"
Si ya se estableció una categoría antes en la conversación, úsala directamente para filtrar.

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

/** Strip markdown formatting from Gemini replies (Messenger/WA are plain text) */
function stripMarkdown(text) {
  if (!text) return null;
  return text
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, '$2')   // [text](url) → url
    .replace(/\*\*([^*]+)\*\*/g, '$1')            // **bold** → plain
    .replace(/\*([^*]+)\*/g, '$1')                // *italic* → plain
    .replace(/_{2}([^_]+)_{2}/g, '$1')            // __bold__ → plain
    .replace(/_([^_]+)_/g, '$1')                  // _italic_ → plain
    .replace(/`([^`]+)`/g, '$1')                  // `code` → plain
    .replace(/#{1,6}\s+/g, '')                    // ## headers → plain
    .trim();
}

// ── Session store (in-memory, resets on redeploy) ────────────────────────────
const _sessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h — after this, same person = new lead row

function getSession(psid) {
  const existing = _sessions.get(psid);
  const now = Date.now();
  // Expire session after 24h → next message treated as fresh contact
  if (existing && (now - existing.seenAtMs) > SESSION_TTL_MS) {
    _sessions.delete(psid);
  }
  if (!_sessions.has(psid)) {
    _sessions.set(psid, {
      seenAt: new Date().toISOString(),
      seenAtMs: now,
      profile: null,
      marketplaceCar: null,
      contactInfo: null,
      carsDetected: [],        // accumulates ALL cars mentioned across conversation
      interestCategories: [],
      leadSent: false,
      crmLeadId: null,         // FullMotor CRM lead ID once created
      history: [],             // [{role:'user'|'model', parts:[{text}]}] — Gemini multi-turn
    });
  }
  return _sessions.get(psid);
}

// ── Lead helpers ──────────────────────────────────────────────────────────────

/** Fetch FB user name from Graph API using PSID + Page token */
async function fetchMessengerProfile(psid) {
  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${psid}?fields=name,first_name,last_name&access_token=${PAGE_ACCESS_TOKEN}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Detect which car(s) are mentioned in text against inventory */
function detectCarsFromText(text) {
  const lower = text.toLowerCase();
  const matches = [];
  const seen = new Set();

  // Track which makes are mentioned alone (no model) to flag all cars of that brand
  const mentionedMakes = new Set();

  for (const car of _aldStock) {
    const key = car.id;
    if (seen.has(key)) continue;
    const makeLower = car.make.toLowerCase();
    const makeModel = `${car.make} ${car.model}`.toLowerCase();
    const modelOnly = car.model.toLowerCase().split(' ')[0]; // e.g. "3008" from "3008 GT"
    const id = String(car.id).replace(/^ald-/, '');

    const exactMatch =
      lower.includes(makeModel) ||
      lower.includes(id) ||
      (modelOnly.length >= 3 && lower.includes(modelOnly) && lower.includes(makeLower));

    if (exactMatch) {
      seen.add(key);
      matches.push({ id: car.id, make: car.make, model: car.model, year: car.year, price: car.price });
    } else if (lower.includes(makeLower) && makeLower.length >= 3) {
      // Make-only mention (e.g. "ferrari", "BMW") — collect all cars of that brand
      mentionedMakes.add(makeLower);
    }
  }

  // Add all cars for make-only mentions that aren't already matched
  for (const car of _aldStock) {
    if (seen.has(car.id)) continue;
    if (mentionedMakes.has(car.make.toLowerCase())) {
      seen.add(car.id);
      matches.push({ id: car.id, make: car.make, model: car.model, year: car.year, price: car.price, makeOnly: true });
    }
  }

  return matches.length ? matches : null;
}

/** Detect broad interest category from user message */
function detectInterestFromText(text) {
  const lower = text.toLowerCase();
  const categories = ['suv', 'sedan', 'sedán', 'pickup', 'camioneta', 'eléctrico', 'electrico', 'hatchback', 'coupe', 'coupé'];
  return categories.filter(c => lower.includes(c));
}

/** Extract phone/email/name from a message */
function extractContactFromText(text) {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  const phone =
    text.match(/\+?56\s*9\s*\d{4}\s*-?\s*\d{4}/)?.[0] ??
    text.match(/\b9\s*\d{4}\s*\d{4}\b/)?.[0] ??
    text.match(/\b9\d{8}\b/)?.[0] ??
    text.match(/\+\d{8,12}\b/)?.[0] ??
    null;
  // Simple name detection: "me llamo X" / "soy X" / "mi nombre es X"
  const nameMatch = text.match(/(?:me llamo|soy|mi nombre es)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/i);
  const name = nameMatch?.[1] ?? null;
  return { email, phone, name, hasContact: Boolean(email || phone || name) };
}

/** Post lead row to Google Sheet webhook */
async function submitMessengerLead(payload) {
  if (!LEADS_WEBHOOK_URL) return;
  try {
    console.info('[lead] submitting to sheet', { event: payload.event, fbName: payload.fbName });
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
 * Shared lead capture + CRM sync — called fire-and-forget from every inbound message handler.
 *
 * @param {string} psid   Messenger PSID or WhatsApp phone number (unique conversation key)
 * @param {string} text   Inbound user message
 * @param {string|null} reply  Bot reply text (may be null if send failed)
 * @param {'messenger'|'whatsapp'|'web_chat'} source
 */
async function captureAndSyncLead(psid, text, reply, source) {
  const session = getSession(psid);

  // Fetch Messenger profile once (not available for WhatsApp)
  if (source === 'messenger' && !session.profile && PAGE_ACCESS_TOKEN) {
    session.profile = await fetchMessengerProfile(psid);
  }

  // WhatsApp: phone is the psid itself — pre-seed contactInfo
  if (source === 'whatsapp' && !session.contactInfo?.phone) {
    session.contactInfo = session.contactInfo ?? {};
    session.contactInfo.phone = psid;
  }

  // Only detect cars the USER mentioned — not what the bot offered.
  // Running detection on the bot reply would add every proactively suggested car to the lead.
  const carsDetected = detectCarsFromText(text);
  const interestCategories = detectInterestFromText(text);
  const contactFound = extractContactFromText(text);
  const isFirstMessage = !session.leadSent;

  // Detect genuinely new data before merging
  const prevCarIds = new Set((session.carsDetected ?? []).map(c => c.id));
  const newCarFound = (carsDetected ?? []).some(c => !prevCarIds.has(c.id));
  const newCategory = interestCategories.some(c => !(session.interestCategories ?? []).includes(c));

  // Merge contact signals
  if (contactFound.hasContact) {
    session.contactInfo = session.contactInfo ?? {};
    if (contactFound.phone) session.contactInfo.phone = contactFound.phone;
    if (contactFound.email) session.contactInfo.email = contactFound.email;
    if (contactFound.name) session.contactInfo.name = contactFound.name;
  }

  // Accumulate detected cars
  if (carsDetected) {
    const existingIds = new Set((session.carsDetected ?? []).map(c => c.id));
    for (const car of carsDetected) {
      if (!existingIds.has(car.id)) {
        session.carsDetected = [...(session.carsDetected ?? []), car];
        existingIds.add(car.id);
      }
    }
  }

  // Accumulate interest categories
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

  // ── Google Sheet webhook ──
  await submitMessengerLead({
    source,
    upsertKey: psid,
    event,
    sentAt: new Date().toISOString(),
    psid,
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

  // ── FullMotor CRM sync ──
  const nombre =
    session.profile?.name ??
    session.contactInfo?.name ??
    'Prospecto Web';
  const firstCar = session.carsDetected?.[0] ?? null;
  const modeloStr = firstCar
    ? `${firstCar.make} ${firstCar.model} ${firstCar.year}`
    : '';
  const origen = crmOrigen(source, !!session.marketplaceCar);

  if (!session.crmLeadId) {
    const leadId = await crmCreateLead({
      nombre,
      telefono: session.contactInfo?.phone ?? '',
      email: session.contactInfo?.email ?? '',
      marca: firstCar?.make ?? '',
      modelo: modeloStr,
      origen,
      mensaje: `[${source.toUpperCase()}] ${text.slice(0, 500)}`,
      link: `psid:${psid}`,
    });
    if (leadId) {
      session.crmLeadId = leadId;
    }
  } else {
    await crmUpdateLead(session.crmLeadId, {
      nombre1: nombre,
      telefono1: session.contactInfo?.phone ?? '',
      email1: session.contactInfo?.email ?? '',
      modelo: modeloStr,
      estado: '2', // VOLVER A LLAMAR
      vendedor: CRM_VENDEDOR,
      mensaje: `[${source.toUpperCase()}] ${text.slice(0, 500)}`,
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────────

const app = express();

app.disable('x-powered-by');

/** Webhook verification (GET) */
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && VERIFY_TOKEN && token === VERIFY_TOKEN) {
    return res.status(200).send(String(challenge));
  }
  if (!VERIFY_TOKEN) {
    return res
      .status(503)
      .send('Set META_WEBHOOK_VERIFY_TOKEN or MESSENGER_VERIFY_TOKEN for webhook verify');
  }
  return res.sendStatus(403);
});

/** Inbound events (POST) — need raw body for signature check */
app.post('/webhook', express.raw({ type: 'application/json', limit: '2mb' }), (req, res) => {
  const rawBody = req.body;
  const sig = req.get('x-hub-signature-256') || '';
  const len = Buffer.isBuffer(rawBody) ? rawBody.length : 0;
  console.info(
    `[webhook] POST bytes=${len} x-hub-signature-256=${sig ? 'present' : 'missing'} meta_app_secret=${APP_SECRET ? 'set' : 'unset'}`,
  );

  if (APP_SECRET && Buffer.isBuffer(rawBody) && rawBody.length) {
    const expected =
      'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
    if (!sig || sig !== expected) {
      console.warn(
        '[webhook] 401 signature mismatch — fix META_APP_SECRET to match App Dashboard → Basic → App secret, or remove META_APP_SECRET to test without verification',
      );
      return res.sendStatus(401);
    }
  }

  let body = {};
  try {
    body = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : '{}');
  } catch {
    body = {};
  }

  const entries = Array.isArray(body.entry) ? body.entry.length : 0;
  console.info(`[webhook] parsed object=${body.object ?? 'none'} entries=${entries}`);

  res.sendStatus(200);

  setImmediate(() => {
    handleWebhook(body).catch((e) => console.error('[meta webhook]', e));
  });
});

/**
 * Make.com forwards Messenger events here when Meta’s callback URL points to Make.
 * Headers: Authorization: Bearer <MAKE_INBOUND_SECRET>  (or X-Make-Secret: same)
 * Body JSON: { "psid": "...", "text": "..." } — aliases: sender_id, message, body
 */
app.post('/api/make-messenger', express.json({ limit: '256kb' }), async (req, res) => {
  if (!MAKE_INBOUND_SECRET) {
    return res
      .status(503)
      .json({ error: 'MAKE_INBOUND_SECRET is not configured on the server' });
  }

  const auth = String(req.get('authorization') ?? '');
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const headerSecret = String(req.get('x-make-secret') ?? '').trim();
  const token = bearer || headerSecret;
  if (!token || token !== MAKE_INBOUND_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const psidRaw = body.psid ?? body.sender_id ?? body.sender?.id;
  const psidWasNumber = typeof psidRaw === 'number';
  const psid = normalizeMessengerPsid(psidRaw);
  const text = String(body.text ?? body.message ?? body.body ?? '').trim();

  if (!psid) {
    return res.status(400).json({
      error: 'Invalid or missing psid',
      hint:
        'Map Sender PSID as a string in JSON (not a number). In Make: ensure the PSID field is string type; remove < > around tokens.',
      debug: {
        psidWasNumber,
        psidRawType: typeof psidRaw,
        psidRawPreview: psidRaw == null ? null : String(psidRaw).slice(0, 80),
      },
    });
  }
  if (!text) {
    return res.status(200).json({ ok: true, skipped: 'no_text' });
  }
  if (!PAGE_ACCESS_TOKEN) {
    return res.status(503).json({ error: 'MESSENGER_PAGE_ACCESS_TOKEN is not set' });
  }

  console.info('[make-messenger]', { psid, textLen: text.length });

  let reply = null;
  let replySource = 'none';
  if (GEMINI_API_KEY) {
    try {
      const session = getSession(psid);
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const contents = [
        ...(session.history ?? []),
        { role: 'user', parts: [{ text }] },
      ];
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: { systemInstruction: MESSENGER_GEMINI_SYSTEM, temperature: 0.7 },
      });
      reply = stripMarkdown(response.text?.trim() || null);
      if (reply) {
        replySource = 'gemini';
        session.history = [
          ...(session.history ?? []),
          { role: 'user', parts: [{ text }] },
          { role: 'model', parts: [{ text: reply }] },
        ].slice(-20);
      }
    } catch (e) {
      console.error('[make-messenger] gemini', e);
    }
  } else {
    console.warn(
      '[make-messenger] GEMINI_API_KEY unset on server — set it on Railway for AI replies (not VITE_ only)',
    );
  }

  if (!reply && MESSENGER_AUTO_REPLY) {
    reply = MESSENGER_AUTO_REPLY;
    replySource = 'MESSENGER_AUTO_REPLY';
  }

  if (!reply && MESSENGER_FALLBACK_REPLY) {
    reply = MESSENGER_FALLBACK_REPLY;
    replySource = 'MESSENGER_FALLBACK_REPLY';
  }

  if (!reply) {
    return res.status(200).json({
      ok: true,
      sent: false,
      reason: 'No reply text available',
    });
  }

  const sendResult = await sendMessengerText(psid, reply);
  console.info('[make-messenger] send', {
    ok: sendResult.ok,
    replySource,
    preview: reply.slice(0, 80),
    graphStatus: sendResult.status,
  });

  // ── Lead capture + CRM sync — fire and forget ──
  setImmediate(() => captureAndSyncLead(psid, text, reply, 'messenger').catch(e => console.error('[lead]', e)));
  const payload = {
    ok: sendResult.ok,
    sent: sendResult.ok,
    replySource,
    replyPreview: reply.slice(0, 160),
    debug: {
      psidPreview:
        psid.length > 12 ? `${psid.slice(0, 6)}...${psid.slice(-4)}` : psid,
      psidLen: psid.length,
      psidWasNumber,
      textLen: text.length,
    },
  };
  if (!sendResult.ok) {
    payload.graphHttpStatus = sendResult.status;
    payload.graphError = sendResult.errorSummary;
    payload.graphErrorRaw = sendResult.body?.slice(0, 800);
  }
  return res.status(sendResult.ok ? 200 : 502).json(payload);
});

async function handleWebhook(body) {
  const object = body.object;
  if (object === 'whatsapp_business_account') {
    await handleWhatsAppWebhook(body);
    return;
  }
  if (object === 'page') {
    await handleMessengerWebhook(body);
    return;
  }
  if (object) {
    console.info('[webhook] unhandled object type:', object);
  }
}

async function handleMessengerWebhook(body) {
  const entries = body.entry || [];
  for (const entry of entries) {
    const messaging = entry.messaging || [];
    for (const event of messaging) {
      if (event.message?.is_echo) continue;
      const psid = event.sender?.id;
      const text = event.message?.text;
      const attachments = event.message?.attachments;
      if (!psid) continue;

      // Capture Marketplace ad referral — Meta sends this on first message from a listing
      const referral = event.referral ?? event.message?.referral ?? null;
      if (referral) {
        const session = getSession(psid);
        const adTitle = referral.ads_context_data?.ad_title ?? null;
        const productId = referral.product?.id ?? null;
        // Try to match the Marketplace product to our inventory
        let matchedCar = null;
        if (productId) {
          matchedCar = _aldStock.find(c => String(c.id).replace(/^ald-/, '') === String(productId)) ?? null;
        }
        if (!matchedCar && adTitle) {
          const lower = adTitle.toLowerCase();
          matchedCar = _aldStock.find(c => lower.includes(c.make.toLowerCase()) && lower.includes(c.model.toLowerCase())) ?? null;
        }
        if (matchedCar || adTitle) {
          session.marketplaceCar = matchedCar
            ? { id: matchedCar.id, make: matchedCar.make, model: matchedCar.model, year: matchedCar.year, price: matchedCar.price }
            : { adTitle, productId };
          console.info('[marketplace referral]', { psid, adTitle, productId, matched: !!matchedCar });
        }
      }

      console.info('[messenger inbound]', {
        psid,
        text: text?.slice(0, 500) || null,
        attachmentTypes: attachments?.map((a) => a.type) || [],
        hasReferral: !!referral,
      });

      if (!text || !PAGE_ACCESS_TOKEN) continue;

      // ── Full AI reply + lead capture (same logic as /api/make-messenger) ──
      let reply = null;
      let replySource = 'none';

      if (GEMINI_API_KEY) {
        try {
          const session = getSession(psid);
          const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
          // Build multi-turn contents: history + current user message
          const contents = [
            ...(session.history ?? []),
            { role: 'user', parts: [{ text }] },
          ];
          const response = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents,
            config: { systemInstruction: MESSENGER_GEMINI_SYSTEM, temperature: 0.7 },
          });
          reply = stripMarkdown(response.text?.trim() || null);
          if (reply) {
            replySource = 'gemini';
            // Append this turn to session history (keep last 20 turns max)
            session.history = [
              ...(session.history ?? []),
              { role: 'user', parts: [{ text }] },
              { role: 'model', parts: [{ text: reply }] },
            ].slice(-20);
          }
        } catch (e) {
          console.error('[webhook gemini]', e);
        }
      }

      if (!reply && MESSENGER_AUTO_REPLY) { reply = MESSENGER_AUTO_REPLY; replySource = 'auto'; }
      if (!reply && MESSENGER_FALLBACK_REPLY) { reply = MESSENGER_FALLBACK_REPLY; replySource = 'fallback'; }
      if (!reply) continue;

      await sendMessengerText(psid, reply);
      console.info('[webhook send]', { psid, replySource, preview: reply.slice(0, 80) });

      // ── Lead capture + CRM sync — fire and forget ──
      setImmediate(() => captureAndSyncLead(psid, text, reply, 'messenger').catch(e => console.error('[lead]', e)));
    }
  }
}

async function handleWhatsAppWebhook(body) {
  const entries = body.entry || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const value = change.value || {};
      const messages = value.messages || [];
      const meta = value.metadata || {};

      for (const msg of messages) {
        if (msg.type !== 'text' || !msg.text?.body) continue;
        const from = msg.from;
        if (!from) continue;

        const text = msg.text.body;

        console.info('[whatsapp inbound]', {
          from,
          phone_number_id: meta.phone_number_id || null,
          text: text.slice(0, 500),
        });

        if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) continue;

        // ── Gemini AI reply (same brain as Messenger) ──
        let reply = null;
        let replySource = 'none';

        if (GEMINI_API_KEY) {
          try {
            const waSession = getSession(from);
            // Pre-seed phone from the WA number on first message
            if (!waSession.contactInfo) {
              waSession.contactInfo = { phone: from };
            }
            const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
            const contents = [
              ...(waSession.history ?? []),
              { role: 'user', parts: [{ text }] },
            ];
            const response = await ai.models.generateContent({
              model: GEMINI_MODEL,
              contents,
              config: { systemInstruction: MESSENGER_GEMINI_SYSTEM, temperature: 0.7 },
            });
            reply = stripMarkdown(response.text?.trim() || null);
            if (reply) {
              replySource = 'gemini';
              waSession.history = [
                ...(waSession.history ?? []),
                { role: 'user', parts: [{ text }] },
                { role: 'model', parts: [{ text: reply }] },
              ].slice(-20);
            }
          } catch (e) {
            console.error('[whatsapp gemini]', e);
          }
        }

        if (!reply && WHATSAPP_AUTO_REPLY) { reply = WHATSAPP_AUTO_REPLY; replySource = 'auto'; }
        if (!reply && MESSENGER_FALLBACK_REPLY) { reply = MESSENGER_FALLBACK_REPLY; replySource = 'fallback'; }
        if (!reply) continue;

        await sendWhatsAppText(from, reply);
        console.info('[whatsapp send]', { from, replySource, preview: reply.slice(0, 80) });

        // ── Lead capture + CRM sync — fire and forget ──
        setImmediate(() => captureAndSyncLead(from, text, reply, 'whatsapp').catch(e => console.error('[wa lead]', e)));
      }
    }
  }
}

/**
 * @returns {{ ok: true, status: number, body: string } | { ok: false, status: number, body: string, errorSummary: string }}
 */
async function sendMessengerText(psid, text) {
  const pathId = MESSENGER_PAGE_ID || 'me';
  const url = new URL(
    `https://graph.facebook.com/${GRAPH_VERSION}/${pathId}/messages`,
  );
  url.searchParams.set('access_token', PAGE_ACCESS_TOKEN);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: psid },
      messaging_type: 'RESPONSE',
      message: { text: text.slice(0, 2000) },
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error('[messenger send]', res.status, body);
    let errorSummary = body.slice(0, 300);
    try {
      const j = JSON.parse(body);
      const err = j.error;
      if (err?.message) errorSummary = `[${err.code ?? res.status}] ${err.message}`;
    } catch {
      /* keep raw */
    }
    return { ok: false, status: res.status, body, errorSummary };
  }
  return { ok: true, status: res.status, body };
}

async function sendWhatsAppText(toWaId, text) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toWaId,
      type: 'text',
      text: { preview_url: false, body: text.slice(0, 4096) },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('[whatsapp send]', res.status, err);
  }
}

/* Static SPA */
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.warn('[serve] dist/index.html missing — run npm run build first');
}

app.use(
  express.static(dist, {
    index: false,
    fallthrough: true,
    maxAge: '1h',
  }),
);

app.use((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(404).send('Not found');
  }
  const indexPath = path.join(dist, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return res.status(503).send('Frontend not built');
  }
  return res.sendFile(indexPath);
});

app.listen(PORT, '0.0.0.0', () => {
  console.info(`[server] http://0.0.0.0:${PORT} webhook=/webhook static=${dist}`);
  console.info(`[crm] sync=${process.env.FULLMOTOR_CRM_EMAIL ? 'enabled → ' + process.env.FULLMOTOR_CRM_EMAIL : 'disabled (set FULLMOTOR_CRM_EMAIL + FULLMOTOR_CRM_PASSWORD)'}`);
  console.info(`[gemini] ${GEMINI_API_KEY ? 'enabled model=' + GEMINI_MODEL : 'disabled (set GEMINI_API_KEY)'}`);
  console.info(`[sheet] ${LEADS_WEBHOOK_URL ? 'enabled' : 'disabled (set LEADS_WEBHOOK_URL)'}`);
});
