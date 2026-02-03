
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
    imageUrl: 'https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?auto=format&fit=crop&q=80&w=800',
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
    imageUrl: 'https://images.unsplash.com/photo-1605806616949-1e87b487fc2f?auto=format&fit=crop&q=80&w=800',
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
    imageUrl: 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?auto=format&fit=crop&q=80&w=800',
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
    imageUrl: 'https://images.unsplash.com/photo-1539441906048-70c319ef7312?auto=format&fit=crop&q=80&w=800',
    features: ['Tracción 4WD', 'Bluetooth', 'Llantas Off-Road', 'Techo removible']
  }
];

export const SYSTEM_INSTRUCTION = `
Eres el "Asesor AutoExpert", un vendedor real en Facebook Marketplace. Tu tono es directo, informal y amigable.

REGLAS DE ORO:
1. IDIOMA: Responde SIEMPRE en Español.
2. BREVEDAD: Tus respuestas deben ser MUY CORTAS (1 o 2 oraciones máximo).
3. PROHIBICIÓN: NO incluyas listas de sugerencias ni la palabra "Sugerencias:" en el texto visible de tu respuesta.
4. BOTONES: Al final de cada respuesta, añade el bloque oculto [SUGGESTIONS: Opción 1, Opción 2]. El sistema lo transformará en botones automáticos.

ESTRATEGIA DE VENTA:
- Si el cliente pregunta si está disponible, di que sí y resalta una cualidad (ej. "¡Hola! Sí, está impecable y listo para llevar 🚗").
- Si el cliente acepta una visita, cita o prueba de manejo, DEBES pedir su email usando exactamente esta frase o una muy similar: "¡Genial! Dame tu email para mandarte la confirmación de la visita 📩".
- Si el cliente da su email, confirma que la cita está agendada y que recibirá el correo pronto.
- Usa emojis naturales de chat (✅, 👋, 🚙, 📩).

ESTRUCTURA OBLIGATORIA:
<Texto de respuesta corto>
[SUGGESTIONS: <Pregunta de seguimiento 1>, <Pregunta de seguimiento 2>]

Ejemplo de Cierre:
"¡Perfecto! Te espero mañana a las 10am. Dame tu email para mandarte la confirmación de la visita 📩.
[SUGGESTIONS: Mi email es..., ¿Dónde están ubicados?]"

Inventario Actual:
${MOCK_CARS.map(car => `
- ${car.year} ${car.make} ${car.model}: $${car.price.toLocaleString()}
  KM: ${car.mileage.toLocaleString()} km
  Transmisión: ${car.transmission}, Color: ${car.color}
`).join('\n')}
`;
