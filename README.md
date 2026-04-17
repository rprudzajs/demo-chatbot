<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1IfB7dh6_m4RVzV8q7Fe4r0QsWGkR1HrE

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Create [.env.local](.env.local) with `GEMINI_API_KEY=your_key` (same as other Gemini / AI Studio chatbots). Optional: `VITE_GEMINI_API_KEY` also works.
3. Run the app:
   `npm run dev`

## Production preview (local)

```bash
npm run build && npx vite preview --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/`.

## Deploy (persistent URL)

From the repo root (after `npm install`):

1. [Vercel](https://vercel.com): `npx vercel` — link the project, accept defaults for Vite (build: `npm run build`, output: `dist`). Set **`GEMINI_API_KEY`** (or `VITE_GEMINI_API_KEY`) in **Environment Variables** for Production/Preview, then **redeploy** — values are baked in at **build time**.
2. [Netlify](https://netlify.com): Same: `npm run build`, publish `dist`, set `GEMINI_API_KEY` in Environment variables, then trigger a new build.
3. **Railway** (see [`railway.toml`](railway.toml)):
   - **New Project** → **Deploy from GitHub** → select this repo.
   - **Variables** (required for the app to work; set **before** the first successful build, or redeploy after adding them):
     - `GEMINI_API_KEY` — your Gemini key (baked in at **build** time).
     - Optional: `VITE_LEADS_WEBHOOK_URL` — full Google Apps Script web app URL (`https://script.google.com/macros/s/.../exec`) for the CRM sheet.
     - Optional — **Meta webhooks** (not `VITE_*`): `META_WEBHOOK_VERIFY_TOKEN` (or `MESSENGER_VERIFY_TOKEN`), `MESSENGER_PAGE_ACCESS_TOKEN`, `META_APP_SECRET`, `MESSENGER_AUTO_REPLY`; for **WhatsApp Cloud API** also `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_AUTO_REPLY`. See [`docs/facebook-messenger-marketplace-setup.md`](docs/facebook-messenger-marketplace-setup.md) and [`docs/whatsapp-cloud-api-setup.md`](docs/whatsapp-cloud-api-setup.md).
   - Railway runs `npm run build` then `npm start` (`node server/index.mjs`: static `dist/` + `GET|POST /webhook`).
   - Open the generated public URL from the service.

A full-page screenshot of the ALD-style clone (Spanish stock view) is saved at `public/screenshots/ald-clone-demo-fullpage.png` for quick reference.

## Vehicle photos (local files, no hotlinking)

Stock thumbnails can be mirrored from the dealer CDN into `public/inventory/` so production serves them from your own domain. Run **`npm run mirror:inventory-images`** once on a machine with normal internet (see [`docs/inventory-images.md`](docs/inventory-images.md)), then commit the images and updated `data/ald-stock-base.json`.

## Scrape ald.cl (local + VPN)

Playwright crawler + merge to one markdown file: see [`data/scraped/README.md`](data/scraped/README.md). Commands: `npm run scrape:ald`, then `npm run scrape:ald:merge`. Requires `npx playwright install chromium` once.
