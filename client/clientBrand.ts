/**
 * ALD Autos — visual tokens from https://www.ald.cl/stock (dark shell, red mark, white cards).
 */
export const CLIENT_BRAND = {
  displayName: 'ALD Autos',
  tagline: 'Seminuevos · Lo Barnechea',
  /** Primary actions + price accent (ALD red) */
  primaryHex: '#E30613',
  /** Logo / active nav highlight */
  accentRedHex: '#E30613',
  /** Top bar behind wordmark */
  inkHex: '#0a0a0a',
  /** Page background */
  pageDarkHex: '#2d2d2d',
  /** Filter panel */
  panelHex: '#3a3a3a',
  /** Messenger-style blue kept for chat bubbles contrast optional — using red for brand unity */
  secondaryHex: '#E30613',
  pageBackgroundHex: '#2d2d2d',
  fontStack: "'Inter', sans-serif",
  logoUrl: null as string | null,
  websiteUrl: 'https://www.ald.cl' as string | null,
  /** WhatsApp CTA (public number from site) */
  whatsappE164: '56974596700',
};
