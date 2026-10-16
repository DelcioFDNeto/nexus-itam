// src/hooks/useLocations.js
import { useCallback, useEffect, useState } from 'react';
import { getLocations } from '../services/locationService';
import { useAuth } from '../contexts/AuthContext';

const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutos
const cache = new Map(); // tenantId -> { data, timestamp }
const inFlight = new Map(); // tenantId -> Promise<Array>

export const invalidateLocationsCache = (tenantId) => {
  if (tenantId) {
    cache.delete(tenantId);
    inFlight.delete(tenantId);
  } else {
    cache.clear();
    inFlight.clear();
  }
};

const fetchLocationsCached = async (tenantId) => {
  if (!tenantId) return [];

  const now = Date.now();
  const cached = cache.get(tenantId);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  if (inFlight.has(tenantId)) {
    return inFlight.get(tenantId);
  }

  const promise = getLocations(tenantId)
    .then((data) => {
      cache.set(tenantId, { data, timestamp: Date.now() });
      inFlight.delete(tenantId);
      return data;
    })
    .catch((error) => {
      inFlight.delete(tenantId);
      throw error;
    });

  inFlight.set(tenantId, promise);
  return promise;
};

/**
 * Locais do inquilino atual. Fonte unica para todos os seletores de
 * localizacao — antes cada tela repetia a mesma lista fixa no JSX.
 */
export const useLocations = () => {
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId;

  const [locations, setLocations] = useState(() => {
    if (!tenantId) return [];
    const cached = cache.get(tenantId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
    return [];
  });
  const [loading, setLoading] = useState(() => {
    if (!tenantId) return false;
    const cached = cache.get(tenantId);
    return !(cached && Date.now() - cached.timestamp < CACHE_TTL_MS);
  });

  const reload = useCallback(async () => {
    if (!tenantId) {
      setLocations([]);
      setLoading(false);
      return;
    }
    invalidateLocationsCache(tenantId);
    setLoading(true);
    try {
      const data = await fetchLocationsCached(tenantId);
      setLocations(data);
    } catch (error) {
      console.error('Falha ao carregar locais:', error);
      setLocations([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) {
      setLocations([]);
      setLoading(false);
      return undefined;
    }

    let active = true;
    const cached = cache.get(tenantId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      setLocations(cached.data);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    fetchLocationsCached(tenantId)
      .then((data) => {
        if (active) {
          setLocations(data);
          setLoading(false);
        }
      })
      .catch((error) => {
        if (active) {
          console.error('Falha ao carregar locais:', error);
          setLocations([]);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [tenantId]);

  return { locations, loading, reload, tenantId };
};
