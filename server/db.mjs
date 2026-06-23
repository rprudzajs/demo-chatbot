/**
 * Postgres connection pool — shared across the server.
 * Used to log WhatsApp conversations + leads for the dashboard.
 */
import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = String(process.env.DATABASE_URL ?? '').trim();

let _pool = null;

export function getPool() {
  if (!DATABASE_URL) return null;
  if (!_pool) {
    _pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false },
      max: 5,
    });
    _pool.on('error', (e) => console.error('[db] pool error', e.message));
  }
  return _pool;
}

/**
 * Upsert conversation + log a message.
 * Safe to call fire-and-forget — errors are caught and logged.
 */
export async function logMessage({ phone, name, source, role, content, carInterest }) {
  const pool = getPool();
  if (!pool) return;
  try {
    // Upsert conversation row
    const { rows } = await pool.query(
      `INSERT INTO conversations (phone, name, source, car_interest, last_message_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (phone) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, conversations.name),
         car_interest = COALESCE(EXCLUDED.car_interest, conversations.car_interest),
         last_message_at = NOW()
       RETURNING id`,
      [phone, name ?? null, source ?? 'whatsapp', carInterest ?? null],
    );
    const conversationId = rows[0].id;

    // Insert message
    await pool.query(
      `INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
      [conversationId, role, content],
    );
  } catch (e) {
    console.error('[db] logMessage error', e.message);
  }
}

/**
 * Upsert a lead record tied to a conversation.
 */
export async function logLead({ phone, name, email, carMake, carModel, carYear, crmLeadId, source }) {
  const pool = getPool();
  if (!pool) return;
  try {
    const { rows } = await pool.query(
      `SELECT id FROM conversations WHERE phone = $1`,
      [phone],
    );
    if (!rows.length) return;
    const conversationId = rows[0].id;

    await pool.query(
      `INSERT INTO leads (conversation_id, name, phone, email, car_make, car_model, car_year, crm_lead_id, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT DO NOTHING`,
      [conversationId, name ?? null, phone, email ?? null, carMake ?? null, carModel ?? null, carYear ?? null, crmLeadId ?? null, source ?? 'whatsapp'],
    );
  } catch (e) {
    console.error('[db] logLead error', e.message);
  }
}

/**
 * Fetch all conversations ordered by most recent message.
 */
export async function getConversations({ limit = 50, offset = 0 } = {}) {
  const pool = getPool();
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT c.*,
         (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
         (SELECT COUNT(*)::int FROM messages WHERE conversation_id = c.id AND role = 'user') AS message_count
       FROM conversations c
       ORDER BY c.last_message_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  } catch (e) {
    console.error('[db] getConversations error', e.message);
    return [];
  }
}

/**
 * Fetch all leads ordered by most recent.
 */
export async function getLeads({ limit = 200, offset = 0 } = {}) {
  const pool = getPool();
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT l.*, c.source, c.car_interest, c.last_message_at
       FROM leads l
       JOIN conversations c ON c.id = l.conversation_id
       ORDER BY l.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  } catch (e) {
    console.error('[db] getLeads error', e.message);
    return [];
  }
}

/**
 * Aggregate stats for the dashboard overview.
 */
export async function getStats() {
  const pool = getPool();
  if (!pool) return { conversations: 0, leads: 0, today: 0 };
  try {
    const [convRes, leadRes, todayRes] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM conversations'),
      pool.query('SELECT COUNT(*)::int AS count FROM leads'),
      pool.query("SELECT COUNT(*)::int AS count FROM conversations WHERE last_message_at >= NOW() - INTERVAL '24 hours'"),
    ]);
    return {
      conversations: convRes.rows[0].count,
      leads: leadRes.rows[0].count,
      today: todayRes.rows[0].count,
    };
  } catch (e) {
    console.error('[db] getStats error', e.message);
    return { conversations: 0, leads: 0, today: 0 };
  }
}

/**
 * Fetch all messages for a conversation.
 */
export async function getMessages(phone) {
  const pool = getPool();
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT m.* FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.phone = $1
       ORDER BY m.created_at ASC`,
      [phone],
    );
    return rows;
  } catch (e) {
    console.error('[db] getMessages error', e.message);
    return [];
  }
}
