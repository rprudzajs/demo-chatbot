/**
 * Chat simulation — see exactly what the bot reads and would send to CRM/Sheet.
 * Zero risk: DRY_RUN is forced true, nothing is sent anywhere.
 *
 * Usage:
 *   node scripts/simulate-chat.mjs
 */

import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';

// ── Load .env ─────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}

// Force dry-run — absolutely nothing sent to CRM
process.env.FULLMOTOR_CRM_DRY_RUN = 'true';

// ── Load inventory (same file the server uses) ────────────────────────────────
const _require = createRequire(import.meta.url);
const _aldStock = (() => {
  try { return _require('../data/ald-stock-base.json'); } catch { return []; }
})();

// ── Detection helpers (copied from server/index.mjs — same logic) ─────────────

function detectCarsFromText(text) {
  const lower = text.toLowerCase();
  const matches = [];
  const seen = new Set();
  const mentionedMakes = new Set();

  for (const car of _aldStock) {
    if (seen.has(car.id)) continue;
    const makeLower = car.make.toLowerCase();
    const makeModel = `${car.make} ${car.model}`.toLowerCase();
    const modelOnly = car.model.toLowerCase().split(' ')[0];
    const id = String(car.id).replace(/^ald-/, '');

    const exactMatch =
      lower.includes(makeModel) ||
      lower.includes(id) ||
      (modelOnly.length >= 3 && lower.includes(modelOnly) && lower.includes(makeLower));

    if (exactMatch) {
      seen.add(car.id);
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

function detectInterestFromText(text) {
  const lower = text.toLowerCase();
  const categories = ['suv', 'sedan', 'sedán', 'pickup', 'camioneta', 'eléctrico', 'electrico', 'hatchback', 'coupe', 'coupé'];
  return categories.filter(c => lower.includes(c));
}

function extractContactFromText(text) {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  const phone =
    text.match(/\+?56\s*9\s*\d{4}\s*-?\s*\d{4}/)?.[0] ??
    text.match(/\b9\s*\d{4}\s*\d{4}\b/)?.[0] ??
    text.match(/\b9\d{8}\b/)?.[0] ??
    text.match(/\+\d{8,12}\b/)?.[0] ?? null;
  const nameMatch = text.match(/(?:me llamo|soy|mi nombre es)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/i);
  const name = nameMatch?.[1] ?? null;
  return { email, phone, name, hasContact: Boolean(email || phone || name) };
}

// ── CRM module ────────────────────────────────────────────────────────────────
const { crmCreateLead, crmUpdateLead, crmOrigen } = await import('../server/fullmotor-crm.mjs');

// ── Simulation engine ─────────────────────────────────────────────────────────

function buildSheetPayload({ source, psid, fbName, session, text, reply, event }) {
  return {
    source,
    upsertKey: psid,
    event,
    sentAt: new Date().toISOString(),
    psid,
    fbName: fbName ?? null,
    extractedName: session.contactInfo?.name ?? null,
    phone: session.contactInfo?.phone ?? null,
    email: session.contactInfo?.email ?? null,
    marketplaceCar: session.marketplaceCar ?? null,
    carsDetected: session.carsDetected ?? null,
    interestCategories: session.interestCategories ?? null,
    lastMessage: text,
    lastBotReply: reply?.slice(0, 500) ?? null,
  };
}

function buildCrmPayload({ source, psid, session, text }) {
  const nombre = session.fbName ?? session.contactInfo?.name ?? 'Prospecto Web';
  const firstCar = session.carsDetected?.[0] ?? null;
  return {
    nombre,
    telefono: session.contactInfo?.phone ?? '',
    email: session.contactInfo?.email ?? '',
    marca: firstCar?.make ?? '',
    modelo: firstCar ? `${firstCar.make} ${firstCar.model} ${firstCar.year}` : '',
    origen: crmOrigen(source, !!session.marketplaceCar),
    mensaje: `[${source.toUpperCase()}] ${text.slice(0, 500)}`,
    link: `psid:${psid}`,
  };
}

async function simulateConversation({ title, source, psid, fbName, marketplaceCar, turns }) {
  const SEP = '═'.repeat(65);
  const sep = '─'.repeat(65);
  console.log('\n' + SEP);
  console.log(`  SCENARIO: ${title}`);
  console.log(`  Source: ${source.toUpperCase()}  |  PSID: ${psid}`);
  if (fbName) console.log(`  Facebook name: ${fbName}`);
  if (marketplaceCar) console.log(`  Marketplace car: ${JSON.stringify(marketplaceCar)}`);
  console.log(SEP);

  // Session state (mirrors server getSession)
  const session = {
    fbName: fbName ?? null,
    marketplaceCar: marketplaceCar ?? null,
    contactInfo: source === 'whatsapp' ? { phone: psid } : null,
    carsDetected: [],
    interestCategories: [],
    leadSent: false,
    crmLeadId: null,
  };

  for (let i = 0; i < turns.length; i++) {
    const { userMsg, botReply } = turns[i];
    const turnNum = i + 1;

    console.log(`\n  ┌── TURN ${turnNum} ${'─'.repeat(55 - String(turnNum).length)}`);
    console.log(`  │  USER:  "${userMsg}"`);
    console.log(`  │  BOT:   "${(botReply ?? '(no reply)').slice(0, 100)}"`);

    // Run detection
    const carsDetected = detectCarsFromText(userMsg + ' ' + (botReply ?? ''));
    const interests = detectInterestFromText(userMsg);
    const contact = extractContactFromText(userMsg);
    const isFirst = !session.leadSent;

    // Merge
    if (contact.hasContact) {
      session.contactInfo = session.contactInfo ?? {};
      if (contact.phone) session.contactInfo.phone = contact.phone;
      if (contact.email) session.contactInfo.email = contact.email;
      if (contact.name) session.contactInfo.name = contact.name;
    }
    if (carsDetected) {
      const existing = new Set(session.carsDetected.map(c => c.id));
      for (const car of carsDetected) {
        if (!existing.has(car.id)) { session.carsDetected.push(car); existing.add(car.id); }
      }
    }
    if (interests.length) {
      session.interestCategories = [...new Set([...session.interestCategories, ...interests])];
    }

    const prevCarIds = new Set(session.carsDetected.map(c => c.id));
    const newCar = (carsDetected ?? []).some(c => !prevCarIds.has(c.id));
    const newCat = interests.some(c => !session.interestCategories.includes(c));
    const shouldLog = isFirst || newCar || newCat || contact.hasContact;

    // Detection summary
    console.log(`  │`);
    console.log(`  │  🔍 DETECTED:`);
    console.log(`  │     Cars:      ${carsDetected ? carsDetected.map(c => `${c.make} ${c.model} ${c.year}`).join(', ') : 'none'}`);
    console.log(`  │     Interest:  ${interests.length ? interests.join(', ') : 'none'}`);
    console.log(`  │     Contact:   name="${contact.name ?? '—'}" phone="${contact.phone ?? '—'}" email="${contact.email ?? '—'}"`);
    console.log(`  │     Trigger:   ${shouldLog ? (isFirst ? 'FIRST CONTACT' : contact.hasContact ? 'CONTACT SHARED' : 'CAR/INTEREST DETECTED') : 'no trigger — skipped'}`);

    if (!shouldLog) {
      console.log(`  └${'─'.repeat(63)}`);
      continue;
    }

    session.leadSent = true;
    const event = isFirst ? 'first_contact' : contact.hasContact ? 'contact_shared' : 'car_detected';

    // Sheet payload
    const sheetPayload = buildSheetPayload({ source, psid, fbName, session, text: userMsg, reply: botReply, event });
    console.log(`  │`);
    console.log(`  │  📊 → GOOGLE SHEET (what goes to the spreadsheet):`);
    for (const [k, v] of Object.entries(sheetPayload)) {
      if (v === null || v === undefined || (Array.isArray(v) && !v.length)) continue;
      const display = typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80);
      console.log(`  │     ${k.padEnd(20)} ${display}`);
    }

    // CRM payload + dry-run call
    const crmPayload = buildCrmPayload({ source, psid, session, text: userMsg });
    console.log(`  │`);
    console.log(`  │  🏢 → FULLMOTOR CRM (what would be sent to the CRM):`);
    for (const [k, v] of Object.entries(crmPayload)) {
      console.log(`  │     ${k.padEnd(20)} ${String(v).slice(0, 80) || '(empty)'}`);
    }

    if (!session.crmLeadId) {
      const id = await crmCreateLead(crmPayload);
      session.crmLeadId = id;
      console.log(`  │     → Lead ID returned: ${id}`);
    } else {
      await crmUpdateLead(session.crmLeadId, {
        nombre1: crmPayload.nombre,
        telefono1: crmPayload.telefono,
        email1: crmPayload.email,
        modelo: crmPayload.modelo,
        estado: '2',
        mensaje: crmPayload.mensaje,
      });
      console.log(`  │     → Updated existing lead ID: ${session.crmLeadId}`);
    }

    console.log(`  └${'─'.repeat(63)}`);
  }

  console.log(`\n  ✅ Final session state:`);
  console.log(`     CRM Lead ID:    ${session.crmLeadId ?? 'none'}`);
  console.log(`     Contact:        ${JSON.stringify(session.contactInfo)}`);
  console.log(`     Cars detected:  ${session.carsDetected.map(c => `${c.make} ${c.model}`).join(', ') || 'none'}`);
  console.log(`     Interests:      ${session.interestCategories.join(', ') || 'none'}`);
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

await simulateConversation({
  title: 'Messenger — User asks about Volvo then shares phone',
  source: 'messenger',
  psid: '100012345678901',
  fbName: 'Carlos Muñoz',
  marketplaceCar: null,
  turns: [
    {
      userMsg: 'Hola buenas! Vi el Volvo V40 en la página, me interesa saber el precio',
      botReply: 'Hola Carlos! El Volvo V40 Cross Country T4 2015 está en $8.990.000. ¿Te gustaría coordinar una visita?',
    },
    {
      userMsg: 'Sí me interesa, mi número es +56 9 8765 4321 para que me llamen',
      botReply: 'Perfecto, te contactamos al +56987654321. ¿Tienes disponibilidad esta semana?',
    },
    {
      userMsg: 'El jueves en la tarde me viene bien',
      botReply: 'Anotado, el jueves en la tarde. Hasta pronto Carlos!',
    },
  ],
});

await simulateConversation({
  title: 'WhatsApp — Marketplace referral, asks about SUV budget',
  source: 'whatsapp',
  psid: '56987654321',   // WA uses the phone number as ID
  fbName: null,
  marketplaceCar: { adTitle: 'Toyota Hilux 4x4 2019', productId: '98765' },
  turns: [
    {
      userMsg: 'Hola vi el anuncio del Hilux, cuánto está?',
      botReply: 'Hola! La Toyota Hilux 4x4 está en $22.990.000. ¿Quieres más info?',
    },
    {
      userMsg: 'Sí, también estoy mirando SUV, mi presupuesto es como 15 millones',
      botReply: 'Con ese presupuesto te puedo mostrar opciones de SUV. ¿Prefieres automático o mecánico?',
    },
    {
      userMsg: 'Me llamo Rodrigo Pérez, automático prefiero',
      botReply: 'Perfecto Rodrigo, te mando opciones automáticas en SUV al tiro.',
    },
  ],
});

await simulateConversation({
  title: 'Web Chat — User shares name and email',
  source: 'web_chat',
  psid: 'web-session-abc123',
  fbName: null,
  marketplaceCar: null,
  turns: [
    {
      userMsg: 'Buenas, estoy buscando un sedan automático, budget de 20 millones',
      botReply: 'Hola! Tenemos buenos sedanes automáticos en ese rango. ¿Qué marca prefieres?',
    },
    {
      userMsg: 'Mi nombre es Valentina Torres y me pueden escribir a valentina@gmail.com',
      botReply: 'Perfecto Valentina, te escribimos a valentina@gmail.com con las opciones.',
    },
  ],
});

console.log('\n' + '═'.repeat(65));
console.log('  ✅ Simulation complete — NOTHING was sent to the real CRM.');
console.log('     All CRM calls above were [DRY-RUN] logs only.');
console.log('═'.repeat(65) + '\n');
