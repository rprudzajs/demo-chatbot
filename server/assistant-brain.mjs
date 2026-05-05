/**
 * Shared ALD Autos assistant brain.
 *
 * Same Gemini system prompt + inventory + session + lead capture used by:
 *   - server/index.mjs        (webhook server for Messenger Page + WhatsApp Cloud API + web chat)
 *   - scripts/messenger-personal.mjs   (Playwright personal Messenger bot)
 *   - scripts/whatsapp-personal.mjs    (whatsapp-web.js personal WhatsApp bot)
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

// ── Inventory ────────────────────────────────────────────────────────────────
export const _aldStock = (() => {
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

export const MESSENGER_GEMINI_SYSTEM = `
Eres el asesor de ventas de ALD Autos — seminuevos premium en Santiago. Eres experto, proactivo y humano. Tu meta: convertir cada conversación en una visita o contacto real.

═══════════════════════════════════════
REGLAS ABSOLUTAS (nunca las rompas)
═══════════════════════════════════════
1. IDIOMA: Siempre español chileno. Tutéalo al cliente.
2. SOLO OFRECE LO QUE EXISTE en el inventario. Jamás inventes un auto, precio o característica.
3. FILTRA POR CATEGORÍA PRIMERO: Si el cliente pide un tipo de vehículo (camioneta, SUV, sedán, etc.), solo muestra autos de esa categoría. No mezcles tipos aunque sean de la marca solicitada.
4. FORMATO: Texto plano. Sin asteriscos, sin corchetes, sin markdown. URLs limpias: https://www.ald.cl/ficha/250702/ — nunca [link](url).
5. RESPUESTAS BREVES POR DEFECTO. Máx 2 párrafos cortos, 1-2 frases cada uno. Si el cliente es claro y pide opciones, máx 3 autos en lista. Nunca repitas datos que ya diste. Apunta a 60-100 palabras totales; supera eso solo si te piden detalle explícito.
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
"¡Hola! Soy el asesor de ALD Autos 👋 Tenemos 95 seminuevos en Lo Barnechea. ¿Qué tipo de auto buscas — camioneta, SUV, sedán — y tienes un presupuesto en mente?"

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

// ── Session store ────────────────────────────────────────────────────────────
const _sessions = new Map();
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function getSession(key) {
  const existing = _sessions.get(key);
  const now = Date.now();
  if (existing && (now - existing.seenAtMs) > SESSION_TTL_MS) {
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
  return categories.filter(c => lower.includes(c));
}

export function extractContactFromText(text) {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  const phone =
    text.match(/\+?56\s*9\s*\d{4}\s*-?\s*\d{4}/)?.[0] ??
    text.match(/\b9\s*\d{4}\s*\d{4}\b/)?.[0] ??
    text.match(/\b9\d{8}\b/)?.[0] ??
    text.match(/\+\d{8,12}\b/)?.[0] ??
    null;
  const nameMatch = text.match(/(?:me llamo|soy|mi nombre es)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/i);
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
 * @param {string} key    Conversation id (PSID, phone, thread id)
 * @param {string} text   Inbound user text
 * @param {string|null} reply   Bot reply (may be null on failure)
 * @param {'messenger'|'whatsapp'|'web_chat'|'messenger_personal'|'whatsapp_personal'} source
 * @param {{displayName?: string|null}} [opts] Optional display name (WA/Messenger personal)
 */
