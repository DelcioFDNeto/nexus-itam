// src/hooks/useAgentAutoSync.js
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useTenantSettings } from './useTenantSettings';
import { processAgentInbox, subscribeAgentSubmissions } from '../services/agentService';
import { assertWithinLimit } from '../services/tenantService';
import { can, isSuperadmin } from '../utils/permissions';
import { hasFeature } from '../utils/entitlements';

const FIRST_RUN_DELAY_MS = 2_500;
const INTERVAL_MS = 3 * 60 * 1000;

/**
 * Aceite automatico do Agente ITAM. O plano Spark nao tem servidor: quem
 * processa a fila e o navegador de um administrador logado.
 * Por padrao fica ativo (settings.autoAcceptEnabled !== false), escuta a fila
 * em tempo real (onSnapshot) e tambem roda periodicamente com Web Locks.
 */
export const useAgentAutoSync = () => {
  const { currentUser } = useAuth();
  const { settings } = useTenantSettings();
  const navigate = useNavigate();
  const userRef = useRef(currentUser);
  const runningRef = useRef(false);

  useEffect(() => {
    userRef.current = currentUser;
  }, [currentUser]);

  const tenantId = currentUser?.tenantId;
  const autoAcceptOn = settings?.autoAcceptEnabled !== false;
  const enabled = Boolean(
    tenantId &&
    autoAcceptOn &&
    !isSuperadmin(currentUser) &&
    can(currentUser, 'agent:manage') &&
    hasFeature(currentUser, 'agent'),
  );

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const work = async () => {
      const user = userRef.current;
      if (cancelled || !user || runningRef.current) return;
      runningRef.current = true;
      try {
        const summary = await processAgentInbox({
          tenantId,
          user: user.email || 'Agente ITAM',
          trustedOnly: true,
          canCreate: () => assertWithinLimit(user, 'assets', 1),
        });
        if (summary.created) {
          toast.success(`Agente ITAM: ${summary.created} máquina(s) nova(s) incorporada(s) ao inventário.`, {
            description: summary.updated ? `${summary.updated} atualizada(s) na mesma rodada.` : undefined,
            action: { label: 'Ver frota', onClick: () => navigate('/agent') },
          });
        } else if (summary.updated) {
          toast.success(`Agente ITAM: inventário de ${summary.updated} máquina(s) sincronizado.`);
        }
        if (summary.errors.length) {
          toast.error(`Agente ITAM: ${summary.errors.length} envio(s) com erro.`, {
            description: summary.errors[0].message,
            action: { label: 'Abrir fila', onClick: () => navigate('/agent?aba=fila') },
          });
        }
      } catch (error) {
        console.warn('Sincronização automática do agente falhou:', error);
      } finally {
        runningRef.current = false;
      }
    };

    const run = () =>
      navigator.locks?.request
        ? navigator.locks.request('nexus-agent-autosync', { ifAvailable: true }, (lock) => (lock ? work() : undefined))
        : work();

    const first = setTimeout(run, FIRST_RUN_DELAY_MS);
    const timer = setInterval(run, INTERVAL_MS);
    const unsub = subscribeAgentSubmissions(tenantId, (items) => {
      const hasPending = items.some((item) => item.status === 'pending');
      if (hasPending && !cancelled) {
        run();
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
      if (typeof unsub === 'function') unsub();
    };
  }, [enabled, tenantId, navigate]);
};
