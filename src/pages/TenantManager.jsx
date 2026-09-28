// src/pages/TenantManager.jsx
// -----------------------------------------------------------------------------
// Empresas da plataforma (console Nexus Master).
//
// Correcoes em relacao a versao anterior:
//  - limites vinham de uma tabela fixa no codigo, ignorando /plans e qualquer
//    ajuste individual; agora o plano efetivo sai de utils/entitlements;
//  - lia TODOS os ativos da plataforma (collectionGroup) so para contar; agora
//    usa agregacao por empresa (1 leitura a cada 1.000 documentos);
//  - "Excluir" apagava so o documento da empresa — usuarios e dados continuavam
//    acessiveis. Encerrar agora e um status que as regras do Firestore bloqueiam;
//  - empresas legadas (sem /tenants) passam a aparecer e podem ser regularizadas;
//  - provisionamento com erro nao deixa mais conta de login orfa.
// -----------------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Building2, ChevronRight, CircleDollarSign, Pause, Play, PlusSquare, RefreshCcw, Search, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { describeFirebaseError, loadConsoleSnapshot, provisionTenant, updateTenant } from '../services/tenantService';
import { TENANT_STATUSES } from '../utils/entitlements';
import { brl, brlCompact, relativeDays, tenantAlerts } from '../utils/consoleMetrics';
import { PlanBadge, TenantStatusBadge, UsageBar } from '../components/console/consoleUi';
import TenantDetailDrawer from '../components/console/TenantDetailDrawer';

const EMPTY_PROVISION = { companyName: '', adminName: '', email: '', password: '', plan: 'starter' };

const fieldClass =
  'w-full px-3 py-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand text-sm font-semibold text-gray-900 dark:text-white';

