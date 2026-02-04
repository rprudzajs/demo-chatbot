
import React, { useState } from 'react';
import Header from './components/Header';
import CarCard from './components/CarCard';
import ChatWidget from './components/ChatWidget';
import { MOCK_CARS, LANGUAGE_OPTIONS, Language } from './constants';
import { Car } from './types';

const App: React.FC = () => {
  const [selectedCarForChat, setSelectedCarForChat] = useState<Car | null>(null);
  const [language, setLanguage] = useState<Language | null>(null);

  const handleChatRequest = (car: Car) => {
    setSelectedCarForChat(car);
    // Reset selection state after a brief delay to allow triggering the chat open
    setTimeout(() => setSelectedCarForChat(null), 100);
  };

  if (!language) {
    return (
      <div className="min-h-screen bg-[#F0F2F5] flex items-center justify-center font-sans">
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-[90%] max-w-md p-6">
          <h1 className="text-xl font-bold text-gray-900">Selecciona idioma</h1>
          <p className="text-sm text-gray-500 mt-1">Select language to test the demo</p>
          <div className="mt-5 grid grid-cols-1 gap-3">
            {LANGUAGE_OPTIONS.map(option => (
              <button
                key={option.code}
                onClick={() => setLanguage(option.code)}
                className="w-full border border-gray-200 hover:border-[#1877F2] hover:bg-[#F5F9FF] transition-colors rounded-xl px-4 py-3 text-left flex items-center gap-3"
              >
                <span className="text-xl">{option.flag}</span>
                <span className="font-semibold text-gray-900">{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F2F5] flex flex-col font-sans">
      <Header language={language} onLanguageChange={setLanguage} />
      
      <div className="flex flex-grow overflow-hidden">
        {/* Sidebar - Marketplace Left Nav */}
        <aside className="hidden lg:flex w-[360px] bg-white border-r border-gray-200 flex-col sticky top-14 h-[calc(100vh-56px)] overflow-y-auto p-4 gap-2">
          <div className="flex justify-between items-center mb-4 px-2">
            <h1 className="text-2xl font-bold text-black tracking-tight">Marketplace</h1>
            <button className="w-9 h-9 rounded-full bg-[#F0F2F5] flex items-center justify-center hover:bg-gray-200 transition-colors">
              <i className="fas fa-cog"></i>
            </button>
          </div>
          
          <div className="px-2 mb-4">
            <div className="bg-[#F0F2F5] rounded-full flex items-center px-3 py-2 border border-transparent focus-within:bg-white focus-within:border-blue-500 transition-all">
              <i className="fas fa-search text-gray-500 mr-2 text-sm"></i>
              <input type="text" placeholder="Buscar en Marketplace" className="bg-transparent text-[15px] outline-none w-full" />
            </div>
          </div>

          <nav className="flex flex-col gap-1 px-1">
            <div className="bg-[#E7F3FF] text-[#1877F2] p-2 rounded-lg flex items-center gap-3 font-semibold cursor-pointer">
              <div className="w-9 h-9 bg-[#1877F2] rounded-full flex items-center justify-center text-white">
                <i className="fas fa-store text-sm"></i>
              </div>
              <span className="text-[15px]">Explorar todo</span>
            </div>
            <div className="hover:bg-gray-100 p-2 rounded-lg flex items-center gap-3 font-semibold cursor-pointer transition-colors">
              <div className="w-9 h-9 bg-gray-200 rounded-full flex items-center justify-center text-gray-700">
                <i className="fas fa-bell text-sm"></i>
              </div>
              <span className="text-[15px]">Notificaciones</span>
            </div>
            <div className="hover:bg-gray-100 p-2 rounded-lg flex items-center gap-3 font-semibold cursor-pointer transition-colors">
              <div className="w-9 h-9 bg-gray-200 rounded-full flex items-center justify-center text-gray-700">
                <i className="fab fa-facebook-messenger text-sm"></i>
              </div>
              <span className="text-[15px]">Bandeja de entrada</span>
            </div>
            <div className="hover:bg-gray-100 p-2 rounded-lg flex items-center gap-3 font-semibold cursor-pointer transition-colors">
              <div className="w-9 h-9 bg-gray-200 rounded-full flex items-center justify-center text-gray-700">
                <i className="fas fa-shopping-bag text-sm"></i>
              </div>
              <span className="text-[15px]">Compra</span>
            </div>
            <div className="hover:bg-gray-100 p-2 rounded-lg flex items-center gap-3 font-semibold cursor-pointer transition-colors">
              <div className="w-9 h-9 bg-gray-200 rounded-full flex items-center justify-center text-gray-700">
                <i className="fas fa-tag text-sm"></i>
              </div>
              <span className="text-[15px]">Venta</span>
            </div>
          </nav>

          <hr className="my-3 border-gray-200 mx-2" />
          
          <div className="px-2">
            <h2 className="text-[17px] font-bold mb-3">Filtros</h2>
            <div className="flex flex-col gap-4">
               <div className="flex justify-between items-center text-[15px] font-semibold text-[#1877F2] cursor-pointer hover:bg-gray-50 p-1 rounded transition-colors">
                 <span>Santiago de Chile · 60 km</span>
               </div>
               <hr className="border-gray-100" />
               <div className="flex flex-col gap-1">
                 <span className="text-[15px] font-bold px-1 mb-1">Categorías</span>
                 <div className="hover:bg-gray-100 p-2 rounded-lg flex items-center gap-3 cursor-pointer transition-colors">
                   <div className="w-9 h-9 bg-gray-200 rounded-full flex items-center justify-center text-gray-700">
                     <i className="fas fa-car text-sm"></i>
                   </div>
                   <span className="font-semibold text-[15px]">Vehículos</span>
                 </div>
                 <div className="hover:bg-gray-100 p-2 rounded-lg flex items-center gap-3 cursor-pointer transition-colors">
                   <div className="w-9 h-9 bg-gray-200 rounded-full flex items-center justify-center text-gray-700">
                     <i className="fas fa-home text-sm"></i>
                   </div>
                   <span className="font-semibold text-[15px]">Alquileres</span>
                 </div>
               </div>
            </div>
          </div>
        </aside>

        {/* Main Content - Grid */}
        <main className="flex-grow p-4 lg:p-6 overflow-y-auto">
          <div className="max-w-[1200px] mx-auto">
            <div className="mb-6 px-1">
              <h2 className="text-[20px] font-bold text-gray-900">Selecciones de hoy en Santiago</h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
              {MOCK_CARS.map(car => (
                <CarCard 
                  key={car.id} 
                  car={car} 
                  onChat={handleChatRequest} 
                />
              ))}
            </div>

            <div className="mt-16 pt-8 border-t border-gray-300 flex justify-center pb-20">
              <button className="bg-gray-200 text-gray-800 px-12 py-2 rounded-lg font-bold hover:bg-gray-300 transition-colors text-[15px]">
                Ver más artículos
              </button>
            </div>
          </div>
        </main>
      </div>

      <ChatWidget initialCar={selectedCarForChat} language={language} />
    </div>
  );
};

export default App;
