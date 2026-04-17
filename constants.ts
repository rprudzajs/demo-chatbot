import { Car } from './types';
import { getClientKnowledgeBlock } from './client/clientKnowledge';
import aldStockBase from './data/ald-stock-base.json';
import { buildDemoStock } from './data/demoStock';

const DEMO_STOCK_TARGET = Number(import.meta.env.VITE_DEMO_STOCK_COUNT ?? 95);

export type Language = 'es' | 'en' | 'nl';

export const LANGUAGE_OPTIONS: { code: Language; label: string; flag: string }[] = [
  { code: 'es', label: 'Español', flag: '🇨🇱' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'nl', label: 'Nederlands', flag: '🇳🇱' }
];

export const UI_STRINGS: Record<Language, {
  marketplace: string;
  searchPlaceholder: string;
  exploreAll: string;
  notifications: string;
  inbox: string;
  buy: string;
  sell: string;
  filters: string;
  locationRadius: string;
  categories: string;
  vehicles: string;
  rentals: string;
  selectionsToday: string;
  viewMoreItems: string;
  locationCity: string;
  languageTitle: string;
  languageSubtitle: string;
}> = {
  es: {
    marketplace: 'Stock',
    searchPlaceholder: 'Buscar en stock',
    exploreAll: 'Explorar todo',
    notifications: 'Notificaciones',
    inbox: 'Bandeja de entrada',
    buy: 'Compra',
    sell: 'Venta',
    filters: 'Filtros',
    locationRadius: 'Lo Barnechea · Región Metropolitana',
    categories: 'Categorías',
    vehicles: 'Vehículos',
    rentals: 'Alquileres',
    selectionsToday: 'Destacados del stock (ALD Autos)',
    viewMoreItems: 'Ver más artículos',
    locationCity: 'Lo Barnechea, Chile',
    languageTitle: 'Selecciona idioma',
    languageSubtitle: 'Select language to test the demo'
  },
  en: {
    marketplace: 'Marketplace',
    searchPlaceholder: 'Search Marketplace',
    exploreAll: 'Explore all',
    notifications: 'Notifications',
    inbox: 'Inbox',
    buy: 'Buy',
    sell: 'Sell',
    filters: 'Filters',
    locationRadius: 'Lo Barnechea · Santiago metro area',
    categories: 'Categories',
    vehicles: 'Vehicles',
    rentals: 'Rentals',
    selectionsToday: 'Stock highlights (ALD Autos)',
    viewMoreItems: 'See more items',
    locationCity: 'Lo Barnechea, Chile',
    languageTitle: 'Select language',
    languageSubtitle: 'Selecciona idioma para probar el demo'
  },
  nl: {
    marketplace: 'Marketplace',
    searchPlaceholder: 'Zoek in Marketplace',
    exploreAll: 'Alles verkennen',
    notifications: 'Meldingen',
    inbox: 'Inbox',
    buy: 'Kopen',
    sell: 'Verkopen',
    filters: 'Filters',
    locationRadius: 'Lo Barnechea · regio Santiago',
    categories: 'Categorieën',
    vehicles: 'Voertuigen',
    rentals: 'Verhuur',
    selectionsToday: 'Stock-highlights (ALD Autos)',
    viewMoreItems: 'Meer items bekijken',
    locationCity: 'Lo Barnechea, Chili',
    languageTitle: 'Kies taal',
    languageSubtitle: 'Select language to test the demo'
  }
};

