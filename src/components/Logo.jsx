import React from 'react';
import { Layers } from 'lucide-react';

const Logo = ({ className = '', size = 'md' }) => {
  const sizes = {
    sm: { icon: 20, text: 'text-lg' },
    md: { icon: 28, text: 'text-2xl' },
    lg: { icon: 40, text: 'text-4xl' },
  };

  const { icon, text } = sizes[size] || sizes.md;

  return (
    <div className={`flex items-center gap-2 font-black tracking-tighter ${className}`}>
      <div className="flex items-center justify-center" style={{ width: icon, height: icon }}>
        <img src="/logo.png" alt="Nexus ITAM Logo" className="w-full h-full object-contain drop-shadow-sm" />
      </div>
      <span className={`${text} text-gray-900 leading-none`}>
        Nexus<span className="text-brand">ITAM</span>
      </span>
    </div>
  );
};

export default Logo;
