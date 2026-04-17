# Demo prep — clone look & feed from the client website

Goal: **founder-ready demo** — UI feels like their brand, chatbot answers align with **real** services, hours, and area (no invented facts).

---

## 1. What to send (screenshots)

Capture **their live site** (desktop + mobile if it differs):

| # | What | Why |
|---|------|-----|
| 1 | **Home above the fold** (hero, nav, logo) | Logo, colors, typography, nav labels |
| 2 | **Full header + nav** (one wide screenshot) | Menu structure, CTA buttons |
| 3 | **Inventory / listings** (grid or list row) | Card layout, price style, badges |
| 4 | **Footer** (contact, hours, links) | Phone, address, social, legal name |
| 5 | **“About” or “Sell your car”** (if separate) | Services copy for `clientKnowledge.ts` |
| 6 | **Contact page** | Confirmed phone, WhatsApp, form fields |

Optional but valuable: **PDF or export** of text from key pages (or paste copy into a doc).

---

## 2. Client site: **ald.cl** & VPN

- **URL:** [https://www.ald.cl/stock](https://www.ald.cl/stock) (stock list).
- **VPN:** The live site may only load on **your VPN + Brave** (or similar). That does not block the demo: this repo uses **cached / indexed** copy in `client/clientKnowledge.ts` and sample stock in `constants.ts` (`MOCK_CARS`). Before the founder meeting, **open the site on VPN once** and confirm phones, hours, and a few prices still match; update those files if anything changed.

---

## 3. Optional: public URL

Use **https://www.ald.cl** as the canonical site. If the client gives a staging URL later, update `client/clientBrand.ts` and the knowledge file.

---

## 4. Reference screenshots (in repo)

Original captures from `ald.cl/stock` are copied to **`public/demo-reference/`** for side-by-side comparison while tuning the demo UI.

---

## 5. Where it goes in this repo

| Your input | Repo location |
|------------|----------------|
| Colors, logo link, display name | `client/clientBrand.ts` |
| Services, hours, area, phones, policies (from site) | `client/clientKnowledge.ts` → **feeds the AI** |
| Hero / layout / fonts | `index.html` + `App.tsx` / `Header.tsx` / `components/*` (after screenshot review) |
| Sample cars in the grid | `constants.ts` → `MOCK_CARS` (optional: match their real stock style) |

---

## 6. Meeting checklist

- [ ] `GEMINI_API_KEY` set for the machine you’ll present from (or hosted build env).
- [ ] `client/clientKnowledge.ts` filled from **only** website + confirmed notes.
- [ ] `client/clientBrand.ts` matches logo/name/colors.
- [ ] Quick run-through: open site + your demo side-by-side; 3–5 test questions (price, financing, visit, sell my car).
- [ ] Fallback line ready if API fails: *“Live AI is a demo layer; production ties to your CRM and scripts you approve.”*

---

## 7. Principles

- **Do not invent** inventory, prices, or legal promises — the model follows `clientKnowledge.ts` + `MOCK_CARS`.
- **Cloning** is **inspired-by** for the demo (fonts, colors, layout), not pixel-perfect trademark copying unless they own the assets and ask for it.
- Keep **CRM story** separate: this doc is UX + knowledge; see `MVP-MESSENGER-CRM-ANALYSIS.md` for integration scope.

---

*Update this file as the client shares more assets.*
