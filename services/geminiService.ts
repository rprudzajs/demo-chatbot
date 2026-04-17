import { createPartFromBase64, createPartFromText, GoogleGenAI, Chat } from "@google/genai";
import type { Part } from "@google/genai";
import { getSystemInstruction, Language } from "../constants";

/** Same env as typical Gemini / AI Studio apps: `GEMINI_API_KEY`; optional `VITE_GEMINI_API_KEY` override. */
const getApiKey = () => {
  const a = String(import.meta.env.GEMINI_API_KEY ?? "").trim();
  const b = String(import.meta.env.VITE_GEMINI_API_KEY ?? "").trim();
  return a || b;
};

export const isGeminiConfigured = () => Boolean(getApiKey());

const getAIClient = () => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return new GoogleGenAI({ apiKey });
};

export const createCarChat = (language: Language): Chat => {
  const ai = getAIClient();
  return ai.chats.create({
    model: "gemini-3-flash-preview",
    config: {
      systemInstruction: getSystemInstruction(language),
      temperature: 0.7,
      topP: 0.95,
      topK: 64,
    },
  });
};

/** Multimodal user turns (Messenger-style photos). */
export function buildGeminiUserParts(
  text: string,
  images: { mimeType: string; base64: string }[],
): Part[] {
  const parts: Part[] = [];
  const t = text.trim();
  if (t) parts.push(createPartFromText(t));
  for (const im of images) {
    if (im.base64 && im.mimeType) {
      parts.push(createPartFromBase64(im.base64, im.mimeType));
    }
  }
  if (parts.length === 0) {
    parts.push(
      createPartFromText(
        '(El usuario envió solo una imagen; describe lo relevante para compra de auto o pide una foto más clara del vehículo o papeles.)',
      ),
    );
  }
  return parts;
}
