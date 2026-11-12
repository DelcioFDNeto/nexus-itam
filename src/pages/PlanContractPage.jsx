// src/pages/PlanContractPage.jsx
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isGateway = currentUser?.authSource === 'gateway' || !isFirebaseConfigured;
  const isOwner = currentUser?.role === 'owner' || currentUser?.isMaster;
  const entitlements = currentUser?.entitlements || {};

  const loadData = useCallback(async () => {
    if (!currentUser?.tenantId) return;
    setLoading(true);
    try {
      if (isGateway) {
        const [contractData, assetsRes, usersRes] = await Promise.all([
          microservicesApi.getContract().catch(() => null),
          microservicesApi.listAssets().catch(() => ({ total: 0, items: [] })),
          microservicesApi.listUsers().catch(() => ({ total: 0, items: [] })),
        ]);
        if (contractData) {
          setTenantDoc({
            id: contractData.tenantId,
            companyName: contractData.companyName,
            plan: contractData.plan,
            overrides: contractData.overrides || {},
            customContract: contractData.customContract || {},
          });
        }
        setUsage({
          assets: Number(assetsRes?.total ?? assetsRes?.items?.length ?? 0),
          users: Number(
            (usersRes?.items || []).filter((u) => u.role !== 'collaborator').length,
          ),
        });
      } else {
        const [loadedPlans, loadedPricing, snap, assetsTotal, usersTotal] = await Promise.all([
          loadPlans().catch(() => DEFAULT_PLANS),
          loadPricingMatrix().catch(() => DEFAULT_PRICING_MATRIX),
          getDoc(doc(db, 'tenants', currentUser.tenantId)).catch(() => null),
          countAssets(currentUser.tenantId).catch(() => 0),
          countMembers(currentUser.tenantId).catch(() => 0),
        ]);
        setPlans(loadedPlans);
        setPricing(loadedPricing);
        setTenantDoc(snap?.exists() ? { id: snap.id, ...snap.data() } : null);
        setUsage({ assets: assetsTotal || 0, users: usersTotal || 0 });
      }
    } catch (error) {
      console.error('Erro ao carregar dados do contrato:', error);
      toast.error('Não foi possível carregar os dados atuais do contrato.');
    } finally {
      setLoading(false);
    }
  }, [currentUser?.tenantId, isGateway]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleApplyContract = async (payload) => {
    if (!isOwner) {
      toast.error('Apenas o proprietário da empresa pode alterar o plano contratado.');
      return;
    }
    setSaving(true);
    try {
      if (isGateway) {
        await microservicesApi.saveContract(payload);
      } else {
        if (!tenantDoc?.id) {
          toast.info(
            'Esta conta opera no modo legado sem registro comercial em /tenants. Solicite ao Nexus Master a regularização para vincular contratos personalizados.',
          );
          setSaving(false);
          return;
        }
        await saveTenantCustomContract(currentUser.tenantId, payload);
      }

      await refreshProfile?.();
      await loadData();
      toast.success('Plano e contrato personalizado aplicados com sucesso!');
    } catch (error) {
      console.error('Erro ao salvar contrato personalizado:', error);
      toast.error(describeFirebaseError(error, 'Falha ao atualizar contrato personalizado.'));
    } finally {
      setSaving(false);
    }
  };

  const assetsRatio = usageRatio(usage.assets, entitlements.maxAssets);
  const usersRatio = usageRatio(usage.users, entitlements.maxUsers);

  return (
    <div className="max-w-7xl mx-auto pb-24 space-y-6 animate-fade-in">
      {/* HEADER EXECUTIVO */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-brand/10 border border-brand/20 text-brand flex items-center justify-center shrink-0">
              <CreditCard size={22} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                  Plano & Contrato Sob Medida
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-brand/10 text-brand border border-brand/20 flex items-center gap-1">
                  <Sparkles size={11} /> Flex Billing
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Monte o plano ideal para <strong>{currentUser?.companyName || 'sua empresa'}</strong>: ajuste cotas, escolha apenas os módulos necessários e visualize o custo mensal personalizado em tempo real.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Link
              to="/settings?secao=modulos"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-brand hover:border-brand/40 transition-colors"
            >
              <span>Visibilidade do Menu</span>
              <ArrowUpRight size={14} />
            </Link>
            <button
              type="button"
              onClick={loadData}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold transition-colors"
            >
              <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
              <span>Atualizar</span>
            </button>
          </div>
        </div>

        {/* STATUS ATUAL DO CONTRATO */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-5 pt-5 border-t border-slate-100 dark:border-slate-800">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Building2 size={12} /> Contrato Atual
            </p>
            <p className="text-base font-black text-slate-900 dark:text-white mt-1 flex items-center gap-2">
              <span>{entitlements.legacy ? 'Legado (Sem limite)' : entitlements.planName || 'Personalizado'}</span>
            </p>
            <p className="text-[11px] font-mono text-brand font-bold mt-0.5 tabular-nums">
              {entitlements.legacy
                ? 'Sem cobrança vinculada'
                : `${brl.format(Number(entitlements.monthlyPrice) || 0)}/mês • ${CYCLE_LABEL[entitlements.billingCycle] || 'Mensal'}`}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Uso de Ativos
            </p>
            <p className="text-base font-black text-slate-900 dark:text-white mt-1 tabular-nums">
              {formatUsage(usage.assets, entitlements.maxAssets)}
            </p>
            {entitlements.maxAssets !== null && entitlements.maxAssets !== undefined && (
              <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full ${usageTone(assetsRatio) === 'critical' ? 'bg-rose-500' : usageTone(assetsRatio) === 'warning' ? 'bg-amber-500' : 'bg-brand'}`}
                  style={{ width: `${Math.min(100, assetsRatio * 100)}%` }}
                />
              </div>
            )}
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Assentos da Equipe
            </p>
            <p className="text-base font-black text-slate-900 dark:text-white mt-1 tabular-nums">
              {formatUsage(usage.users, entitlements.maxUsers)}
            </p>
            {entitlements.maxUsers !== null && entitlements.maxUsers !== undefined && (
              <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full ${usageTone(usersRatio) === 'critical' ? 'bg-rose-500' : usageTone(usersRatio) === 'warning' ? 'bg-amber-500' : 'bg-brand'}`}
                  style={{ width: `${Math.min(100, usersRatio * 100)}%` }}
                />
              </div>
            )}
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <ShieldCheck size={12} className="text-emerald-500" /> Módulos Ativos
            </p>
            <p className="text-base font-black text-slate-900 dark:text-white mt-1 tabular-nums">
              {FEATURES.filter((f) => entitlements.features?.[f.id] !== false).length} de {FEATURES.length} habilitados
            </p>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5 flex items-center gap-1">
              <CheckCircle2 size={11} /> Portal Colaborador incluso
            </p>
          </div>
        </div>
      </div>

      {/* MONTADOR PERSONALIZADO */}
      {loading ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center text-sm text-slate-400 animate-pulse">
          Carregando calculadora modular e tabela comercial...
        </div>
      ) : (
        <CustomPlanBuilder
          key={`${tenantDoc?.plan || entitlements.planId || 'custom'}-${JSON.stringify(tenantDoc?.overrides || {})}`}
          mode="tenant"
          plans={plans}
          pricing={pricing}
          initialPlanId={tenantDoc?.plan || entitlements.planId || 'custom'}
          initialOverrides={tenantDoc?.overrides || entitlements.overrides || {}}
          initialCustomContract={tenantDoc?.customContract || {}}
          currentEntitlements={entitlements}
          usage={usage}
          readOnly={!isOwner}
          saving={saving}
          onApplyContract={handleApplyContract}
        />
      )}
    </div>
  );
};

export default PlanContractPage;
