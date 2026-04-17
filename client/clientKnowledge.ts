/**
 * Facts from the public stock / contact area of https://www.ald.cl/stock
 * (as indexed when accessible). Reconcile on the live site via VPN before signing off with the client.
 */

export const CLIENT_WEBSITE_KNOWLEDGE = `
Marca comercial: ALD Autos. Sitio: https://www.ald.cl — sección stock: /stock.

Menú principal del sitio (referencia): INICIO, SEMINUEVOS, CONSIGNACION, FINANCIAMIENTO, CONTACTO.

Stock público (referencia): decenas de vehículos en venta; filtros por tipo (automóviles, camionetas, SUV/4WD, motos, etc.), marca, modelo, año, precio hasta, transmisión, combustible.

Algunas publicaciones listan "Automotora La Dehesa" en la ficha (relación operativa — confirmar con el cliente).

UBICACIÓN (pie de stock / contacto publicado):
- Comandante Malbec 13495, Lo Barnechea, Chile.

TELÉFONOS publicados:
- (+56 9) 7459-6700
- (+56 9) 7285-3439
- (+56 9) 6618-1755
- Consignación: (+56 9) 9294-3779

HORARIO publicado:
- Lunes a viernes: 09:00 - 19:00
- Sábado: 10:00 - 14:00

MONEDA: precios en pesos chilenos (CLP) en el sitio.

NOTA PARA EL MODELO: Si el usuario pide un dato no listado aquí (garantías legales exactas, financiamiento detallado, reserva, precio final), no inventes — ofrece derivar a un ejecutivo por WhatsApp o llamada usando los números de arriba o coordinar visita en horario de atención.
`.trim();

const header: Record<'es' | 'en' | 'nl', string> = {
  es: 'DATOS DEL NEGOCIO (sitio web y materiales del cliente — usa esto para hechos concretos; no inventes lo que no aparece aquí):',
  en: 'BUSINESS FACTS (from client website/materials — use for concrete details; do not invent what is not listed):',
  nl: 'BEDRIJFSFEITEN (van de website/materiaal van de klant — gebruik voor concrete details; verzin niets dat hier niet staat):',
};

export function getClientKnowledgeBlock(language: 'es' | 'en' | 'nl'): string {
  if (!CLIENT_WEBSITE_KNOWLEDGE) {
    if (language === 'en') {
      return '\n\n(No client website facts file yet — use generic used-car best practices; do not invent specific addresses, legal claims, or prices.)';
    }
    if (language === 'nl') {
      return '\n\n(Nog geen website-feiten van de klant — gebruik algemene tweedehands‑praktijken; verzin geen adressen, juridische claims of prijzen.)';
    }
    return '\n\n(Aún no hay datos del sitio del cliente — usa buenas prácticas genéricas de autos usados; no inventes direcciones, claims legales ni precios.)';
  }
  return `\n\n${header[language]}\n${CLIENT_WEBSITE_KNOWLEDGE}\n`;
}
