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
import readline from 'readline';

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
  MESSENGER_FALLBACK_REPLY,
  _aldStock,
  GEMINI_API_KEY,
  GEMINI_MODEL,
} = await import('../server/assistant-brain.mjs');

// ── Config ───────────────────────────────────────────────────────────────────
const USER_DATA_DIR = resolve(__dirname, '..', '.messenger-userdata');
const REPLIED_PATH = resolve(__dirname, '..', '.messenger-replied.json');
const POLL_MS = Number(process.env.MESSENGER_POLL_MS ?? 8000);
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

  console.log(`[messenger-bot] Launching Chromium with persistent profile at ${USER_DATA_DIR}`);
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: HEADLESS,
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  let page = context.pages()[0] ?? (await context.newPage());

  console.log('[messenger-bot] Navigating to Messenger...');
  await page.goto('https://www.messenger.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(3000);

  if (await isLoggedIn(page)) {
    console.log('✅ Already logged in (persistent profile).');
  } else {
    if (HEADLESS) {
      console.error(
        '\n❌ Not logged in and running headless. Run once with MESSENGER_HEADLESS=false to log in manually (incl. 2FA), then restart in headless mode.\n',
      );
      await context.close();
      process.exit(1);
    }

    console.log(
      '\n══════════════════════════════════════════════════════════════════════' +
        '\n🔑  LOGIN REQUIRED — drive the Chrome window yourself.' +
        '\n══════════════════════════════════════════════════════════════════════' +
        '\n  1. Enter email + password on messenger.com / facebook.com' +
        '\n  2. Complete 2FA on facebook.com if prompted' +
        '\n  3. If FB asks "Save your login info?", click Yes' +
        '\n  4. Wait until you SEE your Messenger inbox (chats list visible)' +
        '\n' +
        '\n  ⚠️  This script will NOT touch the browser, navigate, or close anything.' +
        '\n      Take all the time you need. No timeout.' +
        '\n' +
        '\n  👉  When your inbox is visible, come back HERE and press ENTER.' +
        '\n      (Session will be saved to .messenger-userdata/ — one-time setup.)' +
        '\n══════════════════════════════════════════════════════════════════════\n',
    );

    await waitForEnter('Press ENTER once you see your Messenger inbox: ');

    // Re-grab the latest page in case Chromium opened a new tab during 2FA.
    const pages = context.pages().filter((p) => !p.isClosed());
    if (!pages.length) {
      console.error('\n❌ All browser tabs were closed. Re-run the script and try again.\n');
      await context.close();
      process.exit(1);
    }
    // Prefer a tab that's actually on messenger.com
    page = pages.find((p) => p.url().includes('messenger.com')) ?? pages[pages.length - 1];

    if (DEBUG) console.log(`[login] confirming on page: ${page.url()}`);

    if (!(await isLoggedIn(page).catch(() => false))) {
      console.error(
        '\n❌ Confirmed page is NOT a logged-in Messenger inbox.' +
          `\n   Current URL: ${page.url()}` +
          '\n   • Make sure the active tab is https://www.messenger.com/ with your chats visible.' +
          '\n   • If you\'re still on facebook.com, navigate to https://www.messenger.com/ and re-run.\n',
      );
      await context.close();
      process.exit(1);
    }
    console.log('✅ Logged in. Session saved to disk.');
  }

  console.log(
    `\n[messenger-bot] Polling every ${POLL_MS / 1000}s. Press Ctrl+C to stop.${
      HEADLESS ? '' : '\n[messenger-bot] Keep the Chrome window open.'
    }\n`,
  );

  const repliedTo = loadReplied();
  if (DEBUG) console.log(`[dedup] loaded ${repliedTo.size} prior keys from ${REPLIED_PATH}`);

  while (true) {
    try {
      // If the page died (closed tab, crashed, navigated away), recover.
      if (page.isClosed()) {
        console.warn('[messenger-bot] Page closed — opening a new one...');
        page = await context.newPage();
        await page.goto('https://www.messenger.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(3000);
      }
      await checkAndReply(page, repliedTo);
    } catch (e) {
      console.error('[poll error]', e.message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
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

// ── Polling: find unread threads, open each, decide if we should reply ───────
async function checkAndReply(page, repliedTo) {
  // Make sure we're on the inbox shell so the sidebar is mounted
  if (!/messenger\.com\/?(t\/|inbox|$)/.test(page.url())) {
    await page.goto('https://www.messenger.com/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  // Grab a snapshot of sidebar threads with their unread state + display name.
  // We do everything in one page.evaluate so we don't hold stale handles while
  // navigating between threads.
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
        // Heuristics for unread:
        //  1. aria-label contains "no leído" / "unread" / "sin leer"
        //  2. presence of a sibling badge element with role="img" + aria-label containing "no leído"
        //  3. bold text styling on the thread title (font-weight >= 600)
        const ariaLow = aria.toLowerCase();
        let unread =
          ariaLow.includes('unread') ||
          ariaLow.includes('no leído') ||
          ariaLow.includes('no leido') ||
          ariaLow.includes('sin leer');
        if (!unread) {
          const titleSpan = a.querySelector('span[dir="auto"]');
          if (titleSpan) {
            const fw = parseInt(getComputedStyle(titleSpan).fontWeight || '400', 10);
            if (fw >= 600) unread = true;
          }
        }

        const nameEl = a.querySelector('span[dir="auto"]');
        const displayName = (nameEl?.textContent ?? '').trim() || null;

        out.push({ threadId, href, displayName, unread, aria });
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

  // Only act on unread threads. If no unread, do nothing this tick.
  const queue = candidates.filter((c) => c.unread).slice(0, 5);
  if (!queue.length) return;

  for (const cand of queue) {
    const { threadId, href, displayName } = cand;

    if (!passesAllowlist(threadId, displayName)) {
      if (DEBUG)
        console.log(`[allowlist] skip threadId=${threadId} name="${displayName ?? ''}" not in ${JSON.stringify(ALLOWLIST)}`);
      continue;
    }

    const fullUrl = href.startsWith('http') ? href : `https://www.messenger.com${href}`;
    await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2200);

    const last = await getLastIncomingMessage(page);
    if (!last || !last.text || last.text.length < 2) {
      if (DEBUG) console.log(`[skip] threadId=${threadId} no incoming text found`);
      continue;
    }
    if (!last.isIncoming) {
      if (DEBUG) console.log(`[skip] threadId=${threadId} last message is OUTGOING — nothing to reply to`);
      continue;
    }

    const msgKey = `${threadId}::${last.text.slice(0, 120)}`;
    if (repliedTo.has(msgKey)) {
      if (DEBUG) console.log(`[skip] threadId=${threadId} already replied (key seen)`);
      continue;
    }

    console.log(`\n[NEW MSG] Thread: ${threadId}${displayName ? ` (${displayName})` : ''}`);
    console.log(`  User: "${last.text.slice(0, 200)}"`);

    if (!GEMINI_API_KEY) {
      console.warn('  ⚠️  No GEMINI_API_KEY — sending fallback reply.');
      const ok = DRY_RUN ? true : await sendReply(page, MESSENGER_FALLBACK_REPLY);
      if (ok) {
        repliedTo.add(msgKey);
        saveReplied(repliedTo);
      }
      continue;
    }

    // Shared brain w/ debouncer: if more fragments arrive in the same poll
    // window the older calls resolve to { reply: null } and we skip them.
    const { reply: aiReply, merged, fragments } = await enqueueAndGenerateReply(threadId, last.text);
    if (!aiReply && fragments === 0) {
      if (DEBUG) console.log('  …superseded by newer fragment, skipping');
      repliedTo.add(msgKey);
      saveReplied(repliedTo);
      continue;
    }
    const reply = aiReply ?? MESSENGER_FALLBACK_REPLY;
    if (fragments > 1) console.log(`  (merged ${fragments} fragments)`);
    console.log(`  Bot:  "${reply.slice(0, 160)}"`);

    if (DRY_RUN) {
      console.log('  🟡 DRY_RUN — not sending.');
      repliedTo.add(msgKey);
      saveReplied(repliedTo);
      continue;
    }

    // Humanize: wait a realistic amount of time before typing
    const delay = humanDelayMs(reply);
    console.log(`  (thinking ${(delay / 1000).toFixed(1)}s before replying...)`);
    await new Promise((r) => setTimeout(r, delay));

    const sent = await sendReply(page, reply);
    if (sent) {
      repliedTo.add(msgKey);
      saveReplied(repliedTo);
      console.log('  ✅ Sent');

      // Fire-and-forget lead capture (Sheet + FullMotor CRM). Use the merged
      // text so the CRM sees the full multi-fragment context.
      captureAndSyncLead(threadId, merged || last.text, reply, 'messenger_personal', {
        displayName: displayName?.trim() || null,
      }).catch((e) => console.error('[lead] capture error:', e.message));
    } else {
      console.warn('  ⚠️  send failed; will retry on next poll');
    }

    // Be nice to Messenger — small pause between threads
    await page.waitForTimeout(1500);
  }
}

/**
 * Detect the last message in the open thread AND whether it's incoming.
 *
 * Strategy: look at all message bubbles via [role="row"] grids, take the last
 * one with non-empty text, then decide direction by horizontal alignment of
 * the bubble within the conversation column. Outgoing messages are right-
 * aligned, incoming messages are left-aligned. This is resilient to FB's
 * frequent class-name churn.
 */
async function getLastIncomingMessage(page) {
  const result = await page
    .evaluate(() => {
      const rows = Array.from(document.querySelectorAll('div[role="row"]'));
      if (!rows.length) return null;

      // Find the conversation column width (use the chat container)
      let convoWidth = window.innerWidth;
      const convo = document.querySelector('div[role="main"]');
      if (convo) convoWidth = convo.getBoundingClientRect().width;

      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        const text = (row.textContent ?? '').trim();
        if (!text || text.length < 2) continue;
        // Skip rows that look like timestamp markers
        if (/^\d{1,2}:\d{2}(\s?[ap]\.?\s?m\.?)?$/i.test(text)) continue;
        if (/^(Hoy|Today|Ayer|Yesterday)/i.test(text) && text.length < 40) continue;

        // Find the message bubble inside the row — pick the widest non-image
        // descendant whose text matches.
        let bubble = row.querySelector('div[dir="auto"]') ?? row;
        const rect = bubble.getBoundingClientRect();
        if (rect.width === 0) continue;

        const center = rect.left + rect.width / 2;
        const convoRect = convo?.getBoundingClientRect();
        const convoCenter = convoRect ? convoRect.left + convoRect.width / 2 : convoWidth / 2;
        const isOutgoing = center > convoCenter + 20; // right-of-center → ours

        return { text, isIncoming: !isOutgoing };
      }
      return null;
    })
    .catch(() => null);

  return result;
}

function waitForEnter(prompt) {
  return new Promise((resolveP) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => {
      rl.close();
      resolveP();
    });
  });
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
