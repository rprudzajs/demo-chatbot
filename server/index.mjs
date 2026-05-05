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
import {
  getSession,
  detectCarsFromText,
  detectInterestFromText,
  extractContactFromText,
  fetchMessengerProfile,
  submitMessengerLead,
  captureAndSyncLead,
  generateReply,
  enqueueAndGenerateReply,
  _aldStock,
} from './assistant-brain.mjs';

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
    reply = await generateReply(psid, text);
    if (reply) replySource = 'gemini';
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

      // ── Full AI reply + lead capture (debounced: merges fragments) ──
      let reply = null;
      let replySource = 'none';
      let mergedText = text;

      if (GEMINI_API_KEY) {
        const r = await enqueueAndGenerateReply(psid, text);
        if (!r.reply && r.fragments === 0) {
          // Newer fragment from same psid took over — let it handle the send.
          continue;
        }
        reply = r.reply;
        mergedText = r.merged || text;
        if (reply) replySource = 'gemini';
      }

      if (!reply && MESSENGER_AUTO_REPLY) { reply = MESSENGER_AUTO_REPLY; replySource = 'auto'; }
      if (!reply && MESSENGER_FALLBACK_REPLY) { reply = MESSENGER_FALLBACK_REPLY; replySource = 'fallback'; }
      if (!reply) continue;

      await sendMessengerText(psid, reply);
      console.info('[webhook send]', { psid, replySource, preview: reply.slice(0, 80) });

      // ── Lead capture + CRM sync — fire and forget (use merged user text) ──
      setImmediate(() => captureAndSyncLead(psid, mergedText, reply, 'messenger').catch(e => console.error('[lead]', e)));
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

        // ── Gemini AI reply (same brain as Messenger, debounced) ──
        let reply = null;
        let replySource = 'none';
        let mergedText = text;

        if (GEMINI_API_KEY) {
          // Pre-seed phone from the WA number on first message
          const waSession = getSession(from);
          if (!waSession.contactInfo) {
            waSession.contactInfo = { phone: from };
          }
          const r = await enqueueAndGenerateReply(from, text);
          if (!r.reply && r.fragments === 0) {
            // Newer fragment from same WA took over.
            continue;
          }
          reply = r.reply;
          mergedText = r.merged || text;
          if (reply) replySource = 'gemini';
        }

        if (!reply && WHATSAPP_AUTO_REPLY) { reply = WHATSAPP_AUTO_REPLY; replySource = 'auto'; }
        if (!reply && MESSENGER_FALLBACK_REPLY) { reply = MESSENGER_FALLBACK_REPLY; replySource = 'fallback'; }
        if (!reply) continue;

        await sendWhatsAppText(from, reply);
        console.info('[whatsapp send]', { from, replySource, preview: reply.slice(0, 80) });

        // ── Lead capture + CRM sync — fire and forget (use merged user text) ──
        setImmediate(() => captureAndSyncLead(from, mergedText, reply, 'whatsapp').catch(e => console.error('[wa lead]', e)));
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
