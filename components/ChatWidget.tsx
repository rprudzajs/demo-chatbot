
import React, { useState, useRef, useEffect } from 'react';
import { Message, Car } from '../types';
import {
  buildGeminiUserParts,
  createCarChat,
  isGeminiConfigured,
} from '../services/geminiService';
import { mirrorOutgoingToMessengerOutbox } from '../services/meta/outbox';
import {
  buildContactKey,
  buildTranscriptSnapshot,
  extractBestContactFromMessages,
  submitLead,
  vehicleFromCar,
} from '../services/leadWebhook';
import { MOCK_CARS } from '../constants';
import { CLIENT_BRAND } from '../client/clientBrand';
import { Chat, GenerateContentResponse } from '@google/genai';

const CHAT_STRINGS_ES = {
  welcome:
    '¡Hola! 👋 Bienvenido a ALD Autos. ¿En qué te puedo ayudar hoy?',
  suggestions: [
    'Ver stock / qué me sirve por presupuesto',
    'Financiamiento y pie',
    'Agendar visita o prueba de manejo',
    'Permuta / compran mi auto',
    'Hablar con una persona',
  ],
  activeNow: 'Activo ahora',
  profile: 'Ver perfil',
  expertLabel: 'Marketplace Automotive Expert',
  suggestedActions: 'Acciones sugeridas',
  placeholder: 'Escribe un mensaje o adjunta una foto',
  attachImage: 'Adjuntar imagen',
  missingKey:
    'Gemini no está configurado: falta GEMINI_API_KEY (la misma que en otros demos de Gemini). Local: .env.local y reinicia npm run dev. En Railway/Vercel/Netlify: define GEMINI_API_KEY en el entorno de build y vuelve a compilar.',
  initFailed: 'No puedo conectar con Gemini ahora. Intenta de nuevo en unos minutos.',
  retry: 'Lo siento, ¿podrías repetir eso?',
  initialQuery: (car: Car) => `¿Sigue disponible el ${car.make} ${car.model}?`,
  openChatFab: 'Abrir chat de ventas',
};

interface ChatWidgetProps {
  initialCar?: Car | null;
  /** Parent increments this (e.g. “Chatear” on the cloned page) to open the panel. */
  openTrigger?: number;
}

const LEAD_CONVERSATION_STORAGE_KEY = 'ald_autos_lead_conversation_id';
const MAX_CHAT_IMAGES = 3;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

type StagedImage = {
  id: string;
  dataUrl: string;
  mimeType: string;
  base64: string;
};

