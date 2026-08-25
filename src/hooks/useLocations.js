// src/hooks/useLocations.js
import { useCallback, useEffect, useState } from 'react';
import { getLocations } from '../services/locationService';
import { useAuth } from '../contexts/AuthContext';

/**
 * Locais do inquilino atual. Fonte unica para todos os seletores de
 * localizacao — antes cada tela repetia a mesma lista fixa no JSX.
 */
export const useLocations = () => {
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId;

  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(Boolean(tenantId));

  const reload = useCallback(async () => {
    if (!tenantId) {
      setLocations([]);
      setLoading(false);
      return;
    }
    try {
      setLocations(await getLocations(tenantId));
    } catch (error) {
      console.error('Falha ao carregar locais:', error);
      setLocations([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { locations, loading, reload, tenantId };
};