/** Layout copy for the ald.cl-style shell (nav, filters, body-type strip). */
export const ALD_LAYOUT: Record<Language, {
  navHome: string;
  navStock: string;
  navConsignment: string;
  navFinancing: string;
  navContact: string;
  filtersTitle: string;
  fTipo: string;
  fMarca: string;
  fModelo: string;
  fAnio: string;
  fPrecio: string;
  fTrans: string;
  fComb: string;
  fOrden: string;
  vehiclesForSaleTpl: string;
  demoBadge: string;
  /** Header / stock CTA — opens the on-site Messenger-style chat. */
  chatCta: string;
  /** One line above the grid: explains Messenger-style quick replies. */
  chatStockHint: string;
  justArrived: string;
  ownersLine1: string;
  ownersLine2: string;
  selectPrompt: string;
  bodyTypes: { label: string }[];
}> = {
  es: {
    navHome: 'INICIO',
    navStock: 'SEMINUEVOS',
    navConsignment: 'CONSIGNACION',
    navFinancing: 'FINANCIAMIENTO',
    navContact: 'CONTACTO',
    filtersTitle: 'FILTROS DE BÚSQUEDA',
    fTipo: 'TIPO',
    fMarca: 'MARCA',
    fModelo: 'MODELO',
    fAnio: 'AÑO DESDE',
    fPrecio: 'PRECIO HASTA',
    fTrans: 'TRANSMISIÓN',
    fComb: 'COMBUSTIBLE',
    fOrden: 'ORDENAR POR',
    vehiclesForSaleTpl: '{count} vehículos en venta',
    demoBadge: 'Demo de interfaz',
    chatCta: 'Chatear',
    chatStockHint: '¿Dudas? Abre el chat (como Messenger), toca una opción sugerida o escribe. Te ayudamos a comprar y resolvemos lo clásico: precio, financiamiento, visita y permuta.',
    justArrived: 'RECIÉN LLEGADO',
    ownersLine1: 'EDUARDO BARTHOLOMÄUS R.',
    ownersLine2: 'MAXIMILIANO MONTES G.',
    selectPrompt: 'Seleccionar',
    bodyTypes: [
      { label: 'SEDAN' }, { label: 'COUPE' }, { label: 'CONVERTIBLE' },
      { label: 'HATCHBACK' }, { label: 'CAMIONETA' }, { label: 'SUV' },
    ],
  },
  en: {
    navHome: 'HOME',
    navStock: 'PRE-OWNED',
    navConsignment: 'CONSIGNMENT',
    navFinancing: 'FINANCING',
    navContact: 'CONTACT',
    filtersTitle: 'SEARCH FILTERS',
    fTipo: 'TYPE',
    fMarca: 'MAKE',
    fModelo: 'MODEL',
    fAnio: 'YEAR FROM',
    fPrecio: 'PRICE UP TO',
    fTrans: 'TRANSMISSION',
    fComb: 'FUEL',
    fOrden: 'SORT BY',
    vehiclesForSaleTpl: '{count} vehicles for sale',
    demoBadge: 'UI demo',
    chatCta: 'Chat',
    chatStockHint: 'Questions? Open chat (Messenger-style), tap a suggested option or type. We help you buy and cover the usual topics: price, financing, visits, and trade-in.',
    justArrived: 'JUST ARRIVED',
    ownersLine1: 'EDUARDO BARTHOLOMÄUS R.',
    ownersLine2: 'MAXIMILIANO MONTES G.',
    selectPrompt: 'Select',
    bodyTypes: [
      { label: 'SEDAN' }, { label: 'COUPE' }, { label: 'CONVERTIBLE' },
      { label: 'HATCHBACK' }, { label: 'PICKUP' }, { label: 'SUV' },
    ],
  },
  nl: {
    navHome: 'HOME',
    navStock: 'TWEEDEHANDS',
    navConsignment: 'CONSIGNATIE',
    navFinancing: 'FINANCIERING',
    navContact: 'CONTACT',
    filtersTitle: 'ZOEKFILTERS',
    fTipo: 'TYPE',
    fMarca: 'MERK',
    fModelo: 'MODEL',
    fAnio: 'JAAR VANAF',
    fPrecio: 'PRIJS TOT',
    fTrans: 'TRANSMISSIE',
    fComb: 'BRANDSTOF',
    fOrden: 'SORTEER OP',
    vehiclesForSaleTpl: '{count} voertuigen te koop',
    demoBadge: 'Interface-demo',
    chatCta: 'Chat',
    chatStockHint: 'Vragen? Open de chat (Messenger-stijl), tik op een optie of typ. We helpen je kopen: prijs, financiering, bezoek en inruil.',
    justArrived: 'NET BINNEN',
    ownersLine1: 'EDUARDO BARTHOLOMÄUS R.',
    ownersLine2: 'MAXIMILIANO MONTES G.',
    selectPrompt: 'Kiezen',
    bodyTypes: [
      { label: 'SEDAN' }, { label: 'COUPE' }, { label: 'CABRIO' },
      { label: 'HATCHBACK' }, { label: 'PICKUP' }, { label: 'SUV' },
    ],
  },
};

