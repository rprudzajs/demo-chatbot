import type { Car } from '../types';

const MAKES = [
  'Toyota', 'Ford', 'Nissan', 'Hyundai', 'Kia', 'Volkswagen', 'Peugeot', 'Mazda',
  'Subaru', 'Jeep', 'Ram', 'Mercedes-Benz', 'Cupra', 'MG', 'Suzuki', 'Mitsubishi',
  'Honda', 'Land Rover', 'Porsche', 'Volvo', 'Lexus', 'MINI', 'Fiat', 'Renault',
] as const;

/** Pads with synthetic rows so pagination feels like full stock. Not for production claims. */
export function buildDemoStock(base: Car[], targetTotal: number): Car[] {
  if (targetTotal <= 0 || base.length >= targetTotal) {
    return base.slice(0, Math.max(0, targetTotal));
  }
  const out: Car[] = [...base];
  let i = base.length;
  while (out.length < targetTotal) {
    const seed = i;
    const make = MAKES[seed % MAKES.length];
    const year = 2012 + (seed * 3) % 14;
    const price = 4_990_000 + ((seed * 1_357_391) % 88_000_000);
    const mileage = 12_000 + ((seed * 7_919) % 198_000);
    const diesel = seed % 7 === 0;
    const manual = seed % 5 === 0;
    out.push({
      id: `demo-fill-${seed}`,
      make,
      model: `Unidad demo ${seed + 1}`,
      year,
      price,
      currency: 'CLP',
      mileage,
      fuelType: seed % 11 === 0 ? 'Híbrido' : diesel ? 'Diésel' : 'Bencina',
      transmission: manual ? 'Mecánica' : 'Automática',
      color: '—',
      description:
        'Relleno de interfaz para demo (no es ficha real). Sustituir por exportación del stock o API del cliente.',
      imageUrl: `https://picsum.photos/seed/ald-fill-${seed}/600/600`,
      features: ['Demo stock'],
      isDemoFiller: true,
      transmissionShort: manual ? 'MT' : 'AT',
      fuelBadge: diesel ? 'DIESEL' : seed % 11 === 0 ? 'HÍBRIDO' : 'BENCINA',
      justArrived: seed % 13 === 0,
    });
    i += 1;
  }
  return out;
}
