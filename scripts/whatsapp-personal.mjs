/**
 * Personal WhatsApp auto-reply bot (whatsapp-web.js).
 *
 * Uses the SHARED brain (server/assistant-brain.mjs) so replies are grounded
 * on the full ALD inventory + same system prompt as Messenger and the demo
 * site. Leads are captured into Google Sheets + FullMotor CRM via the same
 * `captureAndSyncLead` function.
 *
 * Usage:
 *   GEMINI_API_KEY=xxx node scripts/whatsapp-personal.mjs
 *   → scan the QR code with the Business WhatsApp on the phone
 *   → session persists in .wwebjs_auth/ between runs
 *
 * WARNING: Unofficial. Meta can ban the number. Use a dedicated business
 * number, not a personal one. For production, migrate to the official
 * WhatsApp Cloud API.
 */

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { readFileSync, existsSync } from 'fs';

// ── Load env BEFORE importing the brain ──────────────────────────────────────
// Match Vite/Next convention: .env.local overrides .env. First non-empty wins.
const __dirname = dirname(fileURLToPath(import.meta.url));
for (const file of ['.env.local', '.env']) {
  const p = resolve(__dirname, '..', file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}

const { enqueueAndGenerateReply, captureAndSyncLead, MESSENGER_FALLBACK_REPLY, _aldStock, GEMINI_API_KEY, GEMINI_MODEL } = await import(
  '../server/assistant-brain.mjs'
);

console.log(`[whatsapp-bot] Brain loaded with ${_aldStock.length} vehicles in inventory`);
console.log(
  `[whatsapp-bot] Gemini: ${GEMINI_API_KEY ? `enabled (model=${GEMINI_MODEL})` : '⚠️  DISABLED — GEMINI_API_KEY missing in .env or .env.local, bot will only send fallback message'}`,
);

// Optional allowlist: comma-separated phone numbers (digits only, with country code)
// that the bot is allowed to reply to. Leave empty to reply to everyone.
const ALLOWLIST = String(process.env.WHATSAPP_ALLOWLIST ?? '')
  .split(',')
  .map((s) => s.trim().replace(/\D/g, ''))
  .filter(Boolean);

// Ignore groups by default — too easy to spam everyone
const REPLY_TO_GROUPS = String(process.env.WHATSAPP_REPLY_TO_GROUPS ?? 'false') === 'true';

// Humanize typing delay
function humanDelayMs(text) {
  const base = 1500;
  const perChar = 35;
  const jitter = Math.random() * 1500;
  return Math.min(base + text.length * perChar + jitter, 12000);
}

// ── Client ───────────────────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'ald-bot' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', (qr) => {
  console.log('\n[whatsapp-bot] Scan this QR with WhatsApp on the phone:\n');
  qrcode.generate(qr, { small: true });
  console.log('\n→ Open WhatsApp → Settings → Linked Devices → Link a Device\n');
});

client.on('authenticated', () => {
  console.log('[whatsapp-bot] Authenticated ✅ (session saved in .wwebjs_auth/)');
});

client.on('auth_failure', (msg) => {
  console.error('[whatsapp-bot] Auth failure:', msg);
});

client.on('ready', () => {
  console.log(`[whatsapp-bot] Ready as ${client.info?.pushname ?? 'unknown'} (${client.info?.wid?._serialized ?? '?'})`);
  console.log('[whatsapp-bot] Listening for messages. Press Ctrl+C to stop.\n');
});

client.on('disconnected', (reason) => {
  console.error('[whatsapp-bot] Disconnected:', reason);
  process.exit(1);
});

const DEBUG = String(process.env.WHATSAPP_DEBUG ?? 'false') === 'true';

