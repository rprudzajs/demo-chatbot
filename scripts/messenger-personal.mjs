/**
 * Personal Messenger auto-reply bot using browser automation.
 * Logs into messenger.com, watches for new messages, replies via Gemini.
 *
 * Usage:
 *   FB_EMAIL=you@email.com FB_PASSWORD=yourpass GEMINI_API_KEY=xxx node scripts/messenger-personal.mjs
 *
 * WARNING: Against Facebook ToS. Use only for testing on your own account.
 */

import { chromium } from 'playwright';
import { GoogleGenAI } from '@google/genai';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { readFileSync, existsSync, writeFileSync } from 'fs';

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

const FB_EMAIL    = process.env.FB_EMAIL ?? '';
const FB_PASSWORD = process.env.FB_PASSWORD ?? '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const GEMINI_MODEL   = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
const COOKIES_PATH   = resolve(__dirname, '..', '.messenger-cookies.json');
const POLL_MS = 8000; // check for new messages every 8 seconds

if (!FB_EMAIL || !FB_PASSWORD) {
  console.error('Set FB_EMAIL and FB_PASSWORD env vars');
  process.exit(1);
}

// ── Gemini ────────────────────────────────────────────────────────────────────
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

// Reuse the same system prompt as the main bot
const SYSTEM = `
Eres el asesor de ventas de ALD Autos — seminuevos premium en Santiago. Eres experto, proactivo y humano.
Responde siempre en español chileno. Tutéalo al cliente. Texto plano, sin markdown, sin asteriscos.
Si preguntan por un auto específico, da precio, km, transmisión y link de ficha en ald.cl.
Respuestas cortas — máx 3 oraciones. Si el cliente quiere visitar o más info, pide nombre y WhatsApp.
`.trim();

async function geminiReply(text, history = []) {
  if (!ai) return 'Gracias por escribirnos, un asesor te contactará pronto.';
  try {
    const contents = [
      ...history,
      { role: 'user', parts: [{ text }] },
    ];
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: { systemInstruction: SYSTEM, temperature: 0.7 },
    });
    return res.text?.trim() ?? null;
  } catch (e) {
    console.error('[gemini]', e.message);
    return null;
  }
}

