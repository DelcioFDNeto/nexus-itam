// src/pages/PlanContractPage.jsx
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  CreditCard,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { db, isFirebaseConfigured } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  DEFAULT_PLANS,
  DEFAULT_PRICING_MATRIX,
  FEATURES,
  formatUsage,
  usageRatio,
  usageTone,
} from '../utils/entitlements';
import {
  countAssets,
  countMembers,
  describeFirebaseError,
  loadPlans,
  loadPricingMatrix,
  saveTenantCustomContract,
} from '../services/tenantService';
import { microservicesApi } from '../services/microservicesClient';
import CustomPlanBuilder from '../components/plans/CustomPlanBuilder';

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
});

const CYCLE_LABEL = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  annual: 'Anual',
};

const PlanContractPage = () => {
  const { currentUser, refreshProfile } = useAuth();
  const [plans, setPlans] = useState(DEFAULT_PLANS);
  const [pricing, setPricing] = useState(DEFAULT_PRICING_MATRIX);
  const [tenantDoc, setTenantDoc] = useState(null);
  const [usage, setUsage] = useState({ assets: 0, users: 0 });
  const [usageUnavailable, setUsageUnavailable] = useState({ assets: false, users: false });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);

  const isGateway = currentUser?.authSource === 'gateway' || !isFirebaseConfigured;
  const isOwner = currentUser?.role === 'owner' || currentUser?.isMaster;
  const entitlements = currentUser?.entitlements || {};

  const loadData = useCallback(async () => {
    if (!currentUser?.tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    setUsageUnavailable({ assets: false, users: false });
    try {
      if (isGateway) {
        const [contractRes, assetsRes, usersRes] = await Promise.allSettled([
          microservicesApi.getContract(),
          microservicesApi.listAssets(),
          microservicesApi.listUsers(),
        ]);

        const contractError = contractRes.status === 'rejected' ? contractRes.reason : null;
        const isNotFoundOnly = contractError?.status === 404;
        const allFailed =
          contractRes.status === 'rejected' &&
          assetsRes.status === 'rejected' &&
          usersRes.status === 'rejected';

        if (allFailed || (contractError && !isNotFoundOnly)) {
          throw contractError || assetsRes.reason || usersRes.reason;
        }

        const contractData = contractRes.status === 'fulfilled' ? contractRes.value : null;
        const assetsOk = assetsRes.status === 'fulfilled' && Boolean(assetsRes.value);
        const usersOk = usersRes.status === 'fulfilled' && Boolean(usersRes.value);
        const assetsData = assetsOk ? assetsRes.value : { total: 0, items: [] };
        const usersData = usersOk ? usersRes.value : { total: 0, items: [] };

        setTenantDoc(
          contractData
            ? {
                id: contractData.tenantId,
                companyName: contractData.companyName,
                plan: contractData.plan,
                overrides: contractData.overrides || {},
                customContract: contractData.customContract || {},
              }
            : null,
        );
        setUsageUnavailable({ assets: !assetsOk, users: !usersOk });
        setUsage({
          assets: Number(assetsData?.total ?? assetsData?.items?.length ?? 0),
          users: Number(
            (usersData?.items || []).filter((u) => u.role !== 'collaborator').length,
          ),
        });
      } else {
        const [plansRes, pricingRes, tenantSnapRes, assetsRes, usersRes] = await Promise.allSettled([
          loadPlans(),
          loadPricingMatrix(),
          getDoc(doc(db, 'tenants', currentUser.tenantId)),
          countAssets(currentUser.tenantId),
          countMembers(currentUser.tenantId),
        ]);

        const primaryError =
          (plansRes.status === 'rejected' && plansRes.reason) ||
          (tenantSnapRes.status === 'rejected' && tenantSnapRes.reason);

        if (primaryError) {
          throw primaryError;
        }

        const loadedPlans =
          plansRes.status === 'fulfilled' && plansRes.value ? plansRes.value : DEFAULT_PLANS;
        const loadedPricing =
          pricingRes.status === 'fulfilled' && pricingRes.value
            ? pricingRes.value
            : DEFAULT_PRICING_MATRIX;
        const snap = tenantSnapRes.status === 'fulfilled' ? tenantSnapRes.value : null;
        const assetsOk = assetsRes.status === 'fulfilled';
        const usersOk = usersRes.status === 'fulfilled';
        const assetsTotal = assetsOk ? Number(assetsRes.value || 0) : 0;
        const usersTotal = usersOk ? Number(usersRes.value || 0) : 0;

        setPlans(loadedPlans);
        setPricing(loadedPricing);
        setTenantDoc(snap?.exists?.() ? { id: snap.id, ...snap.data() } : null);
        setUsageUnavailable({ assets: !assetsOk, users: !usersOk });
        setUsage({ assets: assetsTotal, users: usersTotal });
      }
    } catch (error) {
      console.error('Erro ao carregar dados do contrato:', error);
      const message = describeFirebaseError(
        error,
        'Não foi possível carregar os dados atuais do contrato.',
      );
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.tenantId, isGateway]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleApplyContract = async (payload) => {
    if (!isOwner) {
      const msg = 'Apenas o proprietário da empresa pode alterar o plano contratado.';
      toast.error(msg);
      throw new Error(msg);
    }
    if (!isGateway && !tenantDoc?.id) {
      const msg =
        'Esta conta opera no modo legado sem registro comercial em /tenants. Solicite ao Nexus Master a regularização para vincular contratos personalizados.';
      toast.info(msg);
      throw new Error(msg);
    }
    setSaving(true);
    try {
      if (isGateway) {
        await microservicesApi.saveContract(payload);
      } else {
        await saveTenantCustomContract(currentUser.tenantId, payload);
      }

      await refreshProfile?.();
      await loadData();
      toast.success('Plano e contrato personalizado aplicados com sucesso!');
    } catch (error) {
      console.error('Erro ao salvar contrato personalizado:', error);
      toast.error(describeFirebaseError(error, 'Falha ao atualizar contrato personalizado.'));
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const assetsRatio = usageRatio(usage.assets, entitlements.maxAssets);
  const usersRatio = usageRatio(usage.users, entitlements.maxUsers);

  return (
    <div className="max-w-7xl mx-auto pb-24 space-y-6 animate-fade-in">
      {/* HEADER EXECUTIVO */}
      <header className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200 dark:border-zinc-800 p-5 sm:p-6 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-brand/10 border border-brand/20 text-brand-aa flex items-center justify-center shrink-0">
            <CreditCard size={22} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-[#fafafa] tracking-tight">
                Plano & Contrato Sob Medida
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-brand/10 text-brand-aa border border-brand/20 inline-flex items-center gap-1">
                <Sparkles size={11} /> Flex Billing
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-zinc-400 mt-0.5">
              Monte o plano ideal para <strong>{currentUser?.companyName || 'sua empresa'}</strong>: ajuste cotas, escolha apenas os módulos necessários e visualize o custo mensal personalizado em tempo real.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Link
            to="/settings?secao=modulos"
            className="inline-flex min-h-[44px] items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-bold text-slate-700 dark:text-zinc-200 hover:text-brand-aa hover:border-brand/40 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span>Visibilidade do Menu</span>
            <ArrowUpRight size={14} />
          </Link>
          <button
            type="button"
            onClick={loadData}
            className="inline-flex min-h-[44px] items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-[#18181b] dark:hover:bg-zinc-800 border border-transparent dark:border-zinc-800 text-slate-700 dark:text-zinc-200 text-xs font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Atualizar</span>
          </button>
        </div>
      </header>

      {/* STATUS ATUAL DO CONTRATO (FLATTENED SIBLING GRID) */}
      <section aria-label="Resumo atual do contrato" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-1">
            <Building2 size={12} /> Contrato Atual
          </p>
          <p className="text-base font-black text-slate-900 dark:text-[#fafafa] mt-1">
            {entitlements.legacy ? 'Legado (Sem limite)' : entitlements.planName || 'Personalizado'}
          </p>
          <p className="text-xs font-mono text-brand-aa font-bold mt-0.5 tabular-nums">
            {entitlements.legacy
              ? 'Sem cobrança vinculada'
              : `${brl.format(Number(entitlements.monthlyPrice) || 0)}/mês • ${CYCLE_LABEL[entitlements.billingCycle] || 'Mensal'}`}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400">
            Uso de Ativos
          </p>
          <p className="text-base font-black text-slate-900 dark:text-[#fafafa] mt-1 tabular-nums">
            {usageUnavailable.assets
              ? 'Indisponível'
              : formatUsage(usage.assets, entitlements.maxAssets)}
          </p>
          {!usageUnavailable.assets && entitlements.maxAssets !== null && entitlements.maxAssets !== undefined && (
            <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full ${usageTone(assetsRatio) === 'critical' ? 'bg-rose-500' : usageTone(assetsRatio) === 'warning' ? 'bg-amber-500' : 'bg-brand'}`}
                style={{ width: `${Math.min(100, assetsRatio * 100)}%` }}
              />
            </div>
          )}
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400">
            Assentos da Equipe
          </p>
          <p className="text-base font-black text-slate-900 dark:text-[#fafafa] mt-1 tabular-nums">
            {usageUnavailable.users
              ? 'Indisponível'
              : formatUsage(usage.users, entitlements.maxUsers)}
          </p>
          {!usageUnavailable.users && entitlements.maxUsers !== null && entitlements.maxUsers !== undefined && (
            <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full ${usageTone(usersRatio) === 'critical' ? 'bg-rose-500' : usageTone(usersRatio) === 'warning' ? 'bg-amber-500' : 'bg-brand'}`}
                style={{ width: `${Math.min(100, usersRatio * 100)}%` }}
              />
            </div>
          )}
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-1">
            <ShieldCheck size={12} className="text-emerald-500" /> Módulos Ativos
          </p>
          <p className="text-base font-black text-slate-900 dark:text-[#fafafa] mt-1 tabular-nums">
            {FEATURES.filter((f) => entitlements.features?.[f.id] !== false).length} de {FEATURES.length} habilitados
          </p>
          <p className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold mt-0.5 flex items-center gap-1">
            <CheckCircle2 size={12} /> Portal Colaborador incluso
          </p>
        </div>
      </section>

      {(usageUnavailable.assets || usageUnavailable.users) && (
        <div
          role="alert"
          className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-xs font-semibold text-amber-800 dark:text-amber-200">
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <p>
              Não foi possível verificar o consumo atual de{' '}
              {usageUnavailable.assets && usageUnavailable.users
                ? 'ativos e assentos da equipe'
                : usageUnavailable.assets
                  ? 'ativos'
                  : 'assentos da equipe'}
              . A redução de cotas abaixo do limite vigente permanece bloqueada até a confirmação do uso real.
            </p>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="inline-flex min-h-[44px] items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 shrink-0"
          >
            <RefreshCcw size={14} aria-hidden="true" /> Verificar consumo
          </button>
        </div>
      )}

      {loadError && (
        <div role="alert" className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
            {loadError}
          </p>
          <button
            type="button"
            onClick={loadData}
            className="inline-flex min-h-[44px] items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 shrink-0"
          >
            <RefreshCcw size={14} /> Tentar novamente
          </button>
        </div>
      )}

      {/* MONTADOR PERSONALIZADO */}
      {loading ? (
        <div role="status" aria-live="polite" className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200 dark:border-zinc-800 p-6 space-y-4">
          <div className="h-24 rounded-xl bg-slate-100 dark:bg-[#18181b] animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="h-32 rounded-xl bg-slate-100 dark:bg-[#18181b] animate-pulse" />
            <div className="h-32 rounded-xl bg-slate-100 dark:bg-[#18181b] animate-pulse" />
          </div>
          <p className="text-xs text-center font-medium text-slate-500 dark:text-zinc-400">
            Carregando calculadora modular e tabela comercial…
          </p>
        </div>
      ) : (
        <CustomPlanBuilder
          key={tenantDoc?.id || 'tenant-plan-builder'}
          mode="tenant"
          plans={plans}
          pricing={pricing}
          initialPlanId={tenantDoc?.plan || entitlements.planId || 'custom'}
          initialOverrides={tenantDoc?.overrides || entitlements.overrides || {}}
          initialCustomContract={tenantDoc?.customContract || {}}
          currentEntitlements={entitlements}
          usage={usage}
          usageUnavailable={usageUnavailable}
          readOnly={!isOwner}
          saving={saving}
          onApplyContract={handleApplyContract}
        />
      )}
    </div>
  );
};

export default PlanContractPage;
