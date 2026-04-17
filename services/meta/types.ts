/**
 * Shapes aligned with Meta “Send API” (Messenger / Page) for when the backend is wired.
 * @see https://developers.facebook.com/docs/messenger-platform/reference/send-api
 *
 * — Page access tokens must stay on a server; never expose in Vite bundles.
 * — `attachment.type: image` with `payload.url` needs a **public HTTPS** URL (host the file or use Graph `upload` flow).
 */

export type MetaMessengerAttachment =
  | {
      type: 'image';
      payload: { url: string; is_reusable?: boolean };
    }
  | {
      type: 'template';
      payload: Record<string, unknown>;
    };

export type MetaSendMessagePayload = {
  recipient: { id: string };
  messaging_type: 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG';
  message: {
    text?: string;
    attachment?: MetaMessengerAttachment;
  };
};

export type MetaWebhookMessagingEvent = {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid?: string;
    text?: string;
    attachments?: Array<{ type: string; payload?: { url?: string } }>;
  };
};
