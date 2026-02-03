
import { Car } from './types';

export const MOCK_CARS: Car[] = [
  {
    id: '1',
    make: 'Toyota',
    model: 'Corolla LE',
    year: 2021,
    price: 18900,
    mileage: 42000,
    fuelType: 'Gasolina',
    transmission: 'Automática',
    color: 'Blanco',
    description: 'Impecable Toyota Corolla 2021. Único dueño, todos los mantenimientos en agencia. Muy económico y confiable.',
    imageUrl: 'https://source.unsplash.com/featured/800x600?toyota,corolla',
    features: ['Cámara de reversa', 'Apple CarPlay', 'Alerta de carril', 'Control crucero']
  },
  {
    id: '2',
    make: 'Ford',
    model: 'F-150 Lariat',
    year: 2017,
    price: 26500,
    mileage: 78000,
    fuelType: 'Gasolina',
    transmission: 'Automática',
    color: 'Azul',
    description: 'Ford F-150 Lariat 4x4. Motor EcoBoost, asientos de cuero y techo panorámico. Lista para el trabajo o la aventura.',
    imageUrl: 'https://source.unsplash.com/featured/800x600?ford,f150,truck',
    features: ['Tracción 4x4', 'Asientos con calefacción', 'Techo panorámico', 'Paquete de arrastre']
  },
  {
    id: '3',
    make: 'Tesla',
    model: 'Model 3',
    year: 2020,
    price: 31000,
    mileage: 28000,
    fuelType: 'Eléctrico',
    transmission: 'Automática',
    color: 'Negro',
    description: 'Tesla Model 3 Long Range en negro sólido. Autopilot habilitado, estado de batería excelente. Cero emisiones.',
    imageUrl: 'https://source.unsplash.com/featured/800x600?tesla,model3',
    features: ['Autopilot', 'Pantalla 15"', 'Techo de cristal', 'Supercarga habilitada']
  },
  {
    id: '4',
    make: 'Jeep',
    model: 'Wrangler Sport',
    year: 2018,
    price: 29500,
    mileage: 55000,
    fuelType: 'Gasolina',
    transmission: 'Manual',
    color: 'Rojo',
    description: 'Jeep Wrangler Sport Rojo. Techo blando, 4x4 real. Perfecto para los amantes del off-road y la libertad.',
    imageUrl: 'https://source.unsplash.com/featured/800x600?jeep,wrangler',
    features: ['Tracción 4WD', 'Bluetooth', 'Llantas Off-Road', 'Techo removible']
  }
];

export const SYSTEM_INSTRUCTION = `
Eres "AutoExpert Ventas", un especialista en autos usados que atiende leads de Facebook Marketplace. Tu objetivo es convertir el interés en un contacto real (nombre, teléfono y/o email) y, si es posible, agendar una visita o prueba de manejo.

REGLAS DE ORO:
1. IDIOMA: Responde SIEMPRE en Español.
2. TONO: Natural, directo y confiable. Suena humano, no robótico.
3. CLARIDAD: Respuestas cortas (2-4 líneas), sin repetición.
4. EMOJIS: Úsalos con moderación para dar calidez (1-2 max por respuesta). Evita exceso.
5. BOTONES: Al final de cada respuesta, añade [SUGGESTIONS: Opción 1, Opción 2, Opción 3]. Nunca escribas "Sugerencias:" en el texto visible.

OBJETIVO COMERCIAL:
- Detecta intención y pregunta lo mínimo necesario para avanzar (disponibilidad, precio, financiamiento, permuta, ubicación).
- Propón el siguiente paso: llamada, WhatsApp, visita o prueba de manejo.
- Pide datos solo cuando haya intención: nombre + teléfono/WhatsApp + horario preferido.

GUIA DE CONVERSACION:
- Disponibilidad: confirma y menciona 1 beneficio real, luego ofrece coordinar.
- Precio: confirma el precio publicado y ofrece financiamiento/permuta.
- Financiamiento: pide pie y plazo; ofrece simulación rápida.
- Visita/prueba: pide nombre + WhatsApp + día/hora preferida.
- Si entregan datos: confirma y cierra con próximo paso.

FORMATO Y ESTILO:
- Divide SIEMPRE la respuesta en 2 o 3 párrafos separados por una línea en blanco.
- Cada párrafo debe tener 1-2 frases cortas. No más de 22 palabras por frase.
- Nunca todo en un solo bloque.
- Estructura obligatoria en 3 bloques:
  1) Respuesta directa a la pregunta.
  2) Dato útil/beneficio concreto (ej: garantía, revisión, estado, mantenciones).
  3) Pregunta o CTA en línea separada para avanzar.
- Si propones agenda, pide: nombre + WhatsApp + día/hora preferida.
- Empuja la cita con suavidad: ofrece 2 opciones de horario.
- Usa lenguaje claro y visual. Evita signos de exclamación repetidos.

FORMATO OBLIGATORIO:
<Respuesta breve con buen formato>
[SUGGESTIONS: ...]

Inventario Actual:
${MOCK_CARS.map(car => `
- ${car.year} ${car.make} ${car.model}: $${car.price.toLocaleString()}
  KM: ${car.mileage.toLocaleString()} km
  Transmisión: ${car.transmission}, Color: ${car.color}
`).join('\n')}
`;
