
import React from 'react';
import { UI_STRINGS, ALD_LAYOUT } from '../constants';
import { CLIENT_BRAND } from '../client/clientBrand';

interface HeaderProps {
  /** Opens the on-page Messenger-style sales assistant. */
  onOpenChat: () => void;
}

const Header: React.FC<HeaderProps> = ({ onOpenChat }) => {
  const ald = ALD_LAYOUT.es;
  const navItems = [
    { key: 'home', label: ald.navHome, active: false },
    { key: 'stock', label: ald.navStock, active: true },
    { key: 'cons', label: ald.navConsignment, active: false },
    { key: 'fin', label: ald.navFinancing, active: false },
    { key: 'contact', label: ald.navContact, active: false },
  ];

  return (
    <header className="sticky top-0 z-40 flex flex-col shadow-md">
      <div
        className="flex flex-col sm:flex-row sm:items-stretch sm:justify-between gap-3 px-4 py-3 sm:py-2"
        style={{ backgroundColor: CLIENT_BRAND.inkHex }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {CLIENT_BRAND.logoUrl ? (
            <img
              src={CLIENT_BRAND.logoUrl}
              alt="ALD"
              className="h-10 sm:h-12 object-contain"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex flex-col gap-0.5">
              <span
                className="text-3xl sm:text-4xl font-black tracking-tighter leading-none"
                style={{ color: CLIENT_BRAND.accentRedHex }}
              >
                ALD
              </span>
              <p className="text-[8px] sm:text-[9px] text-white/90 uppercase tracking-wide leading-tight">
                <span className="block">{ald.ownersLine1}</span>
                <span className="block">{ald.ownersLine2}</span>
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 sm:ml-auto">
          <button
            type="button"
            onClick={onOpenChat}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs sm:text-sm font-bold text-white border border-white/25 hover:bg-white/10 transition-colors shrink-0"
            aria-label={ald.chatCta}
          >
            <i className="fab fa-facebook-messenger text-base sm:text-lg" aria-hidden />
            <span className="hidden sm:inline">{ald.chatCta}</span>
          </button>
        </div>
      </div>

      <nav className="bg-white border-b border-gray-200 px-2 sm:px-6">
        <ul className="flex flex-wrap justify-center gap-1 sm:gap-6 py-2.5 text-[11px] sm:text-xs font-bold tracking-wide">
          {navItems.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                className={`px-2 py-1 rounded transition-colors ${
                  item.active ? '' : 'text-gray-700 hover:text-black'
                }`}
                style={item.active ? { color: CLIENT_BRAND.accentRedHex } : undefined}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="bg-white border-b border-gray-100 px-3 py-2 hidden md:block">
        <div className="max-w-6xl mx-auto flex items-center justify-center gap-4 lg:gap-8 overflow-x-auto">
          <div className="relative hidden sm:block flex-1 max-w-xs">
            <div className="bg-gray-100 rounded-md flex items-center px-3 py-2 border border-gray-200">
              <i className="fas fa-search text-gray-400 mr-2 text-sm" />
              <input
                type="text"
                placeholder={UI_STRINGS.es.searchPlaceholder}
                className="bg-transparent border-none outline-none text-xs w-full text-gray-800 placeholder:text-gray-400"
              />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
