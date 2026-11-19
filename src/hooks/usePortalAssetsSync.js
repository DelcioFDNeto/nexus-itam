// src/hooks/usePortalAssetsSync.js
import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { syncTenantAssetsToPortal } from '../services/assetService';
import { can, isSuperadmin } from '../utils/permissions';

const FIRST_SYNC_DELAY_MS = 2_500;
const MIN_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Sincroniza em segundo plano os ativos do Firestore com o microsserviço
 * `service-assets` (PostgreSQL) utilizado pelo Portal do Colaborador (Vue 3).
 * Roda uma única vez a cada 5 minutos por tenant na sessão do administrador,
 * garantindo que equipamentos cadastrados no Console Admin ou via Agente ITAM
 * apareçam automaticamente sob custódia no Portal.
 */
export const usePortalAssetsSync = () => {
  const { currentUser } = useAuth();
  const runningRef = useRef(false);

  const tenantId = currentUser?.tenantId;
  const enabled = Boolean(
    import.meta.env?.MODE !== 'test' &&
      tenantId &&
      currentUser?.authSource !== 'gateway' &&
      !isSuperadmin(currentUser) &&
      can(currentUser, 'assets:write'),
  );

  useEffect(() => {
    if (!enabled || !tenantId) return undefined;
    let cancelled = false;
    const storageKey = `nexus_portal_assets_synced_v2_${tenantId}`;

    const shouldRunNow = () => {
      try {
        const lastTs = Number(sessionStorage.getItem(storageKey) || 0);
        return !lastTs || Date.now() - lastTs >= MIN_SYNC_INTERVAL_MS;
      } catch {
        return true;
      }
    };

    const runSync = async () => {
      if (cancelled || runningRef.current || !shouldRunNow()) return;
      runningRef.current = true;
      try {
        const result = await syncTenantAssetsToPortal(tenantId, { silent: true });
        if (!result?.error) {
          try {
            sessionStorage.setItem(storageKey, String(Date.now()));
          } catch {
            /* sessionStorage indisponível */
          }
        }
      } finally {
        runningRef.current = false;
      }
    };

    const timer = setTimeout(() => {
      void runSync();
    }, FIRST_SYNC_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, tenantId]);
};
