# WhatsApp Business Cloud API — webhook + demo reply

This uses the **same** `GET|POST /webhook` URL and the **same verify token** as Messenger (`META_WEBHOOK_VERIFY_TOKEN` or `MESSENGER_VERIFY_TOKEN`). Meta sends a different `object` type in the POST body (`whatsapp_business_account` vs `page`); `server/index.mjs` routes both.

## What you need in Meta / Business Manager

1. **Meta Business Portfolio** (Business Manager)  
2. **WhatsApp Business Account (WABA)** linked to the app  
3. A **phone number** for WhatsApp Cloud API (new number or migrated — follow [WhatsApp Cloud API Get Started](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started))  
4. In the developer app, add use case / product **WhatsApp** and finish **API setup** so you have:
   - **Phone number ID** (not the E.164 display number — the numeric ID from the console)  
   - **Temporary** or **permanent** access token with `whatsapp_business_messaging` (and related scopes your app shows)

## Webhook (same host as your site)

1. **WhatsApp → Configuration** (Webhooks):  
   - Callback URL: `https://YOUR_RAILWAY_DOMAIN/webhook`  
   - Verify token: **exactly** the same value as `MESSENGER_VERIFY_TOKEN` or `META_WEBHOOK_VERIFY_TOKEN`  
2. Subscribe the app to **`messages`** (and `message_template_status` later if you use templates).

After saving, Meta runs **GET** verification against your server — it must already be deployed with the token set.

## Railway environment variables

| Variable | Purpose |
|----------|--------|
| `WHATSAPP_PHONE_NUMBER_ID` | From **WhatsApp → API Setup** (numeric id) |
| `WHATSAPP_ACCESS_TOKEN` | Cloud API token (**secret**, server-only) |
| `WHATSAPP_AUTO_REPLY` | Optional demo text reply to inbound **text** messages |
| `META_WEBHOOK_VERIFY_TOKEN` | Optional **preferred** single token for Messenger + WhatsApp webhooks |
| `MESSENGER_VERIFY_TOKEN` | Still supported if you don’t set `META_WEBHOOK_VERIFY_TOKEN` |
| `META_APP_SECRET` | Recommended — validates `X-Hub-Signature-256` for **both** channels |

`GEMINI_API_KEY` / `VITE_*` stay separate (frontend build).

## Limits & policy

- **24-hour session**: after the user messages you, you can send **session** messages freely for that window; outside it you generally need **template** messages (approved).  
- **Template messages** are required for cold outreach — not covered in the demo auto-reply.  
- **Media** inbound/outbound uses different JSON shapes — the server currently logs attachment types; extend `handleWhatsAppWebhook` when you need images.

## Test

1. Add your **personal WhatsApp** as a test number in **WhatsApp → API Setup** (development mode), or use a production number per Meta rules.  
2. Send a text to the business number.  
3. Check Railway logs for `[whatsapp inbound]`. If `WHATSAPP_AUTO_REPLY` is set, you should get that text back.
