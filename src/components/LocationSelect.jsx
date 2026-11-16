// src/components/LocationSelect.jsx
import React from 'react';
import { Link } from 'react-router-dom';
import { groupLocations, groupLocationsByKind } from '../services/locationService';
import { useLocations } from '../hooks/useLocations';

/**
 * Seletor de local, alimentado pela colecao `locations` do inquilino.
 *
 * Substitui as quatro copias do mesmo <select> com as filiais da empresa
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
  emptyLabel = 'Selecione…',
  showManageLink = false,
  // 'kind' agrupa por Matriz / Lojas / Depositos (transferencias).
  groupBy = 'region',
  // Local que nao pode ser escolhido (ex.: a propria origem como destino).
  exclude,
  id,
  disabled = false,
}) => {
  const { locations, loading } = useLocations();

  const available = exclude ? locations.filter((l) => l.name !== exclude) : locations;
  const groups = groupBy === 'kind' ? groupLocationsByKind(available) : groupLocations(available);
  const known = locations.some((l) => l.name === value);
  const isOrphan = Boolean(value) && !known;

  return (
    <>
      <select
        id={id}
        name={name}
        value={value || ''}
        onChange={onChange}
        className={`dark:bg-[#111113] dark:text-[#fafafa] dark:[&_option]:bg-[#111113] dark:[&_option]:text-[#fafafa] dark:[&_optgroup]:bg-[#111113] dark:[&_optgroup]:text-zinc-400 ${className}`}
        disabled={loading || disabled}
      >
        {allowEmpty && <option value="">{loading ? 'Carregando locais…' : emptyLabel}</option>}

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
        <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
          Nenhum local cadastrado.{' '}
          {showManageLink && (
            <Link to="/settings?secao=locais" className="font-bold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded">
              Cadastrar filiais
            </Link>
          )}
        </p>
      )}
    </>
  );
};

export default LocationSelect;
