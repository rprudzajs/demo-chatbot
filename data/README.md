# Stock data for the demo

## `ald-stock-base.json`

**Real-shaped rows** taken from public/indexed listings on [ald.cl/stock](https://www.ald.cl/stock) (and your screenshots). Update this file when you refresh from the live site (VPN) or when the client sends an export.

Each object matches the `Car` type in `types.ts`. Optional fields: `listHeadline`, `listSubtitle`, `justArrived`, `transmissionShort`, `fuelBadge`, `isDemoFiller`.

## Pad to ~95 (or any count)

`demoStock.ts` → `buildDemoStock(base, targetTotal)` appends **synthetic** units so pagination matches the “90+ en venta” feel. Those rows set `isDemoFiller: true` and a clear description.

- **Target count:** set `VITE_DEMO_STOCK_COUNT` (default **95** in code). Use `6` to show only the real JSON rows.

## Adding many cars without hand-editing JSON

1. Export a CSV/Excel from the client or scrape (with permission).
2. Map columns → JSON objects (small script or paste into a converter).
3. Replace or merge into `ald-stock-base.json`.
4. Set `VITE_DEMO_STOCK_COUNT` to the real length and **remove** padding by setting count ≤ base length, or delete filler logic for production.

## Full-site text (RAG / knowledge refresh)

See **`scraped/README.md`**: Playwright scripts `npm run scrape:ald` and `npm run scrape:ald:merge` (run **locally with VPN** if ald.cl blocks your region). Output is gitignored by default; use the merged `corpus.md` to update `clientKnowledge.ts` or a future vector index.
