
import React from 'react';
import { Car } from '../types';
import { UI_STRINGS, ALD_LAYOUT } from '../constants';
import { CLIENT_BRAND } from '../client/clientBrand';

interface CarCardProps {
  car: Car;
  onChat: (car: Car) => void;
}

const formatCarPrice = (car: Car) => {
  const currency = car.currency ?? 'USD';
  if (currency === 'CLP') {
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

const resolveImageUrl = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname.toLowerCase().includes('rtautomotriz.com')) {
      // Serve dealer images via a stable image proxy to avoid hotlink/referrer issues in production.
      const originAndPath = `${parsed.hostname}${parsed.pathname}${parsed.search}`;
      return `https://images.weserv.nl/?url=${encodeURIComponent(originAndPath)}`;
    }
  } catch {
    // Keep original URL for non-standard values.
  }
  return rawUrl;
};

const StatBar: React.FC<{ car: Car; price: string }> = ({ car, price }) => (
  <div className="grid grid-cols-3 text-center text-[11px] sm:text-xs border-b border-gray-100 py-1.5 px-1 bg-white">
    <span className="font-bold truncate px-0.5" style={{ color: CLIENT_BRAND.accentRedHex }}>
      {price}
    </span>
    <span className="font-bold text-gray-900 border-x border-gray-100 truncate px-0.5">
      {car.mileage.toLocaleString('es-CL')} Km
    </span>
    <span className="font-bold text-gray-900 truncate px-0.5">{car.year}</span>
  </div>
);

const CarCard: React.FC<CarCardProps> = ({ car, onChat }) => {
  const strings = UI_STRINGS.es;
  const ald = ALD_LAYOUT.es;
  const price = formatCarPrice(car);
  const title = `${car.make} ${car.model}`.toUpperCase();
  const primaryImageUrl = resolveImageUrl(car.imageUrl);

  return (
    <div
      className="bg-white rounded-md overflow-hidden flex flex-col cursor-pointer group shadow-sm hover:shadow-md transition-shadow border border-gray-100"
      onClick={() => onChat(car)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onChat(car)}
    >
      <StatBar car={car} price={price} />

      {car.listHeadline ? (
        <p className="text-center text-[10px] sm:text-[11px] font-bold text-gray-900 uppercase tracking-tight px-2 pt-1.5">
          {car.listHeadline}
        </p>
      ) : null}

      <div className="relative aspect-[4/3] w-full bg-gray-200 overflow-hidden">
        <img
          src={primaryImageUrl}
          alt={`${car.year} ${car.make}`}
          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          onError={(e) => {
            const el = e.currentTarget;
            if (el.dataset.fallback === '1') return;
            el.dataset.fallback = '1';
            el.src = `https://picsum.photos/seed/${encodeURIComponent(car.id)}/600/450`;
          }}
        />
        {car.isDemoFiller ? (
          <div className="absolute top-2 left-2 bg-gray-800/90 text-white text-[8px] sm:text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-sm">
            Demo
          </div>
        ) : null}
        {car.justArrived ? (
          <div
            className="absolute top-3 right-0 text-[9px] sm:text-[10px] font-black uppercase tracking-wide text-gray-900 py-1 pl-6 pr-2 shadow-sm"
            style={{
              background: 'linear-gradient(135deg, #f5e000 0%, #ffd400 100%)',
              clipPath: 'polygon(12% 0, 100% 0, 100% 100%, 0 100%)',
            }}
          >
            {ald.justArrived}
          </div>
        ) : null}
        <div className="absolute bottom-2 left-2 flex gap-1">
          {car.transmissionShort ? (
            <span className="bg-black/85 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-sm">
              {car.transmissionShort}
            </span>
          ) : null}
          {car.fuelBadge ? (
            <span className="bg-emerald-700 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-sm uppercase">
              {car.fuelBadge}
            </span>
          ) : null}
        </div>
      </div>

      <div className="px-2 py-2 flex flex-col gap-1 flex-grow text-center">
        <h3 className="text-[11px] sm:text-xs font-bold text-gray-900 leading-snug uppercase tracking-tight line-clamp-2">
          {title}
        </h3>
        {car.listSubtitle ? (
          <p className="text-[9px] sm:text-[10px] text-gray-700 uppercase leading-snug line-clamp-2">
            {car.listSubtitle}
          </p>
        ) : null}
        <p className="text-[9px] text-gray-400 mt-auto">{strings.locationCity}</p>
      </div>

      <StatBar car={car} price={price} />
    </div>
  );
};

export default CarCard;
