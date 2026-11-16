// src/pages/AuditPage.jsx
// -----------------------------------------------------------------------------
// Auditoria patrimonial: inicio (cobertura por local e historico), conferencia
// no local e relatorio. A conferencia em andamento fica salva neste navegador
// (retomar depois de fechar o app ou perder o sinal); so vai ao banco ao
// finalizar. /audit?relatorio={id} abre um relatorio salvo.
// -----------------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useAssets } from '../hooks/useAssets';
import { useLocations } from '../hooks/useLocations';
import { useConfirm } from '../components/ConfirmDialog';
import { getAudit, listAudits, saveAudit } from '../services/auditService';
import { expectedAt, sameLocation } from '../utils/audit';
import { can } from '../utils/permissions';
import AuditHome from '../components/audit/AuditHome';
import AuditSession from '../components/audit/AuditSession';
import AuditReport from '../components/audit/AuditReport';

const draftKey = (tenantId) => `nexus:audit-draft:${tenantId}`;

const readDraft = (tenantId) => {
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(tenantId)) || 'null');
    return value && value.location && Array.isArray(value.scans) ? value : null;
  } catch {
    return null;
  }
};

const writeDraft = (tenantId, draft) => {
  try {
    if (draft) localStorage.setItem(draftKey(tenantId), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(tenantId));
  } catch {
    /* modo privado: a conferencia so nao sobrevive a recarga */
  }
};

