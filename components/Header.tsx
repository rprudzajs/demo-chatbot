
import React from 'react';
import { LANGUAGE_OPTIONS, Language } from '../constants';

interface HeaderProps {
  language: Language;
  onLanguageChange: (language: Language) => void;
}

const Header: React.FC<HeaderProps> = ({ language, onLanguageChange }) => {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40 h-14 flex items-center shadow-sm">
      <div className="w-full px-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="bg-[#1877F2] w-10 h-10 rounded-full flex items-center justify-center text-white text-2xl font-bold">
            f
          </div>
          <div className="relative hidden sm:block">
            <div className="bg-[#F0F2F5] rounded-full flex items-center px-3 py-2 w-64 border border-transparent focus-within:border-blue-400">
              <i className="fas fa-search text-gray-500 mr-2"></i>
              <input 
                type="text" 
                placeholder={language === 'en' ? 'Search Marketplace' : 'Buscar en Marketplace'} 
                className="bg-transparent border-none outline-none text-sm w-full"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <div className="hidden sm:block">
            <select
              value={language}
              onChange={(event) => onLanguageChange(event.target.value as Language)}
              className="bg-[#F0F2F5] text-gray-800 text-xs font-semibold rounded-full px-3 py-2 border border-transparent hover:border-gray-300 focus:outline-none"
            >
              {LANGUAGE_OPTIONS.map(option => (
                <option key={option.code} value={option.code}>
                  {option.flag} {option.label}
                </option>
              ))}
            </select>
          </div>
          <button className="w-10 h-10 rounded-full bg-[#F0F2F5] flex items-center justify-center hover:bg-gray-200 transition-colors">
            <i className="fas fa-th text-gray-700"></i>
          </button>
          <button className="w-10 h-10 rounded-full bg-[#F0F2F5] flex items-center justify-center hover:bg-gray-200 transition-colors">
            <i className="fab fa-facebook-messenger text-gray-700"></i>
          </button>
          <button className="w-10 h-10 rounded-full bg-[#F0F2F5] flex items-center justify-center hover:bg-gray-200 transition-colors">
            <i className="fas fa-bell text-gray-700"></i>
          </button>
          <div className="w-10 h-10 rounded-full bg-gray-300 border border-gray-100 overflow-hidden ml-1">
            <img src="https://picsum.photos/seed/user/100/100" alt="Avatar" className="w-full h-full object-cover" />
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
