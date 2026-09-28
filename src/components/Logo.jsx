import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { hasFeature } from '../utils/entitlements';
import { isSuperadmin } from '../utils/permissions';

const DEFAULT_LOGO = '/logo.webp';
const FALLBACK_LOGO = '/logo.png';

/**
 * Marca exibida no menu e no topo mobile.
 *  - Empresa com logotipo: logo + nome da empresa.
 *  - Whitelabel sem logotipo: inicial na cor da marca + nome da empresa
 *    (antes aparecia "NexusITAM" mesmo com whitelabel contratado).
 *  - Demais casos: marca Nexus ITAM.
 */
const Logo = ({ className = '', size = 'md', showText = true }) => {
  // Safe default just in case Logo is used outside AuthProvider
  const auth = useAuth();
  const currentUser = auth?.currentUser;
  const [failedSrc, setFailedSrc] = useState(null);

  const companyName = currentUser?.companyName || 'Nexus ITAM';
  const customLogo = currentUser?.logoUrl || '';
  const whitelabel = Boolean(currentUser) && !isSuperadmin(currentUser) && hasFeature(currentUser, 'whitelabel') && Boolean(currentUser?.tenantId);
  const showCompany = Boolean(customLogo) || (whitelabel && companyName !== 'Nexus ITAM');

  const sizes = {
    sm: { icon: 20, text: 'text-lg' },
    md: { icon: 28, text: 'text-2xl' },
    lg: { icon: 40, text: 'text-4xl' },
  };
  const { icon, text } = sizes[size] || sizes.md;

  // Logo que falhou ao carregar cai para o logo padrao, sem loop de onError.
  let src = customLogo || DEFAULT_LOGO;
  if (failedSrc === src) src = src === FALLBACK_LOGO ? null : FALLBACK_LOGO;

  const initialBadge = (
    <span
      className="flex h-full w-full items-center justify-center rounded-lg bg-brand text-white font-black"
      style={{ fontSize: Math.round(icon * 0.55) }}
    >
      {companyName.charAt(0).toUpperCase()}
    </span>
  );

  return (
    <div className={`flex items-center gap-2 font-black tracking-tighter min-w-0 ${className}`}>
      <div className="flex items-center justify-center shrink-0" style={{ width: icon, height: icon }}>
        {whitelabel && !customLogo ? (
          initialBadge
        ) : src ? (
          <img
            src={src}
            alt={showCompany ? companyName : 'Nexus ITAM'}
            className="w-full h-full object-contain drop-shadow-sm"
            width={icon}
            height={icon}
            loading="eager"
            decoding="async"
            onError={() => setFailedSrc(src)}
          />
        ) : (
          initialBadge
        )}
      </div>
      {showText && (
        <span className={`${text} text-gray-900 dark:text-white leading-none truncate max-w-[200px]`}>
          {showCompany ? companyName : (
            <>Nexus<span className="text-brand">ITAM</span></>
          )}
        </span>
      )}
    </div>
  );
};

export default Logo;