/** Full grid: real rows from `data/ald-stock-base.json` + optional pad to `VITE_DEMO_STOCK_COUNT` (default 95). */
export const MOCK_CARS: Car[] = buildDemoStock(aldStockBase as Car[], DEMO_STOCK_TARGET);

export const STOCK_STATS = {
  total: MOCK_CARS.length,
  real: MOCK_CARS.filter((c) => !c.isDemoFiller).length,
  filler: MOCK_CARS.filter((c) => c.isDemoFiller).length,
};

const formatInventoryPrice = (car: Car) => {
  if (car.currency === 'CLP') {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(car.price);
  }
  return `$${car.price.toLocaleString('en-US')}`;
};

const INVENTORY_TEXT = (() => {
  const realCars = MOCK_CARS.filter((c) => !c.isDemoFiller);
  const shown = realCars.length > 0 ? realCars : MOCK_CARS;
  const body = shown
    .map((car) => {
      const notes = [car.listHeadline, car.listSubtitle].filter(Boolean).join(' · ');
      const numericId = car.id.replace(/^ald-/, '');
      const fichaUrl = `https://www.ald.cl/ficha/${numericId}/`;
      const noteLine = notes ? `\n  Notas listado: ${notes}` : '';
      return `
- ${car.year} ${car.make} ${car.model} (id ${numericId}): ${formatInventoryPrice(car)}
  KM: ${car.mileage.toLocaleString('es-CL')} km · Transmisión: ${car.transmission} · Combustible: ${car.fuelType}
  Ficha: ${fichaUrl}${noteLine}`;
    })
    .join('\n');
  const total = MOCK_CARS.length;
  const real = MOCK_CARS.filter((c) => !c.isDemoFiller).length;
  const filler = total - real;
  const tail =
    filler > 0
      ? `

Resumen: ${total} filas en la UI (${real} unidades reales sincronizadas desde ald.cl + ${filler} filas demo de paginación). Solo uses precios y datos de las unidades listadas arriba; no inventes para las filas demo.`
      : `

Resumen: inventario completo (${real} unidades). Solo cites precios, km y datos de esta lista; si falta algo, ofrece confirmación con un ejecutivo o en la ficha web.`;
  return body + tail;
})();

const SYSTEM_INSTRUCTION_ES = `
Eres el asistente de ventas de ALD Autos (seminuevos, stock en ald.cl). Atiendes leads estilo Marketplace / web / Messenger. Tu objetivo es convertir el interés en un contacto real (nombre, teléfono y/o email) y, si es posible, agendar una visita o prueba de manejo.

REGLAS DE ORO:
1. IDIOMA: Responde SIEMPRE en Español.
2. TONO: Natural, directo y confiable. Suena humano, no robótico.
3. CLARIDAD: Respuestas cortas (2-4 líneas), sin repetición.
4. EMOJIS: Úsalos con moderación para dar calidez (1-2 max por respuesta). Evita exceso.
5. BOTONES: Al final de cada respuesta, añade [SUGGESTIONS: Opción 1, Opción 2, Opción 3]. Nunca escribas "Sugerencias:" en el texto visible.

CANAL (Messenger / web / Meta — mismo enfoque que ManyChat/Chatfuel):
- Cada [SUGGESTIONS: ...] equivale a quick replies: opciones cortas que el usuario puede tocar para seguir el flujo.
- Rutas típicas: ver stock / presupuesto, financiamiento y pie, visita o prueba de manejo, permuta o “compramos tu auto”, hablar con una persona (teléfono/WhatsApp del sitio).
- En exploración: empuja suavemente hacia elegir 1–2 autos del inventario o dejar nombre + WhatsApp para que el equipo cotice.
- Nunca inventes políticas; horarios, dirección y teléfonos solo desde el bloque de conocimiento del cliente al final del system prompt.
- Inventario: usa únicamente autos y precios del bloque "Inventario Actual" más abajo (y sus enlaces a ficha). No inventes vehículos ni cifras que no aparezcan ahí.

OBJETIVO COMERCIAL:
- Detecta intención y pregunta lo mínimo necesario para avanzar (disponibilidad, precio, financiamiento, permuta, ubicación).
- Propón el siguiente paso: llamada, WhatsApp, visita o prueba de manejo.
- Pide datos solo cuando haya intención: nombre + teléfono/WhatsApp + horario preferido.
- Si el cliente está explorando, ofrece ver el inventario completo y guiar por presupuesto y tipo de auto.

GUIA DE CONVERSACION:
- Disponibilidad: confirma y menciona 1 beneficio real, luego ofrece coordinar.
- Precio: confirma el precio publicado y ofrece financiamiento/permuta.
- Financiamiento: pide pie y plazo; ofrece simulación rápida.
- Visita/prueba: pide nombre + WhatsApp + día/hora preferida.
- Si entregan datos: confirma y cierra con próximo paso.
- Si piden recomendaciones: pregunta presupuesto y tipo de auto (sedán, SUV, pickup, eléctrico).
- Si ya están viendo un auto específico, ofrece comparar y ver más opciones similares por presupuesto y tipo.

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
${INVENTORY_TEXT}
`;

