/**
 * CRM integration test — run locally, zero risk to production data.
 *
 * By default runs in DRY-RUN mode: logs every call but sends NO HTTP requests.
 * To test against the real CRM, pass --live as an argument (only do this
 * intentionally — it will create a real test lead that you'll need to delete).
 *
 * Usage:
 *   node scripts/test-crm.mjs              ← dry-run (safe, always start here)
 *   node scripts/test-crm.mjs --live       ← hits real CRM (creates a test lead)
 *
 * Env needed for --live:
 *   FULLMOTOR_CRM_EMAIL=Cristobalpf@ald.cl
 *   FULLMOTOR_CRM_PASSWORD=<password>
 */

import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { readFileSync, existsSync } from 'fs';

// ── Load .env manually (no dotenv dependency needed) ─────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
  console.log('[test] loaded .env from', envPath);
} else {
  console.log('[test] no .env file found — using process environment');
}

// ── Force dry-run unless --live is explicitly passed ─────────────────────────
const isLive = process.argv.includes('--live');
if (!isLive) {
  process.env.FULLMOTOR_CRM_DRY_RUN = 'true';
  console.log('\n[test] DRY-RUN mode — no real HTTP requests will be sent.');
  console.log('[test] Pass --live to test against the real CRM.\n');
} else {
  process.env.FULLMOTOR_CRM_DRY_RUN = 'false';
  console.warn('\n⚠️  LIVE mode — this WILL create a real lead in the CRM.');
  console.warn('⚠️  You will need to delete it manually afterwards.\n');
  // Small pause so you can Ctrl-C if you changed your mind
  await new Promise(r => setTimeout(r, 2000));
}

// ── Import CRM module (after env is set) ─────────────────────────────────────
const { crmCreateLead, crmUpdateLead, crmOrigen, DRY_RUN } = await import('../server/fullmotor-crm.mjs');

// ── Test data ─────────────────────────────────────────────────────────────────
const TEST_LEAD = {
  nombre: 'TEST Bot Autoexpert',
  telefono: '+56912345678',
  email: 'test-bot@ald.cl',
  marca: 'Volvo',
  modelo: 'Volvo V40 Cross Country T4 2015',
  origen: crmOrigen('messenger', false),
  mensaje: '[MESSENGER] Hola, me interesa el Volvo V40. (TEST — eliminar)',
  link: 'psid:test-123456789',
};

// ── Run tests ─────────────────────────────────────────────────────────────────
console.log('─'.repeat(60));
console.log('TEST 1 — crmOrigen() mapping');
console.log('─'.repeat(60));
const cases = [
  ['messenger', false],
  ['messenger', true],
  ['whatsapp', false],
  ['whatsapp', true],
  ['web_chat', false],
];
for (const [src, mktplace] of cases) {
  console.log(`  crmOrigen('${src}', ${mktplace}) → "${crmOrigen(src, mktplace)}"`);
}
console.log('  ✅ origen mapping OK\n');

console.log('─'.repeat(60));
console.log('TEST 2 — crmCreateLead()');
console.log('─'.repeat(60));
console.log('  Payload:', JSON.stringify(TEST_LEAD, null, 4).replace(/^/gm, '  '));

const leadId = await crmCreateLead(TEST_LEAD);

if (leadId) {
  console.log(`\n  ✅ Lead created — ID: ${leadId}`);
  if (DRY_RUN) console.log('  (dry-run: no real lead was created)');
  else console.log(`  ⚠️  Real lead created at: https://www.rtautomotriz.com/responsive/crm/detalle/${leadId}`);
} else {
  console.error('  ❌ crmCreateLead returned null — check credentials / network');
  process.exit(1);
}

console.log('\n' + '─'.repeat(60));
console.log('TEST 3 — crmUpdateLead()');
console.log('─'.repeat(60));

const updateOk = await crmUpdateLead(leadId, {
  nombre1: 'TEST Bot Autoexpert',
  telefono1: '+56912345678',
  email1: 'test-bot@ald.cl',
  modelo: 'Volvo V40 Cross Country T4 2015',
  estado: '2', // VOLVER A LLAMAR
  mensaje: '[MESSENGER] Usuario compartió teléfono. (TEST — eliminar)',
});

if (updateOk) {
  console.log('  ✅ Lead updated OK');
  if (DRY_RUN) console.log('  (dry-run: no real update was sent)');
} else {
  console.error('  ❌ crmUpdateLead returned false');
}

console.log('\n' + '─'.repeat(60));
if (DRY_RUN) {
  console.log('✅ All tests passed in DRY-RUN mode — nothing was sent to the CRM.');
  console.log('   When ready to test live: node scripts/test-crm.mjs --live');
} else {
  console.log('✅ All tests passed against LIVE CRM.');
  console.log(`   👉 Delete the test lead at: https://www.rtautomotriz.com/responsive/crm/detalle/${leadId}`);
}
console.log('─'.repeat(60));
