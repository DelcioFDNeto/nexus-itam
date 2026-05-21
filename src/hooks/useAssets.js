// src/hooks/useAssets.js
import { useState, useEffect, useCallback } from 'react';
import { 
  getAllAssets, 
  getAssetById as fetchAssetById, 
  getAssetHistory as fetchHistory 
} from '../services/assetService';
import { useAuth } from '../contexts/AuthContext';

export const useAssets = () => {
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId;

  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Carrega lista completa filtrada pelo tenant do usuário logado
  const loadAssets = useCallback(async () => {
    if (!tenantId) {
      setAssets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await getAllAssets(tenantId);
      setAssets(data);
    } catch (err) {
      console.error(err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  // --- A CORREÇÃO ESTÁ AQUI ---
  // Envolvemos estas funções em useCallback para elas não mudarem a cada render
  const getAssetById = useCallback(async (id) => {
    return await fetchAssetById(id);
  }, []);

  const getAssetHistory = useCallback(async (id) => {
    return await fetchHistory(id);
  }, []);

  return { 
    assets, 
    loading, 
    error, 
    refreshAssets: loadAssets,
    getAssetById,
    getAssetHistory
  };
};