
import React from 'react';
import { Car } from '../types';
import { Language, UI_STRINGS } from '../constants';

interface CarCardProps {
  car: Car;
  onChat: (car: Car) => void;
  language: Language;
}

const CarCard: React.FC<CarCardProps> = ({ car, onChat, language }) => {
  const strings = UI_STRINGS[language];

  return (
    <div 
      className="bg-white rounded-lg overflow-hidden flex flex-col cursor-pointer group hover:bg-gray-50 transition-colors"
      onClick={() => onChat(car)}
    >
      <div className="aspect-square w-full overflow-hidden bg-gray-100 relative">
        <img 
          src={car.imageUrl} 
          alt={`${car.year} ${car.make}`} 
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
      </div>
      <div className="p-2 flex flex-col gap-0.5">
        <span className="text-lg font-bold text-gray-900">${car.price.toLocaleString()}</span>
        <h3 className="text-sm font-semibold text-gray-700 leading-tight line-clamp-2">
          {car.year} {car.make} {car.model}
        </h3>
        <p className="text-xs text-gray-500">{strings.locationCity}</p>
      </div>
    </div>
  );
};

export default CarCard;
