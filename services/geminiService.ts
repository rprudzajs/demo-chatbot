
import { GoogleGenAI, Chat } from "@google/genai";
import { getSystemInstruction, Language } from "../constants";

const getApiKey = () => {
  return (
    import.meta.env.VITE_GEMINI_API_KEY ||
    import.meta.env.GEMINI_API_KEY ||
    ""
  );
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
