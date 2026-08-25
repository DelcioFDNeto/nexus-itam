import React from 'react';
import { Megaphone } from 'lucide-react';
import { getAssetType } from '../utils/assetTypes';

/**
 * Icone do ativo, resolvido pelo catalogo unico em `utils/assetTypes`.
 *
 * O `switch` anterior nao cobria `Monitor` nem `Servidor` — os dois caiam num
 * icone generico de rede — e divergia da lista usada no formulario, onde
 * Computador, Notebook e Monitor apareciam todos com o mesmo desenho.
 */
const AssetIcon = ({ type, category, model, internalId, className = '', size = 20 }) => {
  // Comodato promocional tem leitura propria, independente do tipo tecnico.
  if (category === 'Promocional' || internalId?.includes('PRM')) {
    return <Megaphone size={size} className={`text-pink-500 ${className}`} />;
  }

  // Base legada: muitos registros antigos so trazem o modelo.
  const resolved = type || (model?.toLowerCase().includes('notebook') ? 'Notebook' : undefined);

  const { icon: Icon, tone } = getAssetType(resolved);
  return <Icon size={size} className={`${tone} ${className}`} />;
};

export default AssetIcon;
