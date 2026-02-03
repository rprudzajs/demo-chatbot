
import React, { useState, useRef, useEffect } from 'react';
import { Message, Car } from '../types';
import { createCarChat, isGeminiConfigured } from '../services/geminiService';
import { Chat, GenerateContentResponse } from '@google/genai';

interface ChatWidgetProps {
  initialCar?: Car | null;
}

const ChatWidget: React.FC<ChatWidgetProps> = ({ initialCar }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'model',
      text: "¡Hola! ¿Te interesa este vehículo? Sigue disponible y listo para entrega inmediata.",
      timestamp: new Date()
    }
  ]);
  const [suggestions, setSuggestions] = useState<string[]>(['¿Sigue disponible?', '¿Aceptan permutas?', 'Ver financiamiento']);
  const [isTyping, setIsTyping] = useState(false);
  const [chatSession, setChatSession] = useState<Chat | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isGeminiConfigured()) {
      setChatSession(null);
      setInitError('missing_key');
      return;
    }

    try {
      const session = createCarChat();
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
      const initialQuery = `¿Sigue disponible el ${initialCar.make} ${initialCar.model}?`;
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
    
    return { cleanedText: cleanedText.trim(), labels };
  };

  const handleSendMessage = async (customText?: string) => {
    const textToSend = customText || input;
    if (!textToSend.trim()) return;

    if (!customText) setInput('');
    setSuggestions([]);
    
    const newUserMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: textToSend,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, newUserMsg]);
    setIsTyping(true);

    if (!chatSession) {
      setIsTyping(false);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'model',
        text: initError === 'missing_key'
          ? 'No puedo responder porque falta `VITE_GEMINI_API_KEY`. Agrégala en Railway y vuelve a desplegar.'
          : 'No puedo conectar con Gemini ahora. Intenta de nuevo en unos minutos.',
        timestamp: new Date()
      }]);
      return;
    }

    try {
      const result = await chatSession.sendMessageStream({ message: textToSend });
      
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
          msg.id === botMsgId ? { ...msg, text: cleanedText } : msg
        ));
      }

      const { labels } = parseContent(fullText);
      if (labels.length > 0) {
        setSuggestions(labels);
      }
    } catch (error) {
      console.error("Error sending message", error);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'model',
        text: "Lo siento, ¿podrías repetir eso?",
        timestamp: new Date()
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  const toggleExpand = () => setIsExpanded(!isExpanded);

  return (
    <div className={`fixed z-50 transition-all duration-300 ease-in-out flex flex-col items-end ${
      isExpanded 
        ? 'inset-0 bg-black/40 p-4 sm:p-8 flex items-center justify-center' 
        : 'bottom-0 right-4'
    }`}>
      {!isOpen && (
        <button 
          onClick={() => setIsOpen(true)}
          className="bg-[#0084FF] text-white w-14 h-14 rounded-full shadow-lg hover:brightness-110 flex items-center justify-center transition-all mb-4"
        >
          <i className="fab fa-facebook-messenger text-2xl"></i>
        </button>
      )}

      {isOpen && (
        <div className={`bg-white shadow-2xl flex flex-col border border-gray-300 overflow-hidden animate-in slide-in-from-bottom-2 duration-200 transition-all ${
          isExpanded 
            ? 'w-full max-w-[900px] h-full max-h-[85vh] rounded-2xl' 
            : 'w-[330px] sm:w-[380px] h-[520px] rounded-t-xl'
        }`}>
          {/* Messenger Header */}
          <div className="bg-white border-b border-gray-200 p-2.5 flex justify-between items-center shadow-sm shrink-0">
            <div className="flex items-center gap-2">
              <div className="relative">
                <img src="https://picsum.photos/seed/expert/50/50" className="w-8 h-8 rounded-full" alt="Agent" />
                <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white rounded-full"></div>
              </div>
              <div>
                <h4 className="font-bold text-[15px] text-gray-900 leading-tight">AutoExpert Ventas</h4>
                <p className="text-[11px] text-gray-500 font-normal">Activo ahora</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[#0084FF]">
              <button onClick={toggleExpand} className="hover:bg-gray-100 p-1.5 rounded-full text-gray-500 transition-colors hidden sm:block">
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
                ? 'Gemini no está conectado: falta VITE_GEMINI_API_KEY en Railway.'
                : 'Gemini no está disponible ahora. Intenta de nuevo en unos minutos.'}
            </div>
          )}

          {/* Messages Area */}
          <div className="flex-grow overflow-y-auto p-3 sm:p-6 space-y-4 bg-white">
            <div className="flex flex-col items-center py-6 mb-4">
              <img src="https://picsum.photos/seed/expert/150/150" className="w-20 h-20 rounded-full mb-2 border border-gray-200" alt="Avatar Huge" />
              <h5 className="font-bold text-lg">AutoExpert Ventas</h5>
              <p className="text-gray-500 text-sm">Marketplace Automotive Expert</p>
              <button className="mt-3 text-xs font-bold bg-gray-100 px-4 py-1.5 rounded-lg hover:bg-gray-200 transition-colors">Ver perfil</button>
            </div>

            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start items-end'}`}>
                {msg.role === 'model' && (
                   <img src="https://picsum.photos/seed/expert/50/50" className="w-7 h-7 rounded-full mr-2 mb-1" alt="Avatar" />
                )}
                <div className={`max-w-[80%] p-2.5 rounded-2xl text-[14px] shadow-sm ${
                  msg.role === 'user' 
                    ? 'bg-[#0084FF] text-white' 
                    : 'bg-[#F0F2F5] text-black'
                }`}>
                  <p className="leading-snug">{msg.text}</p>
                </div>
              </div>
            ))}
            
            {/* Quick Action Buttons */}
            {suggestions.length > 0 && !isTyping && (
              <div className={`flex flex-col items-center gap-2 pt-4 pb-2 transition-all ${isExpanded ? 'max-w-md mx-auto' : 'px-8'}`}>
                <p className="text-[11px] text-gray-400 font-bold uppercase tracking-wide mb-1">Acciones sugeridas</p>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => handleSendMessage(s)}
                    className="w-full bg-white border border-[#0084FF] text-[#0084FF] py-2 px-4 rounded-full text-[13px] font-bold hover:bg-[#F0F2F5] transition-colors text-center"
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

          {/* Messenger Input Footer */}
          <div className="p-3 sm:p-4 bg-white flex items-center gap-3 border-t border-gray-100">
            <div className="flex items-center gap-3 text-[#0084FF] text-xl shrink-0">
              <i className="fas fa-plus-circle cursor-pointer hover:opacity-80"></i>
              <i className="fas fa-camera cursor-pointer hover:opacity-80"></i>
              <i className="fas fa-image cursor-pointer hover:opacity-80"></i>
            </div>
            
            <div className="flex-grow bg-[#F0F2F5] rounded-full px-4 py-2.5 flex items-center">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Aa"
                className="bg-transparent border-none outline-none text-[15px] w-full placeholder-gray-500 text-gray-900"
              />
              <i className="far fa-smile text-[#0084FF] ml-2 text-xl cursor-pointer hover:opacity-80"></i>
            </div>

            {input.trim() ? (
              <i 
                className="fas fa-paper-plane text-[#0084FF] text-xl cursor-pointer hover:scale-110 transition-transform shrink-0"
                onClick={() => handleSendMessage()}
              ></i>
            ) : (
              <i className="fas fa-thumbs-up text-[#0084FF] text-xl cursor-pointer hover:scale-110 transition-transform shrink-0"></i>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatWidget;
