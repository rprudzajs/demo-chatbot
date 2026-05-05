/**
 * Personal Messenger auto-reply bot using browser automation.
 *
 * Uses the SHARED brain (server/assistant-brain.mjs) so replies are grounded
 * on the full ALD inventory + same system prompt as the official Messenger
 * webhook, the WhatsApp bot, and the demo website chatbot. Leads are captured
 * into Google Sheets + FullMotor CRM via the same `captureAndSyncLead` function.
 *
 * Usage:
 *   FIRST RUN (visible browser, manual login + 2FA):
 *     MESSENGER_HEADLESS=false npm run bot:messenger
 *     → log in once; the persistent profile is saved to .messenger-userdata/
 *
 *   STEADY STATE (background):
 *     MESSENGER_HEADLESS=true npm run bot:messenger
 *
 * Safety knobs (env):
 *   MESSENGER_ALLOWLIST       comma-separated list. Each entry is matched
 *                             against (a) the thread numeric id and (b) the
 *                             contact display name (case-insensitive substring).
 *                             Empty = reply to ALL incoming. Set this on a
 *                             busy account.
 *   MESSENGER_DRY_RUN=true    log replies but do NOT send them.
 *   MESSENGER_DEBUG=true      verbose logs (selectors, decisions).
 *   MESSENGER_POLL_MS=8000    poll interval.
 *   MESSENGER_HEADLESS=false  show the Chrome window (needed for first login).
 *
 * WARNING: Browser automation of personal Messenger is against Facebook ToS.
 * Use a dedicated test account or accept the risk on your own account.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
// ── Load env BEFORE importing the brain (brain reads process.env on import) ──
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

const {
  enqueueAndGenerateReply,
  captureAndSyncLead,
  getSession,
  MESSENGER_FALLBACK_REPLY,
  _aldStock,
  GEMINI_API_KEY,
  GEMINI_MODEL,
} = await import('../server/assistant-brain.mjs');

// ── Config ───────────────────────────────────────────────────────────────────
const USER_DATA_DIR = resolve(__dirname, '..', '.messenger-userdata');
const REPLIED_PATH = resolve(__dirname, '..', '.messenger-replied.json');
const POLL_MS = Number(process.env.MESSENGER_POLL_MS ?? 20000);
const HEADLESS = String(process.env.MESSENGER_HEADLESS ?? 'false') === 'true';
const DEBUG = String(process.env.MESSENGER_DEBUG ?? 'false') === 'true';
const DRY_RUN = String(process.env.MESSENGER_DRY_RUN ?? 'false') === 'true';

// Allowlist: each entry can be a numeric thread id OR a substring of the
// contact display name. Empty array = reply to everyone.
const ALLOWLIST = String(process.env.MESSENGER_ALLOWLIST ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`[messenger-bot] Brain loaded with ${_aldStock.length} vehicles in inventory`);
console.log(
  `[messenger-bot] Gemini: ${
    GEMINI_API_KEY
      ? `enabled (model=${GEMINI_MODEL})`
      : '⚠️  DISABLED — GEMINI_API_KEY missing in .env or .env.local, bot will only send fallback message'
  }`,
);
console.log(`[messenger-bot] Mode: ${HEADLESS ? 'headless' : 'headful'}${DRY_RUN ? ' • DRY RUN' : ''}${DEBUG ? ' • DEBUG' : ''}`);
console.log(
  `[messenger-bot] Allowlist: ${ALLOWLIST.length ? JSON.stringify(ALLOWLIST) : '(empty — replying to ALL incoming)'}`,
);

// ── Persistent dedup so restarts don't double-reply ──────────────────────────
function loadReplied() {
  try {
    if (!existsSync(REPLIED_PATH)) return new Set();
    const arr = JSON.parse(readFileSync(REPLIED_PATH, 'utf8'));
    return new Set(Array.isArray(arr) ? arr.slice(-2000) : []);
  } catch {
    return new Set();
  }
}
function saveReplied(set) {
  try {
    // Cap to last 2000 keys to avoid unbounded growth
    const arr = Array.from(set).slice(-2000);
    writeFileSync(REPLIED_PATH, JSON.stringify(arr));
  } catch (e) {
    if (DEBUG) console.error('[dedup] save error:', e.message);
  }
}

// ── Humanize: random typing delay so replies don't look robotic ──────────────
function humanDelayMs(text) {
  const base = 1500;
  const perChar = 35;
  const jitter = Math.random() * 1500;
  return Math.min(base + text.length * perChar + jitter, 12000);
}

// ── Allowlist matching (thread id OR name substring) ─────────────────────────
function passesAllowlist(threadId, displayName) {
  if (!ALLOWLIST.length) return true;
  const name = (displayName ?? '').toLowerCase();
  const tid = String(threadId ?? '');
  return ALLOWLIST.some((entry) => {
    const e = entry.toLowerCase();
    if (/^\d+$/.test(entry)) return tid === entry;
    return name.includes(e) || tid === entry;
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(USER_DATA_DIR)) mkdirSync(USER_DATA_DIR, { recursive: true });

  const { inboxPage, context } = await launchAndLogin();
  const repliedTo = loadReplied();
  if (DEBUG) console.log(`[dedup] loaded ${repliedTo.size} prior keys from ${REPLIED_PATH}`);
  console.log(`\n[messenger-bot] Polling every ${POLL_MS / 1000}s. Inbox tab stays pinned.\n`);

  while (true) {
    try {
      await checkAndReply(inboxPage, context, repliedTo);
    } catch (e) {
      console.error('[poll error]', e.message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/**
 * Launch Chromium (always headful — headless breaks Messenger's JS rendering).
 * If session is valid: returns immediately.
 * If expired: waits for manual login with auto-detection, no ENTER needed.
 * The inbox page is kept pinned — threads are opened in separate tabs.
 */
