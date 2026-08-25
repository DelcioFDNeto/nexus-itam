// src/components/LocationSelect.jsx
import React from 'react';
import { Link } from 'react-router-dom';
import { groupLocations } from '../services/locationService';
import { useLocations } from '../hooks/useLocations';

/**
 * Seletor de local, alimentado pela colecao `locations` do inquilino.
 *
 * Substitui as quatro copias do mesmo <select> com as filiais da Shineray
 * escritas direto no JSX. Preserva um valor que ja esteja gravado no registro
 * mesmo que ele nao exista mais na lista — trocar de filial nao pode apagar
 * silenciosamente o local de um ativo antigo.
 */
const LocationSelect = ({
  value,
  onChange,
  name = 'location',
  className = '',
  allowEmpty = true,
  emptyLabel = 'Selecione...',
  showManageLink = false,
}) => {
  const { locations, loading } = useLocations();

  const groups = groupLocations(locations);
  const known = locations.some((l) => l.name === value);
  const isOrphan = Boolean(value) && !known;

  return (
    <>
      <select name={name} value={value || ''} onChange={onChange} className={className} disabled={loading}>
        {allowEmpty && <option value="">{loading ? 'Carregando locais...' : emptyLabel}</option>}

        {/* Mantém o valor histórico visível e selecionável */}
        {isOrphan && <option value={value}>{value} (fora da lista)</option>}

        {groups.map(({ region, items }) => (
          <optgroup key={region} label={region}>
            {items.map((loc) => (
              <option key={loc.id} value={loc.name}>
                {loc.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {!loading && locations.length === 0 && (
        <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-500">
          Nenhum local cadastrado.{' '}
          {showManageLink && (
            <Link to="/settings" className="font-bold underline">
              Cadastrar filiais
            </Link>
          )}
        </p>
      )}
    </>
  );
};

export default LocationSelect;
