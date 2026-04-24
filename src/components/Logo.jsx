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
      <div className="bg-brand text-white p-1.5 rounded-xl shadow-sm flex items-center justify-center">
        <Layers size={icon} strokeWidth={2.5} />
      </div>
      <span className={`${text} text-gray-900 leading-none`}>
        Nexus<span className="text-brand">ITAM</span>
      </span>
    </div>
  );
};

export default Logo;
