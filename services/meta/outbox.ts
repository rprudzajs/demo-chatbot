import type { MetaSendMessagePayload } from './types';

export type MessengerOutboxMode = 'off' | 'log';

/** Public app id is ok in the client (Login / SDK). Page token is never set here. */
export function getMessengerOutboxMode(): MessengerOutboxMode {
  const v = String(import.meta.env.VITE_MESSENGER_OUTBOX_MODE ?? 'log')
    .trim()
    .toLowerCase();
  return v === 'off' ? 'off' : 'log';
}

export function getMetaAppIdForDisplay(): string {
  return String(import.meta.env.VITE_META_APP_ID ?? '').trim();
}

/**
 * Dry-run bridge: when Meta is connected, the same object can be POSTed from a server with the page token.
 * Today: optional console structured log for demos (toggle with VITE_MESSENGER_OUTBOX_MODE=off).
 */
export function mirrorOutgoingToMessengerOutbox(sample: {
  /** PSID absent until the real channel exists */
  recipientPsid?: string;
  text?: string;
  graphPayload?: MetaSendMessagePayload;
  attachmentPreviewUrls?: string[];
}): void {
  if (getMessengerOutboxMode() === 'off') return;
  if (import.meta.env.DEV) {
    console.info('[meta-messenger outbox / dry-run]', sample);
  }
}