export async function captureAndSyncLead(key, text, reply, source, opts = {}) {
  const session = getSession(key);

  // Messenger Page: fetch profile from Graph API (requires Page token)
  if (source === 'messenger' && !session.profile && PAGE_ACCESS_TOKEN) {
    session.profile = await fetchMessengerProfile(key);
  }

  // WhatsApp: key is the phone number
  if ((source === 'whatsapp' || source === 'whatsapp_personal') && !session.contactInfo?.phone) {
    session.contactInfo = session.contactInfo ?? {};
    session.contactInfo.phone = key;
  }

  // Display name for personal channels
  if (opts.displayName && !session.profile) {
    session.profile = { name: opts.displayName };
  }

  const carsDetected = detectCarsFromText(text);
  const interestCategories = detectInterestFromText(text);
  const contactFound = extractContactFromText(text);
  const isFirstMessage = !session.leadSent;

  const prevCarIds = new Set((session.carsDetected ?? []).map(c => c.id));
  const newCarFound = (carsDetected ?? []).some(c => !prevCarIds.has(c.id));
  const newCategory = interestCategories.some(c => !(session.interestCategories ?? []).includes(c));

  if (contactFound.hasContact) {
    session.contactInfo = session.contactInfo ?? {};
    if (contactFound.phone) session.contactInfo.phone = contactFound.phone;
    if (contactFound.email) session.contactInfo.email = contactFound.email;
    if (contactFound.name) session.contactInfo.name = contactFound.name;
  }

  if (carsDetected) {
    const existingIds = new Set((session.carsDetected ?? []).map(c => c.id));
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

  // FullMotor CRM
  const nombre =
    session.profile?.name ??
    session.contactInfo?.name ??
    'Prospecto Web';
  const firstCar = session.carsDetected?.[0] ?? null;
  const modeloStr = firstCar
    ? `${firstCar.make} ${firstCar.model} ${firstCar.year}`
    : '';
  // Personal channels use the same origen bucket as the official channel
  const normalizedSource = source.replace(/_personal$/, '');
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

/**
 * Generate a Gemini reply grounded on the shared system prompt + session history.
 * Returns plain text (markdown stripped) or null on failure.
 */
export async function generateReply(key, userText) {
  const ai = getAi();
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
        systemInstruction: MESSENGER_GEMINI_SYSTEM,
        temperature: 0.6,
        maxOutputTokens: 350,
      },
    });
    const raw = res.text?.trim() ?? null;
    const reply = stripMarkdown(raw);
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

// ──────────────────────────────────────────────────────────────────────────
// Message debouncer
// ──────────────────────────────────────────────────────────────────────────
// People often send 2-3 short messages back-to-back ("hola" / "busco una
// camioneta" / "diésel hasta 15M"). Without debouncing we'd fire 3 separate
// Gemini calls and reply 3 times — wasteful and weird-feeling.
//
// enqueueAndGenerateReply(key, text) buffers fragments per session. Each call
// resets a quiet-period timer (default 3.5s). When the user stops typing for
// that window, all fragments are merged with newlines and sent to Gemini as
// one input. Only the LAST caller in the burst gets the reply; earlier callers
// resolve to { reply: null } so they skip sending.
//
// A hard cap (default 12s) prevents a never-ending typer from hanging us.
// ──────────────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = Number(process.env.MESSAGE_DEBOUNCE_MS ?? 3500);
const DEBOUNCE_MAX_MS = Number(process.env.MESSAGE_DEBOUNCE_MAX_MS ?? 12000);
const _debounceBuffers = new Map();

/**
 * Buffer a user message and generate one merged reply once the user stops
 * sending fragments.
 *
 * @param {string} sessionId  unique per channel+sender (psid, phone, threadId)
 * @param {string} userText   the incoming fragment
 * @returns {Promise<{ reply: string|null, merged: string, fragments: number }>}
 *   - `reply`: text to send (or `null` if a newer message superseded this one)
 *   - `merged`: the full combined text Gemini saw (use for lead capture)
 *   - `fragments`: how many fragments were merged (1 = no debounce happened)
 */
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
        // Earlier callers in the burst skip; only the last one sends.
        for (let i = 0; i < resolvers.length - 1; i++) {
          resolvers[i]({ reply: null, merged: '', fragments: 0 });
        }
        resolvers[resolvers.length - 1]({ reply, merged, fragments });
      } catch (e) {
        console.error('[debounce] generateReply error:', e.message);
        for (const r of resolvers) r({ reply: null, merged: '', fragments: 0 });
      }
    };

    // Reset the quiet-period timer on every new fragment.
    if (buf.softTimer) clearTimeout(buf.softTimer);
    buf.softTimer = setTimeout(flush, DEBOUNCE_MS);

    // Hard cap: even if the user keeps typing, flush after MAX_MS.
    if (!buf.hardTimer) {
      const remaining = Math.max(0, DEBOUNCE_MAX_MS - (Date.now() - buf.firstAt));
      buf.hardTimer = setTimeout(flush, remaining);
    }
  });
}