client.on('message', async (msg) => {
  try {
    if (msg.fromMe) return;
    if (msg.from === 'status@broadcast') return;
    const isGroup = msg.from.endsWith('@g.us');
    if (isGroup && !REPLY_TO_GROUPS) return;

    const body = (msg.body ?? '').trim();
    if (!body) return;

    // Resolve the real phone number. WhatsApp sometimes exposes a @lid (linked id)
    // instead of the phone, especially for saved contacts with display names.
    const contact = await msg.getContact().catch(() => null);
    const rawFromPhone = msg.from.split('@')[0];

    let formattedNumber = null;
    try {
      if (contact?.getFormattedNumber) {
        formattedNumber = await contact.getFormattedNumber();
      }
    } catch {}

    const candidatePhones = [
      contact?.number,
      contact?.id?.user,
      typeof contact?.id?._serialized === 'string' ? contact.id._serialized.split('@')[0] : null,
      formattedNumber ? formattedNumber.replace(/\D/g, '') : null,
      rawFromPhone,
    ].filter((p) => typeof p === 'string' && /^\d+$/.test(p));

    const phone = candidatePhones[0] ?? rawFromPhone;
    const displayName = contact?.pushname || contact?.name || contact?.shortName || null;

    if (DEBUG) {
      console.log(
        `[debug] event=message from=${msg.from} resolvedPhone=${phone} rawPhone=${rawFromPhone} candidates=${JSON.stringify(candidatePhones)} name="${displayName}" fromMe=${msg.fromMe} body="${body.slice(0, 60)}" allowlist=${JSON.stringify(ALLOWLIST)}`,
      );
      console.log(
        `[debug] contact={ number:${contact?.number}, idUser:${contact?.id?.user}, idSerialized:${contact?.id?._serialized}, formatted:${formattedNumber}, isMyContact:${contact?.isMyContact}, isUser:${contact?.isUser} }`,
      );
    }

    const passesAllowlist =
      !ALLOWLIST.length ||
      candidatePhones.some((p) => ALLOWLIST.includes(p));

    if (!passesAllowlist) {
      if (DEBUG) console.log(`[debug] IGNORED — none of ${JSON.stringify(candidatePhones)} in allowlist ${JSON.stringify(ALLOWLIST)}`);
      return;
    }

    console.log(`\n[MSG] from ${phone}${displayName ? ` (${displayName})` : ''}`);
    console.log(`  User: "${body.slice(0, 200)}"`);

    if (!GEMINI_API_KEY) {
      console.warn('  ⚠️  No GEMINI_API_KEY — sending fallback. Add it to .env or .env.local');
      await client.sendMessage(msg.from, MESSENGER_FALLBACK_REPLY);
      return;
    }

    // Debounce: if the user sends more fragments within ~3.5s, this resolves
    // to { reply: null } and we silently skip — the later call handles it.
    const { reply, merged, fragments } = await enqueueAndGenerateReply(phone, body);
    if (!reply) {
      if (fragments === 0) console.log('  …superseded by newer fragment, skipping');
      return;
    }
    if (fragments > 1) console.log(`  (merged ${fragments} fragments)`);
    console.log(`  Bot (gemini):  "${reply.slice(0, 160)}"`);

    // Humanize: typing indicator + realistic delay
    const chat = await msg.getChat().catch(() => null);
    if (chat) await chat.sendStateTyping().catch(() => {});

    const delay = humanDelayMs(reply);
    console.log(`  (typing ${(delay / 1000).toFixed(1)}s before sending...)`);
    await new Promise((r) => setTimeout(r, delay));

    await client.sendMessage(msg.from, reply);
    console.log('  ✅ Sent');

    // Fire-and-forget lead capture (use merged text so CRM sees full context)
    captureAndSyncLead(phone, merged, reply, 'whatsapp_personal', {
      displayName,
    }).catch((e) => console.error('[lead] capture error:', e.message));
  } catch (e) {
    console.error('[whatsapp-bot] message handler error:', e.message);
  }
});

console.log('[whatsapp-bot] Initializing client...');
client.initialize().catch((e) => {
  console.error('[whatsapp-bot] init error:', e);
  process.exit(1);
});