async function launchAndLogin() {
  const ctxOptions = {
    headless: false,
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  };

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, ctxOptions);
  let inboxPage = context.pages()[0] ?? (await context.newPage());

  console.log('[messenger-bot] Navigating to Messenger inbox...');
  await inboxPage.goto('https://www.messenger.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await inboxPage.waitForTimeout(3000);

  if (await isLoggedIn(inboxPage)) {
    console.log('✅ Already logged in (persistent profile).');
    return { inboxPage, context };
  }

  // Session expired — wait for manual login, auto-detect inbox
  console.log(
    '\n🔑  Login required — log into messenger.com in the Chrome window.' +
    '\n    The bot will continue automatically once your inbox is visible.\n',
  );

  let waited = 0;
  while (waited < 10 * 60 * 1000) {
    await inboxPage.waitForTimeout(3000);
    waited += 3000;
    const pages = context.pages().filter((p) => !p.isClosed());
    inboxPage = pages.find((p) => p.url().includes('messenger.com')) ?? pages[pages.length - 1] ?? inboxPage;
    if (await isLoggedIn(inboxPage).catch(() => false)) break;
    if (DEBUG) console.log(`[login] waiting... ${Math.round(waited / 1000)}s`);
  }

  if (!(await isLoggedIn(inboxPage).catch(() => false))) {
    console.error('❌ Login timeout. Re-run the bot.');
    await context.close(); process.exit(1);
  }
  console.log('✅ Logged in. Bot running — inbox tab stays open in the background.');
  return { inboxPage, context };
}

/**
 * Are we on a real, logged-in Messenger inbox? We look for POSITIVE markers
 * (sidebar threads, chat list, navigation rail) instead of trying to detect
 * the login form, because FB redirects through facebook.com → messenger.com
 * during login and the form selectors can be misleading.
 */
async function isLoggedIn(page) {
  try {
    const url = page.url();
    if (!url.includes('messenger.com')) return false;
    if (url.includes('/login')) return false;

    // Hard negative: a visible password field means we're still on a login screen.
    const hasPassVisible = await page
      .locator('input[name="pass"], #pass, input[type="password"]')
      .first()
      .isVisible()
      .catch(() => false);
    if (hasPassVisible) return false;

    // Hard positive #1: an actual conversation thread link.
    const hasThread = await page
      .locator('a[href*="/t/"]')
      .first()
      .count()
      .then((n) => n > 0)
      .catch(() => false);
    if (hasThread) return true;

    // Hard positive #2: authenticated UI like the new-message button or the
    // chat search field. These don't appear on the unauthenticated landing.
    const hasAuthUi = await page
      .locator(
        '[aria-label*="New message" i], [aria-label*="Nuevo mensaje" i], ' +
          '[aria-label*="Chats" i], [aria-label*="Conversaciones" i], ' +
          'input[placeholder*="Search" i], input[placeholder*="Buscar" i]',
      )
      .first()
      .count()
      .then((n) => n > 0)
      .catch(() => false);
    return hasAuthUi;
  } catch {
    return false;
  }
}

// ── Per-thread preview cache so we skip threads whose content hasn't changed ──
const _threadPreviewSeen = new Map(); // threadId → last previewText

