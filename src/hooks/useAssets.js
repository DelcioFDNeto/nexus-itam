// src/hooks/useAssets.js
import { useState, useEffect, useCallback } from 'react';
import { 
  getAssetById as fetchAssetById, 
  getAssetHistory as fetchHistory 
} from '../services/assetService';
import { db } from '../services/firebase';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';

export const useAssets = () => {
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId;

  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(!tenantId);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect

    const assetsRef = collection(db, 'assets');
    const q = query(
      assetsRef,
      where('tenantId', '==', tenantId),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setAssets(data);
      setLoading(false);
      setError(null);
    }, (err) => {
      console.error("Erro no onSnapshot de assets:", err);
      setError(err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [tenantId]);

  // --- A CORREÇÃO ESTÁ AQUI ---
  // Envolvemos estas funções em useCallback para elas não mudarem a cada render
  const getAssetById = useCallback(async (id) => {
    return await fetchAssetById(id, currentUser?.role === 'superadmin' ? null : tenantId);
  }, [tenantId, currentUser?.role]);

  const getAssetHistory = useCallback(async (id) => {
    return await fetchHistory(id);
  }, []);

  return { 
    assets, 
    loading, 
    error, 
    getAssetById,
    getAssetHistory
  };
};