// ── Session memory (per conversation thread) ──────────────────────────────────
const _sessions = new Map(); // threadId → { history, lastMessageId }

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[messenger-bot] Starting browser...');

  const browser = await chromium.launch({
    headless: false, // keep visible so you can handle 2FA if needed
    args: ['--no-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  // Restore saved cookies if available
  if (existsSync(COOKIES_PATH)) {
    try {
      const saved = JSON.parse(readFileSync(COOKIES_PATH, 'utf8'));
      await context.addCookies(saved);
      console.log('[messenger-bot] Restored saved session cookies');
    } catch {}
  }

  const page = await context.newPage();

  // ── Login ──────────────────────────────────────────────────────────────────
  console.log('[messenger-bot] Navigating to Messenger...');
  await page.goto('https://www.messenger.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Check if already logged in
  const isLoggedIn = await page.locator('[aria-label="Chats"]').isVisible().catch(() => false)
    || await page.locator('[placeholder="Buscar en Messenger"]').isVisible().catch(() => false)
    || await page.locator('[aria-label="Messenger"]').isVisible().catch(() => false);

  if (!isLoggedIn) {
    console.log('[messenger-bot] Logging in...');
    try {
      await page.fill('#email', FB_EMAIL);
      await page.fill('#pass', FB_PASSWORD);
      await page.click('[name="login"]');
      await page.waitForTimeout(5000);
      console.log('[messenger-bot] Login submitted — if 2FA appears, complete it in the browser window');
      // Wait up to 30s for user to complete 2FA if needed
      await page.waitForTimeout(15000);
    } catch (e) {
      console.error('[messenger-bot] Login error:', e.message);
    }

    // Save cookies after login
    const cookies = await context.cookies();
    writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
    console.log('[messenger-bot] Session cookies saved');
  } else {
    console.log('[messenger-bot] Already logged in');
  }

  console.log('[messenger-bot] Watching for new messages every', POLL_MS / 1000, 'seconds...');
  console.log('[messenger-bot] DO NOT close the Chrome window. Press Ctrl+C here to stop.\n');

  // ── Poll loop ─────────────────────────────────────────────────────────────
  const repliedTo = new Set();

  while (true) {
    try {
      if (page.isClosed()) {
        console.log('[messenger-bot] Page closed — reopening...');
        const p2 = await context.newPage();
        await p2.goto('https://www.messenger.com/', { waitUntil: 'domcontentloaded' });
        await p2.waitForTimeout(3000);
        Object.assign(page, p2);
      }
      await checkAndReply(page, repliedTo);
    } catch (e) {
      console.error('[poll error]', e.message);
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}

async function checkAndReply(page, repliedTo) {
  // Get all thread links from sidebar
  const threadLinks = await page.locator('a[href*="/t/"]').all().catch(() => []);

  for (const link of threadLinks.slice(0, 8)) {
    const href = await link.getAttribute('href').catch(() => null);
    if (!href) continue;
    const threadId = href.match(/\/t\/([^/?#]+)/)?.[1];
    if (!threadId) continue;

    // Check if thread has unread indicator (bold name or unread dot)
    const isUnread = await link.locator('[aria-label*="leído"], [aria-label*="unread"], [data-testid*="unread"]').isVisible().catch(() => false);

    // Open the thread
    const fullUrl = href.startsWith('http') ? href : `https://www.messenger.com${href}`;
    await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2500));

    // Get last incoming message — rows NOT sent by us (aligned left)
    const lastMsg = await getLastIncomingMessage(page);
    if (!lastMsg || lastMsg.length < 2) continue;

    const msgKey = `${threadId}::${lastMsg.slice(0, 80)}`;
    if (repliedTo.has(msgKey)) continue;

    console.log(`\n[NEW MSG] Thread: ${threadId}`);
    console.log(`  User: "${lastMsg}"`);

    const session = _sessions.get(threadId) ?? { history: [] };
    const reply = await geminiReply(lastMsg, session.history);
    if (!reply) continue;

    console.log(`  Bot:  "${reply.slice(0, 100)}"`);

    const sent = await sendReply(page, reply);
    if (sent) {
      repliedTo.add(msgKey);
      session.history = [
        ...session.history,
        { role: 'user', parts: [{ text: lastMsg }] },
        { role: 'model', parts: [{ text: reply }] },
      ].slice(-20);
      _sessions.set(threadId, session);
      console.log(`  ✅ Sent`);
    }

    // Back to inbox
    await page.goto('https://www.messenger.com/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
  }
}

async function getLastIncomingMessage(page) {
  // Messenger renders incoming messages in rows without "outgoing" class
  // The most reliable way: get all message text rows, skip ones that match our sent messages
  const rows = await page.locator('div[class*="x1n2onr6"] span[dir="auto"], div[dir="auto"] > span').all().catch(() => []);

  for (let i = rows.length - 1; i >= 0; i--) {
    const text = await rows[i].textContent().catch(() => null);
    if (text?.trim() && text.trim().length > 1 && !text.includes('http')) {
      // Check it's not a timestamp or UI label
      if (!/^\d{1,2}:\d{2}/.test(text.trim())) {
        return text.trim();
      }
    }
  }
  return null;
}

async function sendReply(page, text) {
  try {
    const input = page.locator('[contenteditable="true"][role="textbox"]').last();
    await input.click();
    await input.type(text, { delay: 20 });
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 1500));
    return true;
  } catch (e) {
    console.error('[send error]', e.message);
    return false;
  }
}

main().catch(e => {
  console.error('[fatal]', e);
  process.exit(1);
});