// ── Polling: find unread threads, open each, decide if we should reply ───────
async function checkAndReply(page, context, repliedTo) {
  // Ensure inbox page is still on messenger.com (recover if navigated away)
  const curUrl = page.url();
  const onInbox = /messenger\.com\/(t\/|inbox\/?)?($|\?)/.test(curUrl);
  if (!onInbox) {
    await page.goto('https://www.messenger.com/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  // Grab sidebar threads. We do everything in one evaluate to avoid stale handles.
  const candidates = await page
    .evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/t/"]'));
      const seen = new Set();
      const out = [];
      for (const a of links) {
        const href = a.getAttribute('href') ?? '';
        const m = href.match(/\/t\/([^/?#]+)/);
        if (!m) continue;
        const threadId = m[1];
        if (seen.has(threadId)) continue;
        seen.add(threadId);

        const aria = (a.getAttribute('aria-label') ?? '').trim();
        const ariaLow = aria.toLowerCase();

        // Collect all visible text spans to find name + preview separately
        const spans = Array.from(a.querySelectorAll('span[dir="auto"]'));
        const displayName = (spans[0]?.textContent ?? '').trim() || null;
        // Preview is the second span (the last-message snippet)
        const previewText = (spans[1]?.textContent ?? spans[0]?.textContent ?? '').trim();

        // Skip thread if the last message in the preview was sent by us ("You:" / "Tú:")
        const previewLow = previewText.toLowerCase();
        const lastMsgIsOutgoing =
          previewLow.startsWith('you:') ||
          previewLow.startsWith('tú:') ||
          previewLow.startsWith('tu:');
        if (lastMsgIsOutgoing) continue;

        // Unread heuristics:
        //  1. aria-label contains "unread" / "no leído" / "sin leer"
        //  2. bold font-weight on the preview span
        let unread =
          ariaLow.includes('unread') ||
          ariaLow.includes('no leído') ||
          ariaLow.includes('no leido') ||
          ariaLow.includes('sin leer');
        if (!unread && spans[1]) {
          const fw = parseInt(getComputedStyle(spans[1]).fontWeight || '400', 10);
          if (fw >= 600) unread = true;
        }

        out.push({ threadId, href, displayName, previewText, unread, aria });
      }
      return out;
    })
    .catch(() => []);

  if (DEBUG) {
    const unread = candidates.filter((c) => c.unread);
    console.log(
      `[poll] sidebar=${candidates.length} unread=${unread.length}${
        unread.length ? ' → ' + unread.map((c) => `${c.threadId}(${c.displayName ?? '?'})`).join(', ') : ''
      }`,
    );
  }

  // Only act on threads that are: unread AND have a new preview since last check
  const queue = candidates
    .filter((c) => {
      if (!c.unread) return false;
      const prev = _threadPreviewSeen.get(c.threadId);
      return prev !== c.previewText; // new content
    })
    .slice(0, 5);
  if (!queue.length) return;

  for (const cand of queue) {
    const { threadId, href, displayName, previewText } = cand;
    _threadPreviewSeen.set(threadId, previewText);

    if (!passesAllowlist(threadId, displayName)) {
      if (DEBUG) console.log(`[allowlist] skip ${threadId} "${displayName ?? ''}"`);
      continue;
    }

    // Open thread in a NEW TAB — inbox page stays untouched, no visible refresh
    const fullUrl = href.startsWith('http') ? href : `https://www.messenger.com${href}`;
    const threadPage = await context.newPage();
    try {
      await threadPage.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await threadPage.waitForTimeout(2200);

      const { last, history: pageHistory } = await getThreadMessages(threadPage);
      if (!last || !last.text || last.text.length < 2) {
        if (DEBUG) console.log(`[skip] ${threadId} no incoming text`);
        continue;
      }
      if (!last.isIncoming) {
        if (DEBUG) console.log(`[skip] ${threadId} last msg is outgoing`);
        continue;
      }

      const msgKey = `${threadId}::${last.text.slice(0, 120)}`;
      if (repliedTo.has(msgKey)) {
        if (DEBUG) console.log(`[skip] ${threadId} already replied`);
        continue;
      }

      seedSessionFromHistory(threadId, pageHistory);

      console.log(`\n[NEW MSG] Thread: ${threadId}${displayName ? ` (${displayName})` : ''}`);
      console.log(`  User: "${last.text.slice(0, 200)}"`);

      if (!GEMINI_API_KEY) {
        const ok = DRY_RUN ? true : await sendReply(threadPage, MESSENGER_FALLBACK_REPLY);
        if (ok) { repliedTo.add(msgKey); saveReplied(repliedTo); }
        continue;
      }

      const { reply: aiReply, merged, fragments } = await enqueueAndGenerateReply(threadId, last.text);
      if (!aiReply && fragments === 0) {
        repliedTo.add(msgKey); saveReplied(repliedTo);
        continue;
      }
      const reply = aiReply ?? MESSENGER_FALLBACK_REPLY;
      if (fragments > 1) console.log(`  (merged ${fragments} fragments)`);
      console.log(`  Bot: "${reply.slice(0, 160)}"`);

      if (DRY_RUN) {
        console.log('  🟡 DRY_RUN — not sending.');
        repliedTo.add(msgKey); saveReplied(repliedTo);
        continue;
      }

      const delay = humanDelayMs(reply);
      console.log(`  (thinking ${(delay / 1000).toFixed(1)}s...)`);
      await new Promise((r) => setTimeout(r, delay));

      const sent = await sendReply(threadPage, reply);
      if (sent) {
        repliedTo.add(msgKey); saveReplied(repliedTo);
        console.log('  ✅ Sent');
        captureAndSyncLead(threadId, merged || last.text, reply, 'messenger_personal', {
          displayName: displayName?.trim() || null,
        }).catch((e) => console.error('[lead]', e.message));
      } else {
        console.warn('  ⚠️ send failed — will retry next poll');
      }
    } finally {
      // Always close the tab so the inbox stays clean
      await threadPage.close().catch(() => {});
    }
  }
}

/**
 * Read visible messages from the open thread.
 * Returns { last, history } where:
 *   last    — the most recent INCOMING message (or null)
 *   history — array of { role: 'user'|'model', text } for the last N turns
 */
async function getThreadMessages(page) {
  const result = await page
    .evaluate(() => {
      const convo = document.querySelector('div[role="main"]');
      const convoRect = convo?.getBoundingClientRect();
      const convoCenter = convoRect
        ? convoRect.left + convoRect.width / 2
        : window.innerWidth / 2;

      const rows = Array.from(document.querySelectorAll('div[role="row"]'));
      if (!rows.length) return { last: null, history: [] };

      const tsRe = /^(\d{1,2}:\d{2}(\s?[ap]\.?\s?m\.?)?|hoy|today|ayer|yesterday|\d+[wdhms] ago|\d+[wdhms]|lunes|martes|miércoles|jueves|viernes|sábado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;

      const messages = [];
      for (const row of rows) {
        const bubbleDivs = Array.from(row.querySelectorAll('div[dir="auto"]'));
        if (!bubbleDivs.length) continue;
        const bubble = bubbleDivs.reduce((a, b) =>
          (b.textContent?.length ?? 0) > (a.textContent?.length ?? 0) ? b : a
        );
        const text = (bubble.textContent ?? '').trim();
        if (!text || text.length < 2) continue;
        if (tsRe.test(text)) continue;
        if (/·\s*\d+[wdhms]\b/.test(text)) continue;

        const rect = bubble.getBoundingClientRect();
        if (rect.width === 0) continue;
        const center = rect.left + rect.width / 2;
        const isOutgoing = center > convoCenter + 20;

        messages.push({ text, isOutgoing });
      }

      if (!messages.length) return { last: null, history: [] };

      // Build history array (last 10 turns max)
      const history = messages.slice(-10).map(m => ({
        role: m.isOutgoing ? 'model' : 'user',
        text: m.text,
      }));

      // last = most recent INCOMING message
      let last = null;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (!messages[i].isOutgoing) { last = { text: messages[i].text, isIncoming: true }; break; }
      }

      return { last, history };
    })
    .catch(() => ({ last: null, history: [] }));

  return result;
}

/**
 * Seed the in-memory Gemini session history from the page's visible messages.
 * Only seeds if the session has no history yet (i.e. fresh after a bot restart).
 */
function seedSessionFromHistory(threadId, pageHistory) {
  const session = getSession(threadId);
  if (session.history.length > 0 || pageHistory.length === 0) return;
  session.history = pageHistory.map(m => ({
    role: m.role,
    parts: [{ text: m.text }],
  }));
  if (DEBUG) console.log(`[seed] seeded ${session.history.length} turns for thread ${threadId}`);
}

async function sendReply(page, text) {
  try {
    const input = page.locator('[contenteditable="true"][role="textbox"]').last();
    await input.click({ timeout: 5000 });
    // Slightly irregular per-character delay so it looks human
    await input.type(text, { delay: 20 + Math.floor(Math.random() * 40) });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    return true;
  } catch (e) {
    console.error('[send error]', e.message);
    return false;
  }
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
