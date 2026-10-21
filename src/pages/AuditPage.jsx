// src/pages/AuditPage.jsx
// -----------------------------------------------------------------------------
// Auditoria patrimonial: inicio (cobertura por local e historico), conferencia
// no local e relatorio. A conferencia em andamento fica salva neste navegador
// (retomar depois de fechar o app ou perder o sinal); so vai ao banco ao
// finalizar. /audit?relatorio={id} abre um relatorio salvo.
// -----------------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  const { assets, loading } = useAssets();
  const { locations } = useLocations();
  const [params, setParams] = useSearchParams();
  const reportId = params.get('relatorio');

  const [audits, setAudits] = useState([]);
  const [auditsLoading, setAuditsLoading] = useState(true);
  const [draft, setDraft] = useState(() => (tenantId ? readDraft(tenantId) : null));
  const [sessionOpen, setSessionOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extraReport, setExtraReport] = useState(null);

  const loadAudits = useCallback(async () => {
    if (!tenantId) return;
    setAuditsLoading(true);
    try {
      setAudits(await listAudits(tenantId));
    } catch (error) {
      console.error('Falha ao carregar auditorias:', error);
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
    getAudit(reportId)
      .then((audit) => (audit?.tenantId === tenantId ? setExtraReport(audit) : toast.error('Relatório não encontrado.')))
      .catch(() => toast.error('Relatório não encontrado.'));
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
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900 dark:border-slate-700 dark:border-t-white" />
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

  const report = reportId ? audits.find((a) => a.id === reportId) || (extraReport?.id === reportId ? extraReport : null) : null;
  if (reportId) {
    return report ? (
      <AuditReport audit={report} assets={assets} currentUser={currentUser} canWrite={canWrite} onBack={() => setParams({})} />
    ) : (
      <p className="py-16 text-center text-sm text-gray-400">Carregando relatório…</p>
    );
  }

  return (
    <AuditHome
      assets={assets}
      locationNames={locationNames}
      audits={audits}
      auditsLoading={auditsLoading}
      draft={draft}
      canRun={canRun}
      onStart={start}
      onResume={() => setSessionOpen(true)}
      onOpenReport={(id) => setParams({ relatorio: id })}
    />
  );
};

export default AuditPage;
