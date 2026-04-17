# Chat leads → Google Sheets (Apps Script, option A)

The app **POSTs JSON** when the visitor types an **email** or **Chile mobile** (`9 XXXX XXXX`) in the chat. The destination URL is `VITE_LEADS_WEBHOOK_URL` (see `services/leadWebhook.ts`).

---

## English — try this first (Google Apps Script)

### 1) Create the spreadsheet

1. New Google Sheet, name it (e.g. `ALD Leads`).
2. First tab: rename to **`Leads`** (or change `SHEET_NAME` in the script below).
3. **Row 1** headers (exact order for the default script):

| A | B | C | D | E | F | G | H | I | J | K | L | M |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sentAt | conversation_id | contact_key | source | language | email | phone | lastUserMessage | vehicle_id | vehicle_make | vehicle_model | vehicle_year | transcript_json |

**One row per visitor (no row spam):** the script below **updates** an existing row when it sees the same **`conversation_id`** (same browser session). After the visitor shares email/phone, it can also match **`contact_key`** so a **returning** lead stays on **one row** (new tab/session updates that row; `transcript_json` is the **latest** conversation snapshot from the app, not merged history across old sessions).

### 2) Add the script

1. **Extensions → Apps Script**.
2. Replace `Code.gs` with:

```javascript
const SPREADSHEET_ID = 'PUT_YOUR_SHEET_ID_HERE';
const SHEET_NAME = 'Leads';

/** 1-based column indexes (must match row 1 headers). */
const COL = {
  SENT_AT: 1,
  CONVERSATION_ID: 2,
  CONTACT_KEY: 3,
  SOURCE: 4,
  LANGUAGE: 5,
  EMAIL: 6,
  PHONE: 7,
  LAST_MESSAGE: 8,
  VEHICLE_ID: 9,
  VEHICLE_MAKE: 10,
  VEHICLE_MODEL: 11,
  VEHICLE_YEAR: 12,
  TRANSCRIPT: 13,
};

function buildRow_(data) {
  const vehicle = data.vehicle || {};
  return [
    data.sentAt || '',
    data.conversationId || '',
    data.contactKey != null ? String(data.contactKey) : '',
    data.source || '',
    data.language || '',
    data.email || '',
    data.phone || '',
    String(data.lastUserMessage || '').slice(0, 2000),
    vehicle.id || '',
    vehicle.make || '',
    vehicle.model || '',
    vehicle.year != null ? vehicle.year : '',
    JSON.stringify(data.transcript || []).slice(0, 50000),
  ];
}

/** First data row = 2 (row 1 is headers). Returns 0 if not found. */
function findRowByColumn_(sheet, colIndex, value) {
  if (value == null || String(value) === '') return 0;
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const want = String(value);
  const cells = sheet.getRange(2, colIndex, last, colIndex).getValues();
  for (let i = 0; i < cells.length; i++) {
    if (String(cells[i][0]) === want) return i + 2;
  }
  return 0;
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'invalid_json' })).setMimeType(
      ContentService.MimeType.JSON
    );
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  const row = buildRow_(data);
  const numCols = row.length;

  let rowIndex = findRowByColumn_(sheet, COL.CONVERSATION_ID, data.conversationId);
  if (!rowIndex && data.contactKey != null && String(data.contactKey) !== '') {
    rowIndex = findRowByColumn_(sheet, COL.CONTACT_KEY, String(data.contactKey));
  }

  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, rowIndex, numCols).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true, upsert: rowIndex > 0 })).setMimeType(
    ContentService.MimeType.JSON
  );
}
```

**Bound script** (no ID in URL): replace `SpreadsheetApp.openById(SPREADSHEET_ID)` with `SpreadsheetApp.getActiveSpreadsheet()` and remove `SPREADSHEET_ID`.

3. **Save** (disk icon). Select the project, run **any** function once if Google asks for authorization (only needed before deploy).

### 3) Deploy as web app

1. **Deploy → New deployment**.
2. Gear → **Web app**.
3. **Execute as:** Me. **Who has access:** **Anyone** (required for anonymous POST from the chat).
4. **Deploy**, authorize, copy the **Web app URL** (ends with `/exec`).

### 4) Wire the demo

**Production / direct URL**

In `.env.local`:

```env
VITE_LEADS_WEBHOOK_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT/exec
```

Restart `npm run dev` after any change to `VITE_*`.

**Local dev (recommended — avoids CORS to `script.google.com`)**

Browsers often block `fetch` from your dev origin to Google’s domain. Use the built-in Vite proxy:

```env
LEADS_APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT/exec
VITE_LEADS_WEBHOOK_URL=/api/leads-proxy
```

Same URL in both lines: one for the proxy target (server-only, not `VITE_`), one for the browser path.

### 5) Test

1. Restart the dev server.
2. Open the chat, send a message that includes an email **or** a Chile-style mobile.
3. Check the **Leads** tab for a new row.

**Quick server test (no UI):**

```bash
curl -sS -X POST "$YOUR_WEB_APP_URL" \
  -H 'Content-Type: application/json' \
  -d '{"source":"web_chat","language":"es","conversationId":"test-session","contactKey":null,"email":"test@example.com","phone":null,"lastUserMessage":"hola","transcript":[],"sentAt":"2026-01-01T00:00:00.000Z"}'
```

You should see `{"ok":true}` and a new row.

### Troubleshooting

- **No row, no error:** `VITE_LEADS_WEBHOOK_URL` empty or dev server not restarted.
- **Browser console CORS error:** use the **proxy** pair (`LEADS_APPS_SCRIPT_URL` + `VITE_LEADS_WEBHOOK_URL=/api/leads-proxy`) for local dev. For a public site, you may need a small backend or Zapier/Make if Google still blocks the browser.
- **403 / authorization:** redeploy the web app; ensure **Anyone** can access.

---

## Español (resumen)

La demo envía JSON a `VITE_LEADS_WEBHOOK_URL`. Opción A: Apps Script con `doPost` que hace **upsert** (actualiza fila por `conversation_id` o `contact_key`, o crea una fila nueva). Despliega como **aplicación web** con acceso **Cualquiera**. En local, usa `LEADS_APPS_SCRIPT_URL` + `VITE_LEADS_WEBHOOK_URL=/api/leads-proxy` para evitar CORS.

## Payload (`LeadPayload`)

- `source`: `web_chat`
- `language`: `es`
- `conversationId`: UUID, stable in `sessionStorage` for the tab (**primary** key for upsert while the session is open).
- `contactKey`: `email:…` or `phone:…` once known — **secondary** key so the same person can keep **one sheet row** across new sessions (optional merge in Apps Script).
- `email`, `phone`, `lastUserMessage` (email/phone are filled from the **latest known** values in the transcript, not only the last line)
- `vehicle`: `{ id, make, model, year }` or omitted
- `transcript`: array of `{ role, text }`
- `sentAt`: ISO string

If `VITE_LEADS_WEBHOOK_URL` is unset, leads are not sent; the chat still works.
