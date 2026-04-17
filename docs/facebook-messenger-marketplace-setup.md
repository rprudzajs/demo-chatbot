# Facebook Page Messenger webhook (real messages) — setup for your demo

## What this is (and isn’t)

| Goal | Supported path |
|------|----------------|
| Receive/send chats **as your business** via official APIs | **Messenger Platform** on a **Facebook Page** you control ([Send API](https://developers.facebook.com/docs/messenger-platform/reference/send-api/), [webhooks](https://developers.facebook.com/docs/messenger-platform/webhook)) |
| Automate arbitrary **Marketplace UI** or scrape threads | **Not** supported here — violates typical platform rules and has no public “Marketplace DM” API for hobby projects |

Many Marketplace buyers still contact sellers through **Messenger** tied to a **Page**. This repo’s `server/index.mjs` implements the **webhook + static site** so you can test **real** inbound/outbound messages on that Page once Meta is configured.

## 1) Prerequisites

- A **Meta Business** / personal account able to create apps  
- A **Facebook Page** for the dealership (the same identity you use professionally on Marketplace is often linked to a Page — buyers may message the Page)  
- **Railway** (or another HTTPS host) with a stable URL like `https://YOUR_SERVICE.up.railway.app`

## 2) Meta Developer app

1. Go to [developers.facebook.com](https://developers.facebook.com/) → **My Apps** → **Create App** → type **Business** (or **Other** if that fits your flow).  
2. Add product **Messenger** (and **Facebook Login for Business** if the dashboard asks).  
3. **Messenger → Settings** (or API setup): select your **Page**, generate a **Page access token** with **`pages_messaging`** (and messaging-related tasks your app shows).  
4. Copy and store securely:
   - **Page access token** → Railway: `MESSENGER_PAGE_ACCESS_TOKEN`  
   - **App secret** (Settings → Basic) → Railway: `META_APP_SECRET` (enables signature verification)

Treat the Page token like a password.

## Webhook URL and verify token

5. Pick a random **Verify token** string (any long random secret).  
   - Railway: **`META_WEBHOOK_VERIFY_TOKEN`** (recommended for **Messenger + WhatsApp** on the same URL) or `MESSENGER_VERIFY_TOKEN` (legacy). Same value you paste in Meta.

6. In **Messenger → Webhooks** (or **Instagram / Messenger configuration** in newer UI):  
   - **Callback URL:** `https://YOUR_DOMAIN/webhook`  
   - **Verify token:** same as `META_WEBHOOK_VERIFY_TOKEN` or `MESSENGER_VERIFY_TOKEN`  
   - Subscribe at **Page** level to at least: `messages` (and `messaging_postbacks` if you add buttons later).

7. Deploy this repo with `npm start` (runs `node server/index.mjs`). Railway **healthcheck** `GET /` should still return 200.

8. Optional demo auto-reply: set  
   `MESSENGER_AUTO_REPLY=Gracias, recibimos tu mensaje. Un asesor te responde pronto.`  
   Inbound **text** messages get this reply (simple proof the pipe works).

## 3) Environment variables (Railway)

| Variable | Required | Purpose |
|----------|----------|--------|
| `META_WEBHOOK_VERIFY_TOKEN` | Yes (recommended) | Shared verify for Messenger **and** WhatsApp webhooks |
| `MESSENGER_VERIFY_TOKEN` | Alternative | Used if `META_WEBHOOK_VERIFY_TOKEN` is empty |
| `MESSENGER_PAGE_ACCESS_TOKEN` | For real replies | Graph Send API |
| `META_APP_SECRET` | Strongly recommended | Validates `X-Hub-Signature-256` |
| `MESSENGER_AUTO_REPLY` | No | Short automatic text reply |
| `GEMINI_API_KEY` | For web chat AI | Vite build / client |
| `VITE_LEADS_WEBHOOK_URL` | Optional | Google Sheet CRM from web chat |

**WhatsApp Cloud API** uses the same `/webhook` path; add `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, optional `WHATSAPP_AUTO_REPLY` — see [`whatsapp-cloud-api-setup.md`](./whatsapp-cloud-api-setup.md).

## 4) Testing “Marketplace” realistically

- Ask a friend (or your second account) to open your **Page** in Messenger or use the **Message** button on the Page / listing flow Meta associates with your business.  
- Not every Marketplace thread will appear as a standard Page message; if an event doesn’t hit the webhook, Meta may be routing that thread differently. The webhook is still the correct **supported** integration surface for Page messaging.

## 5) Next steps (after echo works)

- Map `sender.id` (PSID) to your CRM row  
- Replace `MESSENGER_AUTO_REPLY` with a call to your Gemini (or queue) **on the server** — never call Gemini from the browser with secrets  
- Outbound **images**: must use **public HTTPS URLs** or Meta’s **attachment upload** flow ([Send API attachments](https://developers.facebook.com/docs/messenger-platform/send-messages#attachments))

## Local development

```bash
npm run build
META_WEBHOOK_VERIFY_TOKEN=devtoken MESSENGER_PAGE_ACCESS_TOKEN= MESSENGER_AUTO_REPLY= node server/index.mjs
```

Use [ngrok](https://ngrok.com/) (or similar) to expose `/webhook` HTTPS for Meta during development.
