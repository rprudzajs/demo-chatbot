/**
 * FullMotor BackOffice CRM — session-cookie client
 *
 * Env (Railway, server-only):
 *   FULLMOTOR_CRM_EMAIL    — account email (e.g. Cristobalpf@ald.cl)
 *   FULLMOTOR_CRM_PASSWORD — account password
 *   FULLMOTOR_CRM_VENDEDOR  — salesperson email assigned to auto-created leads
 *                             (defaults to FULLMOTOR_CRM_EMAIL)
 *   FULLMOTOR_CRM_DRY_RUN  — set to "true" to log all CRM calls without actually
 *                             sending any HTTP requests (safe for local testing)
 *
 * The CRM is server-rendered PHP with no public REST API.
 * We POST to the two known PHP endpoints using a session cookie obtained at login.
 * The cookie is cached in memory and refreshed when it expires or when the server
 * redirects us back to the login page.
 */

const CRM_BASE = 'https://www.rtautomotriz.com/responsive';
const CRM_LOGIN_URL = `${CRM_BASE}/PHPlogin.php`;
const CRM_CREATE_URL = `${CRM_BASE}/MINICRM_GrabarLead.php`;
const CRM_UPDATE_URL = `${CRM_BASE}/MINICRM_CambioEstado.php`;
const CRM_SUCURSAL = 'COMANDANTE MALBEC 13495';

// ── Env ──────────────────────────────────────────────────────────────────────
const CRM_EMAIL = String(process.env.FULLMOTOR_CRM_EMAIL ?? '').trim();
const CRM_PASSWORD = String(process.env.FULLMOTOR_CRM_PASSWORD ?? '').trim();
export const CRM_VENDEDOR = String(
  process.env.FULLMOTOR_CRM_VENDEDOR ?? CRM_EMAIL,
).trim();

/**
 * When true, all CRM calls are logged but no HTTP requests are sent.
 * Set FULLMOTOR_CRM_DRY_RUN=true in your local .env to test safely.
 */
export const DRY_RUN = String(process.env.FULLMOTOR_CRM_DRY_RUN ?? '').trim().toLowerCase() === 'true';

// ── Session cache ─────────────────────────────────────────────────────────────
let _cookieMap = null; // { [name]: value }
let _loginAt = 0;
const SESSION_TTL_MS = 18 * 60 * 1000; // refresh 2 min before PHP 20-min timeout

// ── Cookie helpers ────────────────────────────────────────────────────────────