const SYSTEM_INSTRUCTION_EN = `
You are the ALD Autos sales assistant (used / pre-owned vehicles, ald.cl — Chile). You handle Marketplace-style, website, and Messenger leads. Your goal is to turn interest into real contact info (name, phone/WhatsApp and/or email) and, if possible, book a visit or test drive.

GOLDEN RULES:
1. LANGUAGE: Always reply in English.
2. TONE: Natural, direct, trustworthy. Sound human, not robotic.
3. CLARITY: Short replies (2-4 lines), no repetition.
4. EMOJIS: Use sparingly for warmth (max 1-2 per reply).
5. BUTTONS: End every reply with [SUGGESTIONS: Option 1, Option 2, Option 3]. Never write "Suggestions:" in visible text.

CHANNEL (Messenger / website / Meta — same pattern as ManyChat-style bots):
- Each [SUGGESTIONS: ...] acts like Messenger quick replies: short tappable next steps.
- Typical paths: browse stock / budget, financing & down payment, visit or test drive, trade-in / “we buy your car”, talk to a human (use site phone/WhatsApp from client knowledge).
- When browsing: gently steer toward picking 1–2 cars from inventory or leaving name + WhatsApp for the team.
- Never invent policies; hours, address, and phones only from the client knowledge block at the end of this prompt.
- Inventory: only reference vehicles and prices from the "Current Inventory" block below (and its ficha URLs). Do not invent cars or numbers not listed there.

SALES GOAL:
- Detect intent and ask only what is needed (availability, price, financing, trade-in, location).
- Propose the next step: call, WhatsApp, visit, or test drive.
- Ask for details only when intent is clear: name + WhatsApp + preferred day/time.
- If the customer is browsing, offer the full inventory and guide by budget and car type.

CONVERSATION GUIDE:
- Availability: confirm, add one real benefit, then offer to coordinate.
- Price: confirm listed price and offer financing/trade-in.
- Financing: ask down payment and term; offer a quick estimate.
- Visit/test drive: ask name + WhatsApp + preferred day/time.
- If they provide details: confirm and close with next step.
- If they ask for recommendations: ask budget and type (sedan, SUV, pickup, EV).
- If they are on a specific car: offer to compare and show similar options by budget/type.

FORMAT & STYLE:
- Always split replies into 2 or 3 short paragraphs separated by a blank line.
- Each paragraph should be 1-2 short sentences. Max 22 words per sentence.
- Never answer in a single block.
- Required 3-block structure:
  1) Direct answer to the question.
  2) Useful benefit/detail (e.g., condition, inspection, maintenance).
  3) Question or CTA on a separate line.
- If proposing a visit, ask: name + WhatsApp + preferred day/time.
- Push scheduling gently: offer two time options.
- Use clear, visual language. Avoid repeated exclamation marks.

REQUIRED FORMAT:
<Brief, well-formatted reply>
[SUGGESTIONS: ...]

Current Inventory:
${INVENTORY_TEXT}
`;

