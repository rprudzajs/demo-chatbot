export type CarCurrency = 'CLP' | 'USD';

export interface Car {
  id: string;
  make: string;
  model: string;
  year: number;
  /** Integer amount in the given currency (e.g. CLP without decimals). */
  price: number;
  currency?: CarCurrency;
  mileage: number;
  fuelType: string;
  transmission: string;
  color: string;
  description: string;
  imageUrl: string;
  features: string[];
  /** Uppercase line above image (e.g. único dueño) — ald.cl card style */
  listHeadline?: string;
  /** Secondary uppercase line under model name */
  listSubtitle?: string;
  justArrived?: boolean;
  transmissionShort?: 'AT' | 'MT';
  /** Short badge on photo corner, e.g. DIESEL, HÍBRIDO */
  fuelBadge?: string;
  /** True when row is synthetic padding for UI demo only */
  isDemoFiller?: boolean;
}

/** In-chat media (Messenger-style). `url` is usually a `data:` URL from the picker; public HTTPS URLs work for Meta “attachment.url”. */
export interface MessageAttachment {
  type: 'image';
  url: string;
  /** Optional caption / alt for logs */
  alt?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
  /** Inline images shown under the bubble (web demo + future Meta parity). */
  attachments?: MessageAttachment[];
  /** Cars inferred from assistant text (e.g. ald.cl/ficha/<id>) for rich in-chat previews. */
  recommendedCars?: Car[];
}