function _parseCookies(headers) {
  /** Accept Headers object (Node fetch) or an array of Set-Cookie strings */
  let lines = [];
  if (headers && typeof headers.getSetCookie === 'function') {
    lines = headers.getSetCookie();
  } else if (headers && typeof headers.get === 'function') {
    const raw = headers.get('set-cookie');
    if (raw) lines = [raw];
  } else if (Array.isArray(headers)) {
    lines = headers;
  }

  const map = {};
  for (const line of lines) {
    if (!line) continue;
    const part = line.split(';')[0].trim();
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    map[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return map;
}

function _cookieHeader(map) {
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function _login() {
  if (DRY_RUN) {
    console.info('[fullmotor-crm] [DRY-RUN] login skipped — would POST to', CRM_LOGIN_URL);
    _cookieMap = { 'dry-run-session': 'fake' };
    _loginAt = Date.now();
    return true;
  }

  if (!CRM_EMAIL || !CRM_PASSWORD) {
    console.warn('[fullmotor-crm] FULLMOTOR_CRM_EMAIL / FULLMOTOR_CRM_PASSWORD not set — CRM sync disabled');
    return false;
  }

  const body = new URLSearchParams({
    email: CRM_EMAIL,
    password: CRM_PASSWORD,
    login: '1',
  });

  try {
    const res = await fetch(CRM_LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      redirect: 'manual', // we collect cookies from the 302 response, not the final page
    });

    const cookies = _parseCookies(res.headers);
    if (!Object.keys(cookies).length) {
      console.warn('[fullmotor-crm] login: no Set-Cookie in response — credentials may be wrong');
      return false;
    }

    _cookieMap = cookies;
    _loginAt = Date.now();
    console.info('[fullmotor-crm] session established', Object.keys(cookies));
    return true;
  } catch (e) {
    console.error('[fullmotor-crm] login error', e);
    return false;
  }
}

async function _ensureSession() {
  if (!CRM_EMAIL || !CRM_PASSWORD) return false;
  if (_cookieMap && Date.now() - _loginAt < SESSION_TTL_MS) return true;
  return _login();
}

function _isRedirectedToLogin(url) {
  // PHP session expired → server redirects to login/home
  return (
    typeof url === 'string' &&
    (url.includes('/home') || url.includes('/login')) &&
    !url.includes('/crm')
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a new lead in the CRM.
 * Returns the numeric lead ID string if the server redirected to the detail
 * page after creation, otherwise null (lead was still created — we just
 * couldn't capture the ID from the redirect URL).
 *
 * @param {{
 *   nombre?: string,
 *   telefono?: string,
 *   email?: string,
 *   marca?: string,
 *   modelo?: string,
 *   origen?: string,
 *   mensaje?: string,
 *   link?: string
 * }} params
 * @returns {Promise<string|null>} crmLeadId or null
 */
export async function crmCreateLead(params) {
  if (DRY_RUN) {
    console.info('[fullmotor-crm] [DRY-RUN] crmCreateLead — would POST:', params);
    return 'dry-run-999';
  }
  if (!await _ensureSession()) return null;

  const {
    nombre = 'Prospecto Web',
    telefono = '',
    email = '',
    marca = '',
    modelo = '',
    origen = 'REDES SOCIALES',
    mensaje = '',
    link = '',
  } = params;

  const body = new URLSearchParams({
    origen,
    usados: '1',
    nombre,
    rut: '',
    telefono,
    email,
    marca,
    modelo,
    sucursal: CRM_SUCURSAL,
    mensaje: mensaje.slice(0, 1000),
    link: link.slice(0, 500),
    enviar: '1',
  });

  try {
    const res = await fetch(CRM_CREATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: _cookieHeader(_cookieMap),
      },
      body: body.toString(),
      redirect: 'follow',
    });

    // Absorb new cookies from the response
    const fresh = _parseCookies(res.headers);
    if (Object.keys(fresh).length) Object.assign(_cookieMap, fresh);

    // Session expired mid-request → re-auth once and retry
    if (_isRedirectedToLogin(res.url)) {
      console.warn('[fullmotor-crm] createLead: session expired — re-authing');
      _cookieMap = null;
      if (!await _login()) return null;
      return crmCreateLead(params);
    }

    // Try to read the new lead ID from the final redirect URL
    const idMatch = res.url.match(/crm\/detalle\/(\d+)/);
    const leadId = idMatch ? idMatch[1] : null;
    console.info('[fullmotor-crm] lead created', { leadId, url: res.url, status: res.status });
    return leadId;
  } catch (e) {
    console.error('[fullmotor-crm] createLead error', e);
    return null;
  }
}

/**
 * Update an existing CRM lead.
 * Safe to call with a null/undefined id — will be a no-op.
 *
 * @param {string|null} id  Numeric lead ID returned from crmCreateLead
 * @param {{
 *   nombre1?: string,
 *   telefono1?: string,
 *   email1?: string,
 *   modelo?: string,
 *   estado?: string,
 *   vendedor?: string,
 *   mensaje?: string
 * }} params
 * @returns {Promise<boolean>}
 */
export async function crmUpdateLead(id, params) {
  if (!id) return false;
  if (DRY_RUN) {
    console.info('[fullmotor-crm] [DRY-RUN] crmUpdateLead — would POST id=%s:', id, params);
    return true;
  }
  if (!await _ensureSession()) return false;

  const {
    nombre1 = '',
    telefono1 = '',
    email1 = '',
    modelo = '',
    estado = '2',    // 2 = VOLVER A LLAMAR (default follow-up state)
    vendedor = CRM_VENDEDOR,
    mensaje = '',
  } = params;

  const body = new URLSearchParams({
    id: String(id),
    nombre1,
    nombre2: '',
    rut1: '',
    rut2: '',
    telefono1,
    telefono2: '',
    email1,
    email2: '',
    asistelocal: '0',
    probabilidadcompra: '0',
    estado,
    dp2: '',
    nrofactura: '',
    precioventa: '',
    dp1: '',
    vendedor,
    motivocierre: '',
    sexo: 'M',
    modelo,
    mensaje: mensaje.slice(0, 1000),
  });

  try {
    const res = await fetch(CRM_UPDATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: _cookieHeader(_cookieMap),
      },
      body: body.toString(),
      redirect: 'follow',
    });

    const fresh = _parseCookies(res.headers);
    if (Object.keys(fresh).length) Object.assign(_cookieMap, fresh);

    if (_isRedirectedToLogin(res.url)) {
      console.warn('[fullmotor-crm] updateLead: session expired — re-authing');
      _cookieMap = null;
      if (!await _login()) return false;
      return crmUpdateLead(id, params);
    }

    console.info('[fullmotor-crm] lead updated', { id, estado, status: res.status });
    return res.ok || res.status === 302;
  } catch (e) {
    console.error('[fullmotor-crm] updateLead error', e);
    return false;
  }
}

/**
 * Map a lead source string to the CRM's "origen" dropdown value.
 * @param {'messenger'|'whatsapp'|'web_chat'|string} source
 * @param {boolean} [fromMarketplace]
 */
export function crmOrigen(source, fromMarketplace = false) {
  if (source === 'whatsapp') {
    return fromMarketplace ? 'REFERIDO MERCADOLIBRE' : 'REDES SOCIALES';
  }
  if (source === 'messenger') {
    return fromMarketplace ? 'REFERIDO MERCADOLIBRE' : 'REDES SOCIALES';
  }
  if (source === 'web_chat') return 'CONTACTO WEB';
  return 'OTRO';
}
