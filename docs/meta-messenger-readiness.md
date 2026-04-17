# Meta Messenger / Marketplace — readiness (before App Review)

This repo is a **web chat** that mimics Messenger UX. **Facebook Marketplace listing UIs** and **Messenger lead threads** are separate Meta surfaces; connecting them for production usually means:

1. **Meta Business Portfolio** + **Page** linked to the business  
2. **Messenger Platform** (webhooks + Send API) — [Send API reference](https://developers.facebook.com/docs/messenger-platform/reference/send-api)  
3. **Never put Page Access Tokens in the browser** — add a small server (Railway service, Cloud Function, etc.) that holds `PAGE_ACCESS_TOKEN` and calls Graph.  
4. **Inbound images** from users arrive as attachments in the webhook payload; **outbound images** need either a **public `https` URL** in `attachment.payload.url` or the **[attachment upload](https://developers.facebook.com/docs/messenger-platform/send-messages#attachments)** flow.  
5. **App Review** may apply for broader permissions and for consumer messaging outside standard conversation windows — plan time for policy and test users.

## What is already in this codebase

| Piece | Location |
|--------|----------|
| Graph-shaped **types** (send + webhook sketch) | `services/meta/types.ts` |
| **Dry-run outbox** (dev console; no tokens) | `services/meta/outbox.ts` |
| **Image attachments in UI** + **Gemini multimodal** | `components/ChatWidget.tsx`, `services/geminiService.ts` |
| CRM transcript includes **`imageCount`** per turn (not raw base64) | `services/leadWebhook.ts` |

## Environment (optional, safe)

```env
# Shown only for future Login/SDK demos — not secret.
# VITE_META_APP_ID=

# off | log (default log in dev only): mirrorOutboundToMessengerOutbox
# VITE_MESSENGER_OUTBOX_MODE=log
```

## Next engineering step (when you open Meta Developer Console)

1. Follow **[facebook-messenger-marketplace-setup.md](./facebook-messenger-marketplace-setup.md)** — this repo already exposes **`/webhook`** on the same Railway URL as the site (`server/index.mjs`).  
2. Map **PSID** (sender id) ↔ your `conversationId` / CRM row in that backend when you extend `handleWebhook`.  
3. Reuse the same **structured message** you build today (text + image URLs from your CDN/inventory).

Until Meta is wired, the **web demo** remains the main channel; `services/meta/outbox.ts` is only a client-side dry-run helper.
