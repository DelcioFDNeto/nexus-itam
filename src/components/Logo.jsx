import React from 'react';
import { useAuth } from '../contexts/AuthContext';

const Logo = ({ className = '', size = 'md', showText = true }) => {
  // Safe default just in case Logo is used outside AuthProvider
  const auth = useAuth();
  const currentUser = auth?.currentUser;
  
  const logoUrl = currentUser?.logoUrl || '/logo.png';
  const companyName = currentUser?.companyName || 'Nexus ITAM';

  const sizes = {
    sm: { icon: 20, text: 'text-lg' },
    md: { icon: 28, text: 'text-2xl' },
    lg: { icon: 40, text: 'text-4xl' },
  };

  const { icon, text } = sizes[size] || sizes.md;

  return (
    <div className={`flex items-center gap-2 font-black tracking-tighter ${className}`}>
      <div className="flex items-center justify-center shrink-0" style={{ width: icon, height: icon }}>
        <img src={logoUrl} alt="Logo" className="w-full h-full object-contain drop-shadow-sm" />
      </div>
      {showText && (
        <span className={`${text} text-gray-900 dark:text-white leading-none truncate max-w-[200px]`}>
          {currentUser?.logoUrl ? companyName : (
            <>Nexus<span className="text-brand">ITAM</span></>
          )}
        </span>
      )}
    </div>
  );
};

export default Logo;