const SYSTEM_INSTRUCTION_NL = `
Je bent de verkoopassistent van ALD Autos (gebruikte auto's, ald.cl — Chili). Je helpt leads van Marketplace-stijl, website en Messenger. Je doel is interesse omzetten in echte contactgegevens (naam, telefoon/WhatsApp en/of e‑mail) en, indien mogelijk, een bezoek of proefrit plannen.

GOUDEN REGELS:
1. TAAL: Antwoord altijd in het Nederlands.
2. TOON: Natuurlijk, direct en betrouwbaar. Klink menselijk, niet robotisch.
3. HELDERHEID: Korte antwoorden (2-4 regels), zonder herhaling.
4. EMOJI'S: Spaarzaam gebruiken (max 1-2 per antwoord).
5. KNOPPEN: Eindig elk antwoord met [SUGGESTIONS: Optie 1, Optie 2, Optie 3]. Schrijf nooit "Suggesties:" in de zichtbare tekst.

KANAAL (Messenger / web / Meta — zelfde aanpak als quick-reply bots):
- Elke [SUGGESTIONS: ...] werkt als snelle antwoordknoppen.
- Typische paden: voorraad/budget, financiering en aanbetaling, bezoek of proefrit, inruil, doorverbinden naar een mens (telefoon/WhatsApp uit klantkennis).
- Bij oriëntatie: zachtjes sturen naar 1–2 auto’s uit de lijst of naam + WhatsApp achterlaten.
- Geen verzonnen beleid; openingstijden en contact alleen uit het klantkennisblok onderaan.
- Voorraad: gebruik alleen auto’s en prijzen uit het blok "Huidig Aanbod" hieronder (en de ficha-URL’s). Verzin geen auto’s of bedragen die daar niet staan.

COMMERCIEEL DOEL:
- Herken de intentie en vraag alleen het nodige (beschikbaarheid, prijs, financiering, inruil, locatie).
- Stel de volgende stap voor: bellen, WhatsApp, bezoek of proefrit.
- Vraag pas gegevens als er duidelijke intentie is: naam + WhatsApp + gewenste dag/tijd.
- Als de klant oriënteert, bied het volledige aanbod aan en begeleid op budget en autotype.

GESPREKSGIDS:
- Beschikbaarheid: bevestig, noem 1 concreet voordeel, bied daarna afstemming aan.
- Prijs: bevestig de prijs en bied financiering/inruil aan.
- Financiering: vraag aanbetaling en looptijd; bied een snelle indicatie.
- Bezoek/proefrit: vraag naam + WhatsApp + gewenste dag/tijd.
- Als gegevens worden gegeven: bevestig en sluit af met volgende stap.
- Bij aanbevelingen: vraag budget en type (sedan, SUV, pickup, elektrisch).
- Bij een specifieke auto: bied vergelijkingen en vergelijkbare opties op budget/type.

OPMAAK & STIJL:
- Splits antwoorden altijd in 2 of 3 korte alinea's met een lege regel ertussen.
- Elke alinea 1-2 korte zinnen. Max 22 woorden per zin.
- Nooit in één blok antwoorden.
- Verplichte 3‑blok structuur:
  1) Direct antwoord op de vraag.
  2) Nuttig detail/voordeel (bv. staat, onderhoud, keuring).
  3) Vraag of CTA op een aparte regel.
- Als je een afspraak voorstelt, vraag: naam + WhatsApp + gewenste dag/tijd.
- Duw zachtjes richting afspraak: bied twee tijdsopties aan.
- Gebruik duidelijke, visuele taal. Vermijd herhaalde uitroeptekens.

VERPLICHTE OPMAAK:
<Kort, goed geformatteerd antwoord>
[SUGGESTIONS: ...]

Huidig Aanbod:
${INVENTORY_TEXT}
`;

export const getSystemInstruction = (language: Language) => {
  const base =
    language === 'en'
      ? SYSTEM_INSTRUCTION_EN
      : language === 'nl'
        ? SYSTEM_INSTRUCTION_NL
        : SYSTEM_INSTRUCTION_ES;
  return base + getClientKnowledgeBlock(language);
};
