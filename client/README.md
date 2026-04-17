# Client demo — brand & website knowledge

Use this folder to **white-label** the meeting demo without scattering strings across the repo.

| File | Purpose |
|------|---------|
| `clientBrand.ts` | Company name, colors, fonts, logo URL (from their site). |
| `clientKnowledge.ts` | **Facts copied from their website** — injected into the AI system prompt so answers match their real business. |

After you paste content into `clientKnowledge.ts` and set `clientBrand.ts`, rebuild/restart the dev server so the bot uses the new context.

**Screenshots:** see `DEMO_SITE_CLONE.md` in the project root. Reference PNGs from the client may live in **`public/demo-reference/`** for UI tuning.