const AuditPage = () => {
  const { currentUser } = useAuth();
  const confirm = useConfirm();
  const tenantId = currentUser?.tenantId;
  const canRun = can(currentUser, 'audit:run');
  const canWrite = can(currentUser, 'assets:write');
  const { assets, loading, error: assetsError, refresh: refreshAssets } = useAssets();
  const { locations } = useLocations();
  const [params, setParams] = useSearchParams();
  const reportId = params.get('relatorio');

  const [audits, setAudits] = useState([]);
  const [auditsLoading, setAuditsLoading] = useState(true);
  const [auditsError, setAuditsError] = useState('');
  const [draft, setDraft] = useState(() => (tenantId ? readDraft(tenantId) : null));
  const [sessionOpen, setSessionOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extraState, setExtraState] = useState({ id: null, audit: null, error: false });

  const loadAudits = useCallback(async () => {
    if (!tenantId) return;
    setAuditsLoading(true);
    setAuditsError('');
    try {
      setAudits(await listAudits(tenantId));
    } catch (error) {
      console.error('Falha ao carregar auditorias:', error);
      setAuditsError('Não foi possível carregar o histórico de auditorias.');
      toast.error('Não foi possível carregar o histórico de auditorias.');
    } finally {
      setAuditsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadAudits();
  }, [loadAudits]);

  // Relatorio fora dos 100 mais recentes (link antigo).
  useEffect(() => {
    if (!reportId || auditsLoading || audits.some((a) => a.id === reportId)) return;
    let active = true;
    getAudit(reportId)
      .then((audit) => {
        if (!active) return;
        if (audit?.tenantId === tenantId) {
          setExtraState({ id: reportId, audit, error: false });
        } else {
          setExtraState({ id: reportId, audit: null, error: true });
          toast.error('Relatório não encontrado.');
        }
      })
      .catch(() => {
        if (!active) return;
        setExtraState({ id: reportId, audit: null, error: true });
        toast.error('Relatório não encontrado.');
      });
    return () => { active = false; };
  }, [reportId, auditsLoading, audits, tenantId]);

  const updateDraft = (next) => {
    setDraft(next);
    writeDraft(tenantId, next);
  };

  // Locais cadastrados + nomes que so existem nos ativos (cadastros antigos).
  const locationNames = useMemo(() => {
    const names = [...locations.map((l) => l.name)];
    assets.forEach((a) => {
      if (a.location && !names.some((n) => sameLocation(n, a.location))) names.push(a.location);
    });
    return names.filter(Boolean);
  }, [locations, assets]);

  const start = async (location) => {
    if (draft && !sameLocation(draft.location, location) && draft.scans.length) {
      const ok = await confirm({
        title: 'Descartar conferência em andamento?',
        message: `Há ${draft.scans.length} leitura(s) não salvas em ${draft.location}. Começar ${location} descarta essa conferência.`,
        danger: true,
        confirmLabel: 'Descartar e começar',
      });
      if (!ok) return;
    }
    if (!draft || !sameLocation(draft.location, location)) updateDraft({ location, startedAt: new Date().toISOString(), scans: [] });
    setSessionOpen(true);
  };

  const discard = async () => {
    const ok = await confirm({
      title: 'Descartar conferência',
      message: `As ${draft?.scans.length || 0} leitura(s) de ${draft?.location} serão perdidas.`,
      danger: true,
      confirmLabel: 'Descartar',
    });
    if (!ok) return;
    updateDraft(null);
    setSessionOpen(false);
  };

  const finish = async (notes) => {
    if (!draft) return;
    setSaving(true);
    try {
      const auditId = await saveAudit({
        tenantId,
        user: currentUser,
        location: draft.location,
        startedAt: draft.startedAt,
        expected: expectedAt(assets, draft.location),
        scans: draft.scans,
        notes,
      });
      updateDraft(null);
      setSessionOpen(false);
      toast.success('Auditoria salva.');
      await loadAudits();
      setParams({ relatorio: auditId });
    } catch (error) {
      console.error(error);
      toast.error(error?.code === 'permission-denied' ? 'Seu perfil não pode registrar auditorias.' : 'Erro ao salvar a auditoria. A conferência continua salva neste navegador.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Carregando auditoria">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-brand dark:border-zinc-800 dark:border-t-brand" aria-hidden="true" />
        <span className="sr-only">Carregando auditoria…</span>
      </div>
    );
  }

  if (!reportId && assetsError && assets.length === 0) {
    return (
      <div
        role="alert"
        className="max-w-lg mx-auto my-16 rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-[#111113] p-8 text-center space-y-4 shadow-sm"
      >
        <AlertCircle size={40} className="mx-auto text-rose-500 opacity-80" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-bold text-slate-900 dark:text-[#fafafa]">Falha ao carregar os ativos para auditoria</p>
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            Não foi possível carregar o inventário para calcular os ativos esperados por local. Verifique sua conexão e tente novamente.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (typeof refreshAssets === 'function') refreshAssets();
            else window.location.reload();
          }}
          className="min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-bold uppercase tracking-wider transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <RefreshCcw size={14} aria-hidden="true" /> Tentar novamente
        </button>
      </div>
    );
  }

  if (sessionOpen && draft) {
    return (
      <AuditSession
        location={draft.location}
        locationInfo={locations.find((l) => sameLocation(l.name, draft.location))}
        assets={assets}
        draft={draft}
        onDraftChange={updateDraft}
        onLeave={() => setSessionOpen(false)}
        onDiscard={discard}
        onFinish={finish}
        saving={saving}
        canRun={canRun}
      />
    );
  }

  const extraReport = extraState.id === reportId ? extraState.audit : null;
  const extraReportError = extraState.id === reportId && extraState.error;
  const report = reportId ? audits.find((a) => a.id === reportId) || extraReport : null;
  if (reportId) {
    if (report) {
      return <AuditReport audit={report} assets={assets} currentUser={currentUser} canWrite={canWrite} onBack={() => setParams({})} />;
    }
    if (extraReportError) {
      return (
        <div role="alert" className="max-w-md mx-auto my-16 rounded-2xl border border-rose-200 dark:border-rose-800/60 bg-white dark:bg-[#111113] p-6 text-center space-y-4">
          <p className="text-sm font-bold text-rose-700 dark:text-rose-300">Relatório não encontrado ou indisponível.</p>
          <button
            type="button"
            onClick={() => setParams({})}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-bold uppercase tracking-wider transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Voltar para auditorias
          </button>
        </div>
      );
    }
    return <p role="status" className="py-16 text-center text-sm text-slate-500 dark:text-zinc-400">Carregando relatório…</p>;
  }

  return (
    <AuditHome
      assets={assets}
      locationNames={locationNames}
      audits={audits}
      auditsLoading={auditsLoading}
      auditsError={auditsError}
      onRetryAudits={loadAudits}
      draft={draft}
      canRun={canRun}
      onStart={start}
      onResume={() => setSessionOpen(true)}
      onOpenReport={(id) => setParams({ relatorio: id })}
    />
  );
};

export default AuditPage;
