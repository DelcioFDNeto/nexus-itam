// src/hooks/useTenantSettings.js
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';

// Cache por empresa: varias telas (termos, etiquetas, detalhe do ativo) leem
// o mesmo /settings sem repetir a leitura a cada abertura de modal.
const cache = new Map();

export const invalidateTenantSettings = (tenantId) => cache.delete(tenantId);

const loadSettings = (tenantId) => {
  if (!cache.has(tenantId)) {
    cache.set(
      tenantId,
      getDoc(doc(db, 'settings', tenantId))
        .then((snap) => (snap.exists() ? snap.data() : {}))
        .catch((error) => {
          cache.delete(tenantId);
          console.error('Falha ao carregar configurações:', error);
          return {};
        }),
    );
  }
  return cache.get(tenantId);
};

/** Documento /settings da empresa do usuario ({} enquanto carrega ou sem cadastro). */
export const useTenantSettings = () => {
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId;
  const [state, setState] = useState({ tenantId: null, settings: {} });

  useEffect(() => {
    if (!tenantId) return undefined;
    let active = true;
    loadSettings(tenantId).then((settings) => {
      if (active) setState({ tenantId, settings });
    });
    return () => {
      active = false;
    };
  }, [tenantId]);

  return {
    settings: state.tenantId === tenantId ? state.settings : {},
    loaded: state.tenantId === tenantId,
  };
};
