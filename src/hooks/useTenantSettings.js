// src/hooks/useTenantSettings.js
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';

// Cache por empresa: varias telas (termos, etiquetas, detalhe do ativo) leem
// o mesmo /settings sem repetir a leitura a cada abertura de modal.
const cache = new Map();

// Telas abertas releem quando alguem salva as configuracoes (ex.: ligar o
// aceite automatico do agente vale na hora, sem recarregar a pagina).
const listeners = new Set();

export const invalidateTenantSettings = (tenantId) => {
  cache.delete(tenantId);
  listeners.forEach((listener) => listener(tenantId));
};

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
  const isGateway = currentUser?.authSource === 'gateway';

  const [state, setState] = useState({ tenantId: null, settings: {} });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (isGateway) return undefined;
    const listener = (changed) => {
      if (changed === tenantId) setVersion((v) => v + 1);
    };
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, [tenantId, isGateway]);

  useEffect(() => {
    if (!tenantId || isGateway) return undefined;
    let active = true;
    loadSettings(tenantId).then((settings) => {
      if (active) setState({ tenantId, settings });
    });
    return () => {
      active = false;
    };
  }, [tenantId, version, isGateway]);

  if (isGateway && tenantId) {
    return {
      settings: {
        companyName: currentUser?.companyName || 'Nexus Indústria & Tecnologia S.A.',
        assetPrefix: currentUser?.assetPrefix || 'NEX',
      },
      loaded: true,
    };
  }

  return {
    settings: state.tenantId === tenantId ? state.settings : {},
    loaded: state.tenantId === tenantId,
  };
};
