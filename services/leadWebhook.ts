import type { Car } from '../types';
import type { Message } from '../types';

const webhookUrl = () =>
  String(import.meta.env.VITE_LEADS_WEBHOOK_URL ?? '').trim();

export type ContactSignals = {
  email: string | null;
  phone: string | null;
  hasContact: boolean;
};

/** Chile-style mobile + email */
export function extractContactSignals(text: string): ContactSignals {
  const t = text.trim();
  const email = t.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  const phone =
    t.match(/\+?56\s*9\s*\d{4}\s*-?\s*\d{4}/)?.[0] ??
    t.match(/\b9\s*\d{4}\s*\d{4}\b/)?.[0] ??
    t.match(/\b9\d{8}\b/)?.[0] ??
    t.match(/\+\d{8,12}\b/)?.[0] ??
    null;
  return { email, phone, hasContact: Boolean(email || phone) };
}

export function extractBestContactFromMessages(messages: Message[]): ContactSignals {
  let email: string | null = null;
  let phone: string | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const s = extractContactSignals(m.text);
    if (s.email && !email) email = s.email;
    if (s.phone && !phone) phone = s.phone;
    if (email && phone) break;
  }
  return { email, phone, hasContact: Boolean(email || phone) };
}

export function buildContactKey(signals: Pick<ContactSignals, 'email' | 'phone'>): string | null {
  if (signals.email) return `email:${signals.email.trim().toLowerCase()}`;
  if (signals.phone) {
    const digits = signals.phone.replace(/\D/g, '');
    if (digits.length >= 8) return `phone:${digits}`;
  }
  return null;
}

/** Extract name from "me llamo X" / "soy X" / "mi nombre es X" */
function extractNameFromMessages(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const match = m.text.match(/(?:me llamo|soy|mi nombre es)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/i);
    if (match) return match[1];
  }
  return null;
}

/** Detect broad interest categories from all user messages */
function detectInterestFromMessages(messages: Message[]): string[] {
  const categories = ['suv', 'sedan', 'sedán', 'pickup', 'camioneta', 'eléctrico', 'electrico', 'hatchback', 'coupe', 'coupé'];
  const found = new Set<string>();
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const lower = m.text.toLowerCase();
    categories.forEach(c => { if (lower.includes(c)) found.add(c); });
  }
  return [...found];
}

export type LeadPayload = {
  source: 'web_chat';
  language: 'es';
  conversationId: string;
  contactKey: string | null;
  lastUserMessage: string;
  email: string | null;
  phone: string | null;
  vehicle?: { id: string; make: string; model: string; year: number } | null;
  transcript: TranscriptTurn[];
  sentAt: string;
};

export type TranscriptTurn = {
  role: string;
  text: string;
  imageCount?: number;
};

/**
 * POST to VITE_LEADS_WEBHOOK_URL in the same shape as the Messenger bot,
 * so the Apps Script upserts correctly using conversationId as the key.
 */
export async function submitLead(payload: LeadPayload): Promise<boolean> {
  const url = webhookUrl();
  if (!url) return false;
  try {
    const isGoogleAppsScript = /script\.google\.com\/macros\/s\//i.test(url);

    // Extract cars mentioned by the bot (scan ficha URLs in model turns)
    const fichaIds = new Set<string>();
    for (const t of (payload.transcript ?? [])) {
      if (t.role !== 'model') continue;
      const re = /ald\.cl\/ficha\/(\d+)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(t.text)) !== null) fichaIds.add(m[1]);
    }
    const carsDetectedStr = fichaIds.size > 0
      ? [...fichaIds].map(id => `ald.cl/ficha/${id}`).join(' | ')
      : null;

    const msgObjects = (payload.transcript ?? []).map(t => ({ role: t.role, text: t.text, id: '', timestamp: new Date() }));
    const interestStr = detectInterestFromMessages(msgObjects).join(', ') || null;
    const extractedName = extractNameFromMessages(msgObjects);

    // Build the unified shape the Apps Script expects
    // carsDetectedStr and interestStr are pre-formatted strings — Apps Script writes them directly
    const unified = {
      source: 'web_chat',
      upsertKey: payload.conversationId,
      psid: payload.conversationId,
      event: payload.contactKey ? 'contact_shared' : (carsDetectedStr ? 'car_detected' : 'first_contact'),
      sentAt: payload.sentAt,
      fbName: null,
      fbFirstName: null,
      fbLastName: null,
      extractedName,
      phone: payload.phone,
      email: payload.email,
      marketplaceCar: payload.vehicle ? `${payload.vehicle.year} ${payload.vehicle.make} ${payload.vehicle.model}` : null,
      carsDetectedStr,   // pre-formatted string, Apps Script merges directly
      interestStr,       // pre-formatted string, Apps Script merges directly
      lastMessage: payload.lastUserMessage,
      lastBotReply: [...(payload.transcript ?? [])].reverse().find(t => t.role === 'model')?.text?.slice(0, 500) ?? null,
    };

    const res = await fetch(url, {
      method: 'POST',
      mode: isGoogleAppsScript ? 'no-cors' : 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(unified),
    });
    return isGoogleAppsScript ? true : res.ok;
  } catch {
    return false;
  }
}

export function buildTranscriptSnapshot(messages: Message[], maxMessages = 14): TranscriptTurn[] {
  return messages.slice(-maxMessages).map((m) => {
    const row: TranscriptTurn = { role: m.role, text: m.text.slice(0, 2000) };
    const n = m.attachments?.filter((a) => a.type === 'image').length ?? 0;
    if (n > 0) row.imageCount = n;
    return row;
  });
}

export function vehicleFromCar(car: Car | null | undefined) {
  if (!car) return null;
  return { id: car.id, make: car.make, model: car.model, year: car.year };
}
