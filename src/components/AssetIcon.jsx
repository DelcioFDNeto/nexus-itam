import React from 'react';
import { Smartphone, Monitor, Printer, Network, Laptop, Megaphone, CreditCard } from 'lucide-react';

const AssetIcon = ({ type, category, model, internalId, className = "", size = 20 }) => {
    const isPromo = category === 'Promocional' || internalId?.includes('PRM');
    // Verifica se é notebook pelo tipo OU pelo modelo (para compatibilidade com dados antigos)
    const isNotebook = type === 'Notebook' || model?.toLowerCase().includes('notebook');

    if (isPromo) return <Megaphone size={size} className={`text-pink-500 ${className}`} />;
    if (isNotebook) return <Laptop size={size} className={`text-blue-600 ${className}`} />;
    
    switch (type) {
      case 'Celular': return <Smartphone size={size} className={`text-blue-500 ${className}`} />;
      case 'Impressora': return <Printer size={size} className={`text-orange-500 ${className}`} />;
      case 'PGT': return <CreditCard size={size} className={`text-yellow-600 ${className}`} />;
      case 'Computador': return <Monitor size={size} className={`text-purple-500 ${className}`} />;
      default: return <Network size={size} className={`text-gray-500 ${className}`} />;
    }
};

export default AssetIcon;
