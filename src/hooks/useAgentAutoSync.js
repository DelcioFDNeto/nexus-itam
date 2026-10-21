// src/hooks/useAgentAutoSync.js
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useTenantSettings } from './useTenantSettings';
import { processAgentInbox } from '../services/agentService';
import { assertWithinLimit } from '../services/tenantService';
import { can, isSuperadmin } from '../utils/permissions';
import { hasFeature } from '../utils/entitlements';

const FIRST_RUN_DELAY_MS = 15_000;
const INTERVAL_MS = 10 * 60 * 1000;

/**
 * Aceite automatico do Agente ITAM. O plano Spark nao tem servidor: quem
 * processa a fila e o navegador de um administrador logado. Roda 15 s depois
 * de entrar e a cada 10 min, em uma aba por navegador (Web Locks); entre
 * administradores, cada envio e reservado numa transacao (agentService).
 */
export const useAgentAutoSync = () => {
  const { currentUser } = useAuth();
  const { settings } = useTenantSettings();
  const navigate = useNavigate();
  const userRef = useRef(currentUser);
  useEffect(() => {
    userRef.current = currentUser;
  }, [currentUser]);

  const tenantId = currentUser?.tenantId;
  const enabled = Boolean(
    tenantId &&
    settings?.autoAcceptEnabled &&
    !isSuperadmin(currentUser) &&
    can(currentUser, 'agent:manage') &&
    hasFeature(currentUser, 'agent'),
  );

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const work = async () => {
      const user = userRef.current;
      if (cancelled || !user) return;
      try {
        const summary = await processAgentInbox({
          tenantId,
          user: user.email || 'Agente ITAM',
          trustedOnly: true,
          canCreate: () => assertWithinLimit(user, 'assets', 1),
        });
        if (summary.created) {
          toast.success(`Agente ITAM: ${summary.created} máquina(s) nova(s) no inventário.`, {
            description: summary.updated ? `${summary.updated} atualizada(s) na mesma rodada.` : undefined,
            action: { label: 'Ver frota', onClick: () => navigate('/agent') },
          });
        }
        if (summary.errors.length) {
          toast.error(`Agente ITAM: ${summary.errors.length} envio(s) com erro.`, {
            description: summary.errors[0].message,
            action: { label: 'Abrir fila', onClick: () => navigate('/agent?aba=fila') },
          });
        }
      } catch (error) {
        console.warn('Sincronização automática do agente falhou:', error);
      }
    };

    const run = () =>
      navigator.locks?.request
        ? navigator.locks.request('nexus-agent-autosync', { ifAvailable: true }, (lock) => (lock ? work() : undefined))
        : work();

    const first = setTimeout(run, FIRST_RUN_DELAY_MS);
    const timer = setInterval(run, INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled, tenantId, navigate]);
};