const TenantManager = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const statusFilter = searchParams.get('status') || 'ALL';
  const planFilter = searchParams.get('plano') || 'ALL';
  const alertsOnly = searchParams.get('alertas') === '1';
  const selectedId = searchParams.get('empresa');
  const showProvision = searchParams.get('novo') === '1';

  const [provisionForm, setProvisionForm] = useState(EMPTY_PROVISION);
  const [provisionLoading, setProvisionLoading] = useState(false);
  const [provisionError, setProvisionError] = useState('');

  const setParam = useCallback((key, value) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === null || value === undefined || value === '' || value === 'ALL') next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await loadConsoleSnapshot());
    } catch (error) {
      console.error('Erro ao carregar empresas:', error);
      toast.error('Falha ao carregar a lista de empresas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const tenants = useMemo(() => snapshot?.tenants || [], [snapshot]);
  const plans = useMemo(() => snapshot?.plans || {}, [snapshot]);
  const selected = tenants.find((t) => t.id === selectedId) || null;

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return tenants.filter((t) => {
      if (term) {
        const haystack = [t.companyName, t.id, t.owner?.email, t.owner?.name].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (statusFilter === 'legacy' && !t.legacy) return false;
      if (statusFilter !== 'ALL' && statusFilter !== 'legacy' && (t.legacy || t.status !== statusFilter)) return false;
      if (planFilter !== 'ALL' && t.entitlements?.planId !== planFilter) return false;
      if (alertsOnly && tenantAlerts(t).length === 0) return false;
      return true;
    });
  }, [tenants, searchTerm, statusFilter, planFilter, alertsOnly]);

  const totals = useMemo(() => ({
    total: tenants.length,
    live: tenants.filter((t) => !t.legacy && ['active', 'trial'].includes(t.status)).length,
    blocked: tenants.filter((t) => ['suspended', 'cancelled'].includes(t.status)).length,
    legacy: tenants.filter((t) => t.legacy).length,
    mrr: tenants.reduce((sum, t) => sum + (t.mrr || 0), 0),
    withAlerts: tenants.filter((t) => tenantAlerts(t).some((a) => a.level !== 'info')).length,
  }), [tenants]);

  const quickToggle = async (tenant) => {
    const suspend = ['active', 'trial'].includes(tenant.status);
    if (!confirm(`${suspend ? 'Suspender' : 'Reativar'} o acesso de "${tenant.companyName || tenant.id}"?`)) return;
    try {
      await updateTenant(tenant.id, { status: suspend ? 'suspended' : 'active' });
      toast.success(suspend ? 'Empresa suspensa: acesso bloqueado.' : 'Empresa reativada.');
      load();
    } catch (error) {
      console.error(error);
      toast.error(describeFirebaseError(error));
    }
  };

  const closeProvision = () => {
    setParam('novo', null);
    setProvisionForm(EMPTY_PROVISION);
    setProvisionError('');
  };

  const handleProvision = async (e) => {
    e.preventDefault();
    setProvisionError('');
    if (provisionForm.password.length < 8) {
      setProvisionError('A senha inicial precisa de pelo menos 8 caracteres.');
      return;
    }
    setProvisionLoading(true);
    try {
      const { tenantId } = await provisionTenant(provisionForm);
      toast.success(`Empresa "${provisionForm.companyName}" criada. Envie o acesso ao responsável.`);
      closeProvision();
      await load();
      setParam('empresa', tenantId);
    } catch (error) {
      console.error('Erro ao provisionar empresa:', error);
      setProvisionError(describeFirebaseError(error, 'Erro ao criar a empresa.'));
    } finally {
      setProvisionLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto pb-24 space-y-6">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden border border-white/5">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-4 bg-white/5 text-indigo-300 rounded-2xl border border-white/10">
            <Building2 size={32} />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">Empresas</h1>
            <p className="text-slate-400 font-medium text-sm mt-1">Planos, limites sob medida, identidade e saúde de cada cliente.</p>
          </div>
        </div>
        <div className="relative z-10 flex items-center gap-2">
          <button onClick={() => setParam('novo', '1')} className="flex items-center gap-2 px-5 py-3 bg-white hover:bg-gray-100 text-black rounded-xl font-black text-xs uppercase tracking-wider transition-all active:scale-95 shadow-lg">
            <PlusSquare size={16} /> Nova empresa
          </button>
          <button onClick={load} aria-label="Recarregar" title="Recarregar" className="flex items-center justify-center w-12 h-12 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-all border border-white/10">
            <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* RESUMO */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Total', value: totals.total, onClick: () => setParam('status', null) },
          { label: 'Ativas', value: totals.live, onClick: () => setParam('status', 'active') },
          { label: 'Suspensas / encerradas', value: totals.blocked, onClick: () => setParam('status', 'suspended') },
          { label: 'Com alertas', value: totals.withAlerts, onClick: () => setParam('alertas', alertsOnly ? null : '1'), icon: AlertTriangle },
          { label: 'MRR', value: brlCompact.format(totals.mrr), icon: CircleDollarSign },
        ].map((stat) => (
          <button
            key={stat.label}
            onClick={stat.onClick}
            disabled={!stat.onClick}
            className="text-left bg-white dark:bg-slate-800 rounded-3xl p-5 border border-gray-100 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow disabled:cursor-default"
          >
            <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider">{stat.label}</p>
            <p className="text-2xl font-black text-gray-900 dark:text-white mt-1 tabular-nums">{stat.value}</p>
          </button>
        ))}
      </div>

      {/* FILTROS */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-gray-100 dark:border-slate-700 p-4 shadow-sm flex flex-col md:flex-row gap-3 items-stretch md:items-center">
        <div className="relative w-full md:flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="search"
            placeholder="Buscar por empresa, ID, responsável ou e-mail..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 text-xs bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand font-medium text-gray-700 dark:text-slate-200"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={statusFilter} onChange={(e) => setParam('status', e.target.value)} aria-label="Filtrar por status" className="text-xs bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-2.5 font-bold text-gray-600 dark:text-slate-300 cursor-pointer focus:outline-none">
            <option value="ALL">Todos os status</option>
            {Object.entries(TENANT_STATUSES).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
            <option value="legacy">Legadas (sem cadastro)</option>
          </select>
          <select value={planFilter} onChange={(e) => setParam('plano', e.target.value)} aria-label="Filtrar por plano" className="text-xs bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-2.5 font-bold text-gray-600 dark:text-slate-300 cursor-pointer focus:outline-none">
            <option value="ALL">Todos os planos</option>
            {Object.values(plans).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {alertsOnly && (
            <button onClick={() => setParam('alertas', null)} className="text-xs font-bold px-3 py-2 rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 flex items-center gap-1">
              Com alertas <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* TABELA */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-900 text-gray-400 text-[10px] uppercase font-black tracking-widest border-b border-gray-100 dark:border-slate-700">
                <th className="p-4 pl-6">Empresa</th>
                <th className="p-4">Responsável</th>
                <th className="p-4">Plano</th>
                <th className="p-4">Usuários</th>
                <th className="p-4">Ativos</th>
                <th className="p-4">Último acesso</th>
                <th className="p-4 text-right">MRR</th>
                <th className="p-4 pr-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="text-xs font-semibold text-gray-700 dark:text-slate-200">
              {loading && !snapshot ? (
                <tr>
                  <td colSpan="8" className="p-12 text-center text-gray-400 font-bold uppercase tracking-widest">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-4 border-brand/20 border-t-brand rounded-full animate-spin" />
                      Carregando empresas...
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="8" className="p-8 text-center text-gray-400 font-medium">Nenhuma empresa corresponde aos filtros.</td>
                </tr>
              ) : (
                filtered.map((tenant) => {
                  const alerts = tenantAlerts(tenant);
                  const worst = alerts.find((a) => a.level === 'critical') || alerts.find((a) => a.level === 'warning');
                  return (
                    <tr
                      key={tenant.id}
                      onClick={() => setParam('empresa', tenant.id)}
                      className="border-b border-gray-50 dark:border-slate-700/60 hover:bg-gray-50/60 dark:hover:bg-slate-900/40 transition-colors cursor-pointer"
                    >
                      <td className="p-4 pl-6">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-brand/10 text-brand flex items-center justify-center font-black shrink-0">
                            {(tenant.companyName || tenant.id).substring(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-extrabold text-gray-900 dark:text-white text-sm truncate max-w-[220px] flex items-center gap-1.5">
                              {tenant.companyName || 'Empresa sem nome'}
                              {worst && <AlertTriangle size={13} className={worst.level === 'critical' ? 'text-rose-500' : 'text-amber-500'} aria-label={worst.text} />}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <TenantStatusBadge tenant={tenant} />
                              <span className="text-[9px] font-mono text-gray-400 truncate max-w-[140px]">#{tenant.id}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <p className="font-bold text-gray-900 dark:text-white truncate max-w-[180px]">{tenant.owner?.name || '—'}</p>
                        <p className="text-[10px] text-gray-400 truncate max-w-[180px]">{tenant.owner?.email || 'Sem responsável'}</p>
                      </td>
                      <td className="p-4"><PlanBadge tenant={tenant} /></td>
                      <td className="p-4 w-32"><UsageBar compact current={tenant.usersCount} limit={tenant.entitlements?.maxUsers} /></td>
                      <td className="p-4 w-32"><UsageBar compact current={tenant.assetsCount} limit={tenant.entitlements?.maxAssets} /></td>
                      <td className="p-4 text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">{relativeDays(tenant.lastActivity)}</td>
                      <td className="p-4 text-right tabular-nums font-black">{tenant.mrr ? brl.format(tenant.mrr) : '—'}</td>
                      <td className="p-4 pr-6" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          {!tenant.legacy && tenant.status !== 'cancelled' && (
                            <button
                              onClick={() => quickToggle(tenant)}
                              className={`p-2 rounded-xl border transition-all ${['active', 'trial'].includes(tenant.status) ? 'text-amber-500 border-amber-200/60 hover:bg-amber-50 dark:border-amber-900/60 dark:hover:bg-amber-950/30' : 'text-green-500 border-green-200/60 hover:bg-green-50 dark:border-green-900/60 dark:hover:bg-green-950/30'}`}
                              title={['active', 'trial'].includes(tenant.status) ? 'Suspender empresa' : 'Reativar empresa'}
                              aria-label={['active', 'trial'].includes(tenant.status) ? 'Suspender empresa' : 'Reativar empresa'}
                            >
                              {['active', 'trial'].includes(tenant.status) ? <Pause size={14} /> : <Play size={14} />}
                            </button>
                          )}
                          <button
                            onClick={() => setParam('empresa', tenant.id)}
                            className="px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:text-brand hover:border-brand/40 transition-all flex items-center gap-1 text-[10px] font-black uppercase"
                          >
                            Detalhes <ChevronRight size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <TenantDetailDrawer
          key={selected.id}
          tenant={selected}
          plans={plans}
          onClose={() => setParam('empresa', null)}
          onChanged={load}
        />
      )}
      {selectedId && !selected && snapshot && !loading && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 !mt-0 rounded-xl bg-slate-900 text-white px-4 py-3 text-xs font-bold shadow-xl flex items-center gap-3">
          Empresa "{selectedId}" não encontrada.
          <button onClick={() => setParam('empresa', null)} aria-label="Fechar aviso"><X size={14} /></button>
        </div>
      )}

      {/* PROVISIONAMENTO */}
      {showProvision && (
        <div className="fixed inset-0 !mt-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4" role="dialog" aria-modal="true" aria-label="Nova empresa">
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-3xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-black text-gray-900 dark:text-white">Nova empresa</h2>
              <button onClick={closeProvision} aria-label="Fechar" className="p-1 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-white"><X size={18} /></button>
            </div>

            {provisionError && (
              <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">{provisionError}</p>
            )}

            <form onSubmit={handleProvision} className="space-y-4">
              {[
                ['companyName', 'Razão social / nome fantasia', 'text', 'Ex: ACME Indústria', 'organization'],
                ['adminName', 'Nome do responsável (owner)', 'text', 'Nome completo', 'name'],
                ['email', 'E-mail de acesso do responsável', 'email', 'admin@empresa.com', 'off'],
                ['password', 'Senha inicial (mín. 8)', 'password', '••••••••', 'new-password'],
              ].map(([key, text, type, placeholder, autoComplete]) => (
                <div key={key}>
                  <label htmlFor={`prov-${key}`} className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">{text}</label>
                  <input
                    id={`prov-${key}`}
                    type={type}
                    required
                    minLength={key === 'password' ? 8 : undefined}
                    autoComplete={autoComplete}
                    value={provisionForm[key]}
                    onChange={(e) => setProvisionForm({ ...provisionForm, [key]: e.target.value })}
                    placeholder={placeholder}
                    className={fieldClass}
                  />
                </div>
              ))}
              <div>
                <label htmlFor="prov-plan" className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Plano</label>
                <select id="prov-plan" value={provisionForm.plan} onChange={(e) => setProvisionForm({ ...provisionForm, plan: e.target.value })} className={fieldClass}>
                  {Object.values(plans).map((p) => (
                    <option key={p.id} value={p.id}>{p.name} — {brl.format(Number(p.monthlyPrice) || 0)}/mês</option>
                  ))}
                </select>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                Limites e recursos sob medida podem ser ajustados logo depois, em Detalhes → Plano e limites.
              </p>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeProvision} className="flex-1 px-4 py-3 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-600 dark:text-gray-300 font-bold text-xs uppercase tracking-wider">Cancelar</button>
                <button type="submit" disabled={provisionLoading} className="flex-1 px-4 py-3 bg-brand text-white rounded-xl font-bold text-xs uppercase tracking-wider shadow-lg disabled:opacity-50">
                  {provisionLoading ? 'Criando...' : 'Criar empresa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TenantManager;
