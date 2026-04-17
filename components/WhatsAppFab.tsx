
import React from 'react';
import { CLIENT_BRAND } from '../client/clientBrand';

const WhatsAppFab: React.FC = () => {
  const n = CLIENT_BRAND.whatsappE164.replace(/\D/g, '');
  const href = `https://wa.me/${n}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed z-[45] bottom-24 right-4 sm:bottom-28 sm:right-5 w-14 h-14 rounded-full bg-[#25D366] text-white shadow-lg flex items-center justify-center hover:brightness-95 transition-all hover:scale-105"
      aria-label="WhatsApp"
      title="WhatsApp"
    >
      <i className="fab fa-whatsapp text-3xl" />
    </a>
  );
};

export default WhatsAppFab;
