
import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import CarCard from './components/CarCard';
import ChatWidget from './components/ChatWidget';
import WhatsAppFab from './components/WhatsAppFab';
import { MOCK_CARS, STOCK_STATS, ALD_LAYOUT } from './constants';
import { Car } from './types';
import { CLIENT_BRAND } from './client/clientBrand';

const FilterSelect: React.FC<{ label: string; placeholder: string }> = ({ label, placeholder }) => (
  <div className="flex flex-col gap-1 min-w-0">
    <span className="text-[10px] font-bold text-white/80 uppercase tracking-wide truncate">{label}</span>
    <div className="bg-white/95 text-gray-800 text-[11px] font-semibold rounded px-2 py-2 flex justify-between items-center border border-white/20">
      <span className="truncate opacity-60">{placeholder}</span>
      <i className="fas fa-chevron-down text-[10px] text-gray-400 shrink-0 ml-1" />
    </div>
  </div>
);

const PAGE_SIZE = 9;

const App: React.FC = () => {
  const [selectedCarForChat, setSelectedCarForChat] = useState<Car | null>(null);
  const [stockPage, setStockPage] = useState(1);
  const [chatOpenPulse, setChatOpenPulse] = useState(0);

  const totalPages = Math.max(1, Math.ceil(MOCK_CARS.length / PAGE_SIZE));
  useEffect(() => {
    setStockPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  const handleChatRequest = (car: Car) => {
    setSelectedCarForChat(car);
    setTimeout(() => setSelectedCarForChat(null), 100);
  };

  const ald = ALD_LAYOUT.es;
  const stockTitle = ald.vehiclesForSaleTpl.replace('{count}', String(MOCK_CARS.length));
  const safePage = Math.min(stockPage, totalPages);
  const pageOffset = (safePage - 1) * PAGE_SIZE;
  const pageCars = MOCK_CARS.slice(pageOffset, pageOffset + PAGE_SIZE);

  let pageWindowStart = Math.max(1, safePage - 3);
  let pageWindowEnd = Math.min(totalPages, pageWindowStart + 6);
  pageWindowStart = Math.max(1, pageWindowEnd - 6);
  const visiblePageNums: number[] = [];
  for (let p = pageWindowStart; p <= pageWindowEnd; p += 1) visiblePageNums.push(p);

  const filterLabels = [
    ald.fTipo,
    ald.fMarca,
    ald.fModelo,
    ald.fAnio,
    ald.fPrecio,
    ald.fTrans,
    ald.fComb,
    ald.fOrden,
  ];

  return (
    <div
      className="min-h-screen flex flex-col font-sans"
      style={{ backgroundColor: CLIENT_BRAND.pageDarkHex }}
    >
      <Header onOpenChat={() => setChatOpenPulse((n) => n + 1)} />

      <section className="bg-white border-b border-gray-200 py-3 overflow-x-auto">
        <div className="max-w-6xl mx-auto flex justify-center gap-6 sm:gap-10 px-4 min-w-min">
          {ald.bodyTypes.map((bt) => (
            <button
              key={bt.label}
              type="button"
              className="flex flex-col items-center gap-1.5 text-gray-600 hover:text-black shrink-0"
            >
              <span className="w-12 h-8 rounded bg-gray-100 border border-gray-200 flex items-center justify-center">
                <i className="fas fa-car-side text-gray-400 text-lg" />
              </span>
              <span className="text-[9px] sm:text-[10px] font-bold tracking-wide">{bt.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="px-3 sm:px-6 py-4" style={{ backgroundColor: CLIENT_BRAND.panelHex }}>
        <div className="max-w-6xl mx-auto">
          <h2 className="text-white text-sm font-bold tracking-wide mb-3">{ald.filtersTitle}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {filterLabels.map((label) => (
              <FilterSelect key={label} label={label} placeholder={ald.selectPrompt} />
            ))}
          </div>
        </div>
      </section>

      <main className="flex-grow px-3 sm:px-6 py-6 overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{stockTitle}</h2>
            <span className="text-xs font-semibold text-white/50 uppercase tracking-wide">{ald.demoBadge}</span>
          </div>
          {STOCK_STATS.filler > 0 ? (
            <p className="text-[11px] text-white/45 mb-5 max-w-3xl">
              {`${STOCK_STATS.real} vehículos con datos públicos del sitio + ${STOCK_STATS.filler} filas demo para paginación (sustituir por export real cuando la tengas).`}
            </p>
          ) : (
            <p className="text-[11px] text-white/45 mb-5">{`${MOCK_CARS.length} unidades en este archivo.`}</p>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5 pb-4 border-b border-white/10">
            <p className="text-[11px] sm:text-xs text-white/55 max-w-3xl leading-relaxed">{ald.chatStockHint}</p>
            <button
              type="button"
              onClick={() => setChatOpenPulse((n) => n + 1)}
              className="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold text-white border border-white/30 hover:bg-white/10 transition-colors self-start sm:self-center"
              style={{ borderColor: `${CLIENT_BRAND.accentRedHex}99` }}
            >
              <i className="fab fa-facebook-messenger text-lg" aria-hidden />
              {ald.chatCta}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {pageCars.map((car) => (
              <CarCard key={car.id} car={car} onChat={handleChatRequest} />
            ))}
          </div>

          <div className="mt-10 flex flex-wrap justify-center items-center gap-1 sm:gap-2 text-white/80 text-sm pb-24">
            <button
              type="button"
              className="px-2 py-1 rounded hover:bg-white/10 disabled:opacity-30"
              disabled={safePage <= 1}
              onClick={() => setStockPage((p) => Math.max(1, p - 1))}
            >
              «
            </button>
            {pageWindowStart > 1 ? (
              <>
                <button
                  type="button"
                  className="w-8 h-8 rounded font-semibold hover:bg-white/10"
                  onClick={() => setStockPage(1)}
                >
                  1
                </button>
                {pageWindowStart > 2 ? <span className="px-1 text-white/40">…</span> : null}
              </>
            ) : null}
            {visiblePageNums.map((n) => (
              <button
                key={n}
                type="button"
                className={`w-8 h-8 rounded font-semibold ${
                  n === safePage ? 'bg-white/25 text-white' : 'hover:bg-white/10'
                }`}
                onClick={() => setStockPage(n)}
              >
                {n}
              </button>
            ))}
            {pageWindowEnd < totalPages ? (
              <>
                {pageWindowEnd < totalPages - 1 ? <span className="px-1 text-white/40">…</span> : null}
                <button
                  type="button"
                  className="w-8 h-8 rounded font-semibold hover:bg-white/10"
                  onClick={() => setStockPage(totalPages)}
                >
                  {totalPages}
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="px-2 py-1 rounded hover:bg-white/10 disabled:opacity-30"
              disabled={safePage >= totalPages}
              onClick={() => setStockPage((p) => Math.min(totalPages, p + 1))}
            >
              »
            </button>
          </div>
        </div>
      </main>

      <WhatsAppFab />
      <ChatWidget initialCar={selectedCarForChat} openTrigger={chatOpenPulse} />
    </div>
  );
};

export default App;