function readFileAsImage(file: File): Promise<StagedImage | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const comma = dataUrl.indexOf(',');
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
      resolve({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        dataUrl,
        mimeType: file.type || 'image/jpeg',
        base64,
      });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function getOrCreateConversationId(): string {
  try {
    if (typeof sessionStorage === 'undefined') {
      return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    }
    let id = sessionStorage.getItem(LEAD_CONVERSATION_STORAGE_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      sessionStorage.setItem(LEAD_CONVERSATION_STORAGE_KEY, id);
    }
    return id;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}

const ChatWidget: React.FC<ChatWidgetProps> = ({ initialCar, openTrigger = 0 }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [input, setInput] = useState('');
  const chatStrings = CHAT_STRINGS_ES;

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'model',
      text: chatStrings.welcome,
      timestamp: new Date()
    }
  ]);
  const [suggestions, setSuggestions] = useState<string[]>(chatStrings.suggestions);
  const [isTyping, setIsTyping] = useState(false);
  const [chatSession, setChatSession] = useState<Chat | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastLeadKeyRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string>(getOrCreateConversationId());
  const messagesRef = useRef<Message[]>(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const resolveCardImageUrl = (rawUrl: string) => {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.hostname.toLowerCase().includes('rtautomotriz.com')) {
        const originAndPath = `${parsed.hostname}${parsed.pathname}${parsed.search}`;
        return `https://images.weserv.nl/?url=${encodeURIComponent(originAndPath)}`;
      }
    } catch {
      // Keep original value when URL parsing fails.
    }
    return rawUrl;
  };

  const parseRecommendedCars = (text: string): Car[] => {
    const normalize = (v: string) =>
      v
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const ids = new Set<string>();
    const urlRegex = /https?:\/\/(?:www\.)?ald\.cl\/ficha\/(\d+)\/?/gi;
    let match: RegExpExecArray | null;
    while ((match = urlRegex.exec(text)) !== null) {
      ids.add(match[1]);
    }
    const fromUrls = [...ids]
      .map((numericId) => MOCK_CARS.find((car) => car.id === `ald-${numericId}`))
      .filter((car): car is Car => Boolean(car))
      .slice(0, 3);
    if (fromUrls.length > 0) return fromUrls;

    const nText = normalize(text);
    const scored = MOCK_CARS
      .filter((car) => !car.isDemoFiller)
      .map((car) => {
        const make = normalize(car.make);
        const model = normalize(car.model);
        const modelTokens = model.split(' ').filter((t) => t.length >= 3);
        const year = String(car.year);
        const priceCompact = String(car.price);
        const priceWithDots = car.price.toLocaleString('es-CL');

        let score = 0;
        if (nText.includes(`${make} ${model}`)) score += 6;
        if (nText.includes(make)) score += 2;
        if (nText.includes(model)) score += 3;
        if (nText.includes(year)) score += 1;
        if (nText.includes(priceCompact) || nText.includes(priceWithDots.replace(/\./g, ' '))) score += 1;
        score += modelTokens.filter((t) => nText.includes(t)).slice(0, 3).length;

        return { car, score };
      })
      .filter((x) => x.score >= 4)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.car);

    return scored;
  };

  const formatCardPrice = (car: Car) => {
    if ((car.currency ?? 'USD') === 'CLP') {
      return new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        maximumFractionDigits: 0,
      }).format(car.price);
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(car.price);
  };

  const captureChatEventToCrm = (latestText: string, historyWithLatest: Message[]) => {
    const fromHistory = extractBestContactFromMessages(historyWithLatest);
    const contactKey = buildContactKey(fromHistory);
    const key = `${conversationIdRef.current}|${latestText.slice(0, 160)}|${historyWithLatest.length}`;
    if (lastLeadKeyRef.current === key) return;
    lastLeadKeyRef.current = key;
    void submitLead({
      source: 'web_chat',
      language: 'es',
      conversationId: conversationIdRef.current,
      contactKey,
      lastUserMessage: latestText,
      email: fromHistory.email,
      phone: fromHistory.phone,
      vehicle: vehicleFromCar(initialCar ?? undefined),
      transcript: buildTranscriptSnapshot(historyWithLatest),
      sentAt: new Date().toISOString(),
    });
  };

  useEffect(() => {
    if (openTrigger > 0) setIsOpen(true);
  }, [openTrigger]);

  useEffect(() => {
    setMessages([{
      id: 'welcome',
      role: 'model',
      text: CHAT_STRINGS_ES.welcome,
      timestamp: new Date()
    }]);
    setSuggestions(CHAT_STRINGS_ES.suggestions);
    setInput('');

    if (!isGeminiConfigured()) {
      setChatSession(null);
      setInitError('missing_key');
      return;
    }

    try {
      const session = createCarChat('es');
      setChatSession(session);
      setInitError(null);
    } catch (error) {
      console.error("Failed to initialize chat session", error);
      setChatSession(null);
      setInitError('init_failed');
    }
  }, []);

  useEffect(() => {
    if (initialCar) {
      setIsOpen(true);
      const initialQuery = CHAT_STRINGS_ES.initialQuery(initialCar);
      handleSendMessage(initialQuery);
    }
  }, [initialCar]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const parseContent = (text: string) => {
    const suggestionRegex = /\[SUGGESTIONS:\s*(.*?)\]/gi;
    let labels: string[] = [];
    let cleanedText = text;

    let match;
    while ((match = suggestionRegex.exec(text)) !== null) {
      const items = match[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(s => s.length > 0);
      labels = [...labels, ...items];
    }
    
    cleanedText = cleanedText.replace(/\[SUGGESTIONS:\s*.*?\]/gi, '');
    cleanedText = cleanedText.replace(/Sugerencias:(\s*-\s*".*?")*/gi, '');
    cleanedText = cleanedText.replace(/Suggestions:(\s*-\s*".*?")*/gi, '');
    
    return { cleanedText: cleanedText.trim(), labels };
  };

  const formatAssistantText = (text: string) => {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return '';

    let parts = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
    const questions = parts.filter(part => part.includes('?'));
    const nonQuestions = parts.filter(part => !part.includes('?'));
    parts = [...nonQuestions, ...questions];

    if (parts.length === 1 && parts[0].length > 140) {
      const splitIndex = parts[0].search(/,\s+/);
      if (splitIndex > 0) {
        parts = [
          parts[0].slice(0, splitIndex + 1).trim(),
          parts[0].slice(splitIndex + 1).trim()
        ];
      }
    }

    return parts.join('\n\n');
  };

  const handlePickImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const { files } = e.target;
    if (!files?.length) return;
    const picked: StagedImage[] = [...stagedImages];
    for (let i = 0; i < files.length && picked.length < MAX_CHAT_IMAGES; i++) {
      const f = files[i];
      if (f.size > MAX_IMAGE_BYTES) continue;
      const row = await readFileAsImage(f);
      if (row) picked.push(row);
    }
    setStagedImages(picked);
    e.target.value = '';
  };

  const handleSendMessage = async (customText?: string) => {
    const textRaw = customText !== undefined ? customText : input;
    const textToSend = textRaw.trim();
    const images = [...stagedImages];
    if (!textToSend && images.length === 0) return;

    if (!customText) setInput('');
    setStagedImages([]);
    setSuggestions([]);

    const displayText =
      textToSend ||
      (images.length ? `📷 ${images.length} foto${images.length > 1 ? 's' : ''}` : '');
    const newUserMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: displayText,
      timestamp: new Date(),
      attachments:
        images.length > 0
          ? images.map((im) => ({
              type: 'image' as const,
              url: im.dataUrl,
              alt: 'Adjunto',
            }))
          : undefined,
    };

    const historyWithLatest = [...messagesRef.current, newUserMsg];
    setMessages(prev => [...prev, newUserMsg]);
    const crmLine =
      textToSend ||
      (images.length ? `[${images.length} imagen(es) adjunta(s)]` : displayText);
    mirrorOutgoingToMessengerOutbox({
      text: crmLine,
      attachmentPreviewUrls: images.map(() => '[local image]'),
    });
    setIsTyping(true);

    if (!chatSession) {
      setIsTyping(false);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'model',
        text: formatAssistantText(initError === 'missing_key'
          ? chatStrings.missingKey
          : chatStrings.initFailed),
        timestamp: new Date()
      }]);
      return;
    }

    try {
      const geminiParts = buildGeminiUserParts(
        textToSend,
        images.map((im) => ({ mimeType: im.mimeType, base64: im.base64 })),
      );
      const result = await chatSession.sendMessageStream({ message: geminiParts });
      
      let fullText = '';
      const botMsgId = (Date.now() + 1).toString();
      
      setMessages(prev => [...prev, {
        id: botMsgId,
        role: 'model',
        text: '',
        timestamp: new Date()
      }]);

      for await (const chunk of result) {
        const c = chunk as GenerateContentResponse;
        fullText += c.text || '';
        
        const { cleanedText } = parseContent(fullText);
        setMessages(prev => prev.map(msg => 
          msg.id === botMsgId ? { ...msg, text: formatAssistantText(cleanedText) } : msg
        ));
      }

      const { labels } = parseContent(fullText);
      if (labels.length > 0) {
        setSuggestions(labels);
      }
      const { cleanedText } = parseContent(fullText);
      const recommendedCars = parseRecommendedCars(cleanedText);
      if (recommendedCars.length > 0) {
        setMessages(prev => prev.map(msg =>
          msg.id === botMsgId ? { ...msg, recommendedCars } : msg
        ));
      }

      // Fire CRM after bot reply so ficha URLs are in the transcript
      const botMsg: Message = { id: botMsgId, role: 'model', text: cleanedText, timestamp: new Date(), recommendedCars: recommendedCars.length > 0 ? recommendedCars : undefined };
      captureChatEventToCrm(crmLine, [...historyWithLatest, botMsg]);
    } catch (error) {
      console.error("Error sending message", error);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'model',
        text: chatStrings.retry,
        timestamp: new Date()
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  const toggleExpand = () => setIsExpanded(!isExpanded);

  return (
    <div className="fixed z-50 bottom-0 right-3 sm:right-4 flex flex-col items-end transition-all duration-300 ease-in-out pointer-events-none">
      <div className="pointer-events-auto flex flex-col items-end gap-0 w-full max-w-[100vw]">
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="text-white w-14 h-14 rounded-full shadow-lg hover:brightness-110 flex items-center justify-center transition-all mb-4"
          style={{ backgroundColor: CLIENT_BRAND.primaryHex }}
          aria-label={chatStrings.openChatFab}
        >
          <i className="fab fa-facebook-messenger text-2xl" aria-hidden />
        </button>
      )}

      {isOpen && (
        <div
          className={`bg-white shadow-2xl flex flex-col border border-gray-300 overflow-hidden animate-in slide-in-from-bottom-2 duration-200 transition-all ${
          isExpanded
            ? 'w-[min(100vw-1.5rem,900px)] h-[min(85vh,820px)] rounded-2xl'
            : 'w-[330px] sm:w-[380px] h-[520px] rounded-t-xl'
        }`}
        >
          {/* Messenger Header */}
          <div className="bg-white border-b border-gray-200 p-2.5 flex justify-between items-center shadow-sm shrink-0">
            <div className="flex items-center gap-2">
              <div className="relative">
                <img src="https://picsum.photos/seed/expert/50/50" className="w-8 h-8 rounded-full" alt="Agent" referrerPolicy="no-referrer" />
                <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white rounded-full"></div>
              </div>
              <div>
                <h4 className="font-bold text-[15px] text-gray-900 leading-tight">{CLIENT_BRAND.displayName}</h4>
                <p className="text-[11px] text-gray-500 font-normal">
                  {chatStrings.activeNow}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3" style={{ color: CLIENT_BRAND.primaryHex }}>
              <button
                onClick={toggleExpand}
                className="hover:bg-gray-100 p-1.5 rounded-full text-gray-500 transition-colors hidden sm:block"
                title={isExpanded ? 'Contraer chat' : 'Expandir chat'}
                aria-label={isExpanded ? 'Contraer chat' : 'Expandir chat'}
              >
                <i className={`fas ${isExpanded ? 'fa-compress-alt' : 'fa-expand-alt'} text-sm`}></i>
              </button>
              <i className="fas fa-phone-alt cursor-pointer hover:bg-gray-100 p-1.5 rounded-full text-sm"></i>
              <i className="fas fa-video cursor-pointer hover:bg-gray-100 p-1.5 rounded-full text-sm"></i>
              <i 
                className="fas fa-times cursor-pointer hover:bg-gray-100 p-1.5 rounded-full text-gray-400 text-lg"
                onClick={() => { setIsOpen(false); setIsExpanded(false); }}
              ></i>
            </div>
          </div>
          {initError && (
            <div className={`px-3 py-2 text-[12px] border-b ${
              initError === 'missing_key'
                ? 'bg-amber-50 text-amber-800 border-amber-200'
                : 'bg-red-50 text-red-700 border-red-200'
            }`}>
              {initError === 'missing_key'
                ? chatStrings.missingKey
                : chatStrings.initFailed}
            </div>
          )}

          {/* Messages Area */}
          <div className="flex-grow overflow-y-auto p-3 sm:p-6 space-y-4 bg-white">
            <div className="flex flex-col items-center py-6 mb-4">
              <img src="https://picsum.photos/seed/expert/150/150" className="w-20 h-20 rounded-full mb-2 border border-gray-200" alt="Avatar Huge" referrerPolicy="no-referrer" />
              <h5 className="font-bold text-lg">{CLIENT_BRAND.displayName}</h5>
              <p className="text-gray-500 text-sm">
                {CLIENT_BRAND.tagline || chatStrings.expertLabel}
              </p>
              <button className="mt-3 text-xs font-bold bg-gray-100 px-4 py-1.5 rounded-lg hover:bg-gray-200 transition-colors">
                {chatStrings.profile}
              </button>
            </div>

            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start items-end'}`}>
                {msg.role === 'model' && (
                   <img src="https://picsum.photos/seed/expert/50/50" className="w-7 h-7 rounded-full mr-2 mb-1" alt="Avatar" referrerPolicy="no-referrer" />
                )}
                <div className="max-w-[80%]">
                  <div
                    className={`p-2.5 rounded-2xl text-[14px] shadow-sm ${
                      msg.role === 'user' ? 'text-white' : 'bg-[#F0F2F5] text-black'
                    }`}
                    style={msg.role === 'user' ? { backgroundColor: CLIENT_BRAND.primaryHex } : undefined}
                  >
                    <p className="leading-snug whitespace-pre-line">{msg.text}</p>
                  </div>
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div
                      className={`mt-1 flex flex-col gap-1.5 ${
                        msg.role === 'user' ? 'items-end' : 'items-start'
                      }`}
                    >
                      {msg.attachments.map((a, idx) => (
                        <img
                          key={`${msg.id}-a${idx}`}
                          src={resolveCardImageUrl(a.url)}
                          alt={a.alt ?? 'Adjunto'}
                          className="max-w-[220px] max-h-44 rounded-xl border border-gray-200 object-cover shadow-sm"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ))}
                    </div>
                  )}
                  {msg.role === 'model' && msg.recommendedCars && msg.recommendedCars.length > 0 && (
                    <div className="mt-2 grid gap-2">
                      {msg.recommendedCars.map((car) => (
                        <button
                          key={`${msg.id}-${car.id}`}
                          type="button"
                          onClick={() => handleSendMessage(`Me interesa este auto: ${car.year} ${car.make} ${car.model} (${car.id}).`)}
                          className="text-left rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm hover:shadow transition-shadow"
                        >
                          <div className="flex">
                            <img
                              src={resolveCardImageUrl(car.imageUrl)}
                              alt={`${car.year} ${car.make} ${car.model}`}
                              className="w-24 h-20 object-cover shrink-0"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                            <div className="p-2 min-w-0">
                              <p className="text-[11px] font-bold text-gray-900 truncate">
                                {car.year} {car.make} {car.model}
                              </p>
                              <p className="text-[11px] font-black mt-0.5" style={{ color: CLIENT_BRAND.accentRedHex }}>
                                {formatCardPrice(car)}
                              </p>
                              <p className="text-[10px] text-gray-500 truncate">
                                {car.mileage.toLocaleString('es-CL')} km · {car.transmission}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            
            {/* Quick Action Buttons */}
            {suggestions.length > 0 && !isTyping && (
              <div className={`flex flex-col items-center gap-2 pt-4 pb-2 transition-all ${isExpanded ? 'max-w-md mx-auto' : 'px-8'}`}>
                <p className="text-[11px] text-gray-400 font-bold uppercase tracking-wide mb-1">
                  {chatStrings.suggestedActions}
                </p>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => handleSendMessage(s)}
                    className="w-full bg-white border py-2 px-4 rounded-full text-[13px] font-bold hover:bg-[#F0F2F5] transition-colors text-center"
                    style={{ borderColor: CLIENT_BRAND.primaryHex, color: CLIENT_BRAND.primaryHex }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {isTyping && (
              <div className="flex justify-start pl-9">
                <div className="bg-[#F0F2F5] p-2.5 rounded-2xl">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-75"></div>
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-150"></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {stagedImages.length > 0 && (
            <div className="px-3 pt-2 pb-1 flex gap-2 flex-wrap items-center border-t border-gray-100 bg-white">
              {stagedImages.map((im) => (
                <div key={im.id} className="relative w-14 h-14 shrink-0">
                  <img
                    src={im.dataUrl}
                    alt=""
                    className="w-full h-full object-cover rounded-lg border border-gray-200"
                  />
                  <button
                    type="button"
                    aria-label="Quitar imagen"
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-800 text-white text-xs font-bold leading-5 shadow"
                    onClick={() =>
                      setStagedImages((prev) => prev.filter((x) => x.id !== im.id))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <span className="text-[10px] text-gray-400">
                Máx. {MAX_CHAT_IMAGES} fotos · {Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB c/u
              </span>
            </div>
          )}

          {/* Messenger Input Footer */}
          <div className="p-3 sm:p-4 bg-white flex items-center gap-3 border-t border-gray-100">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              aria-label={chatStrings.attachImage}
              onChange={handlePickImages}
            />
            <div className="flex items-center gap-3 text-xl shrink-0" style={{ color: CLIENT_BRAND.primaryHex }}>
              <i className="fas fa-plus-circle cursor-pointer hover:opacity-80 opacity-50" title="Próximamente" />
              <i className="fas fa-camera cursor-pointer hover:opacity-80 opacity-50" title="Próximamente" />
              <button
                type="button"
                className="p-0 border-0 bg-transparent cursor-pointer hover:opacity-80"
                style={{ color: CLIENT_BRAND.primaryHex }}
                aria-label={chatStrings.attachImage}
                title={chatStrings.attachImage}
                onClick={() => fileInputRef.current?.click()}
              >
                <i className="fas fa-image" />
              </button>
            </div>
            
            <div className="flex-grow bg-[#F0F2F5] rounded-full px-4 py-2.5 flex items-center">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={chatStrings.placeholder}
                className="bg-transparent border-none outline-none text-[15px] w-full placeholder-gray-500 text-gray-900"
              />
              <i className="far fa-smile ml-2 text-xl cursor-pointer hover:opacity-80" style={{ color: CLIENT_BRAND.primaryHex }}></i>
            </div>

            {input.trim() || stagedImages.length > 0 ? (
              <i 
                className="fas fa-paper-plane text-xl cursor-pointer hover:scale-110 transition-transform shrink-0"
                style={{ color: CLIENT_BRAND.primaryHex }}
                onClick={() => handleSendMessage()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              ></i>
            ) : (
              <i className="fas fa-thumbs-up text-xl cursor-pointer hover:scale-110 transition-transform shrink-0" style={{ color: CLIENT_BRAND.primaryHex }}></i>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default ChatWidget;
