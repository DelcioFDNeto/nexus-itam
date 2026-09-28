// src/pages/NexusPlansManager.jsx
// -----------------------------------------------------------------------------
// Planos comerciais (console Nexus Master).
//
// Os limites e recursos daqui agora VALEM: o app de cada empresa le o plano
// efetivo via utils/entitlements (antes nenhuma tela consultava os planos).
// Tambem deixou de gravar documentos durante a simples leitura da pagina e de
// salvar NaN quando um campo numerico ficava vazio.
// -----------------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { CheckCircle, Edit3, Layers, RefreshCcw, Save, Server, Users, X, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '../services/firebase';
import { describeFirebaseError, loadPlans } from '../services/tenantService';
import { FEATURES, UNLIMITED, isUnlimited, resolveEntitlements } from '../utils/entitlements';
import { brl } from '../utils/consoleMetrics';

const fieldClass =
  'w-full px-3 py-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand text-sm font-semibold text-gray-900 dark:text-white disabled:opacity-50';

const featureValue = (plan, feature) =>
  plan.features?.[feature.id] ?? (feature.planKey ? plan[feature.planKey] : undefined) ?? true;

const NexusPlansManager = () => {
  const [plans, setPlans] = useState({});
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingPlan, setEditingPlan] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [loadedPlans, tenantsSnap] = await Promise.all([loadPlans(), getDocs(collection(db, 'tenants'))]);
      setPlans(loadedPlans);
      setTenants(tenantsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error('Erro ao carregar planos:', error);
      toast.error('Falha ao carregar os planos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Empresas e receita por plano (considera precos sob medida).
  const stats = useMemo(() => {
    const acc = {};
    tenants.forEach((t) => {
      if (!t.plan) return;
      const id = String(t.plan).toLowerCase();
      acc[id] = acc[id] || { count: 0, mrr: 0 };
      acc[id].count += 1;
      if (['active', 'trial'].includes(t.status || 'active')) {
        acc[id].mrr += resolveEntitlements({ tenant: t, plan: plans[id] }).monthlyPrice;
      }
    });
    return acc;
  }, [tenants, plans]);

  const openEdit = (plan) => {
    setEditingPlan(plan);
    setForm({
      name: plan.name || plan.id,
      monthlyPrice: plan.monthlyPrice ?? 0,
      maxAssets: isUnlimited(plan.maxAssets) ? UNLIMITED : plan.maxAssets,
      maxUsers: isUnlimited(plan.maxUsers) ? UNLIMITED : plan.maxUsers,
      features: Object.fromEntries(FEATURES.map((f) => [f.id, Boolean(featureValue(plan, f))])),
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const numbers = [
      ['Mensalidade', form.monthlyPrice],
      ['Máx. ativos', form.maxAssets],
      ['Máx. usuários', form.maxUsers],
    ];
    const invalid = numbers.find(([, v]) => v === '' || !Number.isFinite(Number(v)) || Number(v) < 0);
    if (invalid) {
      toast.error(`${invalid[0]}: informe um número válido.`);
      return;
    }

    const legacyFlags = Object.fromEntries(FEATURES.filter((f) => f.planKey).map((f) => [f.planKey, Boolean(form.features[f.id])]));
    const moduleFlags = Object.fromEntries(FEATURES.filter((f) => !f.planKey).map((f) => [f.id, Boolean(form.features[f.id])]));

    setSaving(true);
    try {
      await setDoc(
        doc(db, 'plans', editingPlan.id),
        {
          id: editingPlan.id,
          name: form.name.trim() || editingPlan.id,
          monthlyPrice: Number(form.monthlyPrice),
          maxAssets: Math.floor(Number(form.maxAssets)),
          maxUsers: Math.floor(Number(form.maxUsers)),
          ...legacyFlags,
          features: moduleFlags,
        },
        { merge: true },
      );
      toast.success(`Plano "${form.name}" atualizado. Vale no próximo acesso de cada usuário.`);
      setEditingPlan(null);
      load();
    } catch (error) {
      toast.error(describeFirebaseError(error, 'Erro ao salvar o plano.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading && Object.keys(plans).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <div className="w-12 h-12 border-4 border-brand/20 border-t-brand rounded-full animate-spin" />
        <p className="mt-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Carregando planos...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto pb-24 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden border border-white/5">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-4 bg-white/5 text-indigo-300 rounded-2xl border border-white/10"><Layers size={32} /></div>
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">Planos e limites</h1>
            <p className="text-slate-400 font-medium text-sm mt-1">Padrões comerciais. Ajustes de uma empresa específica ficam em Empresas → Detalhes.</p>
          </div>
        </div>
        <button onClick={load} aria-label="Recarregar" title="Recarregar" className="relative z-10 flex items-center justify-center w-12 h-12 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-all border border-white/10">
          <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {Object.values(plans).map((plan) => {
          const s = stats[plan.id] || { count: 0, mrr: 0 };
          const isEnterprise = plan.id === 'enterprise';
          return (
            <div
              key={plan.id}
              className={`bg-white dark:bg-slate-800 rounded-3xl border p-6 flex flex-col justify-between gap-6 ${isEnterprise ? 'border-amber-500/40 shadow-xl shadow-amber-900/5' : 'border-gray-100 dark:border-slate-700 shadow-sm'}`}
            >
              <div>
                <div className="flex justify-between items-start">
                  <span className={`px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${isEnterprise ? 'bg-amber-500/10 text-amber-600' : plan.id === 'pro' ? 'bg-purple-500/10 text-purple-600' : 'bg-slate-500/10 text-slate-500'}`}>
                    {plan.name}
                  </span>
                  <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">{s.count} {s.count === 1 ? 'empresa' : 'empresas'}</span>
                </div>
                <div className="flex items-baseline gap-1 mt-3">
                  <span className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">{brl.format(Number(plan.monthlyPrice) || 0)}</span>
                  <span className="text-xs text-gray-400 font-semibold">/ mês</span>
                </div>
                <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mt-1">Receita atual: {brl.format(s.mrr)}/mês</p>

                <hr className="border-gray-100 dark:border-slate-700 my-5" />

                <ul className="space-y-3 text-xs font-semibold text-gray-700 dark:text-slate-200">
                  <li className="flex items-center gap-3"><Server size={16} className="text-gray-400 shrink-0" /> Ativos: <strong className="text-gray-900 dark:text-white">{isUnlimited(plan.maxAssets) ? 'Ilimitado' : Number(plan.maxAssets).toLocaleString('pt-BR')}</strong></li>
                  <li className="flex items-center gap-3"><Users size={16} className="text-gray-400 shrink-0" /> Usuários: <strong className="text-gray-900 dark:text-white">{isUnlimited(plan.maxUsers) ? 'Ilimitado' : plan.maxUsers}</strong></li>
                  {FEATURES.map((f) => {
                    const on = Boolean(featureValue(plan, f));
                    return (
                      <li key={f.id} className={`flex items-center gap-3 ${on ? '' : 'text-gray-400 dark:text-gray-500 font-medium'}`}>
                        {on ? <CheckCircle size={16} className="text-green-500 shrink-0" /> : <XCircle size={16} className="text-gray-300 dark:text-slate-600 shrink-0" />}
                        {f.label}
                      </li>
                    );
                  })}
                </ul>
              </div>

              <button
                onClick={() => openEdit(plan)}
                className={`w-full py-3.5 flex items-center justify-center gap-2 rounded-2xl font-black text-xs uppercase tracking-wider transition-all border ${isEnterprise ? 'bg-amber-600 border-amber-600 text-white hover:bg-amber-700' : 'bg-white dark:bg-slate-900 text-gray-800 dark:text-slate-200 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'}`}
              >
                <Edit3 size={14} /> Editar plano
              </button>
            </div>
          );
        })}
      </div>

      {editingPlan && form && (
        <div className="fixed inset-0 !mt-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4" role="dialog" aria-modal="true" aria-label={`Editar ${editingPlan.name}`}>
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-black text-gray-900 dark:text-white">Editar plano</h2>
              <button onClick={() => setEditingPlan(null)} aria-label="Fechar" className="p-1 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-white"><X size={18} /></button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label htmlFor="plan-name" className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Nome comercial</label>
                <input id="plan-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className={fieldClass} />
              </div>
              <div>
                <label htmlFor="plan-price" className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Mensalidade (R$)</label>
                <input id="plan-price" type="number" step="0.01" min="0" value={form.monthlyPrice} onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })} required className={fieldClass} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  ['maxAssets', 'Máx. ativos'],
                  ['maxUsers', 'Máx. usuários'],
                ].map(([key, text]) => {
                  const unlimited = isUnlimited(form[key]) && form[key] !== '';
                  return (
                    <div key={key}>
                      <label htmlFor={`plan-${key}`} className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">{text}</label>
                      <input id={`plan-${key}`} type="number" min="0" disabled={unlimited} value={unlimited ? '' : form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={unlimited ? 'Ilimitado' : ''} className={fieldClass} />
                      <label className="mt-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase text-gray-500 cursor-pointer">
                        <input type="checkbox" checked={unlimited} onChange={(e) => setForm({ ...form, [key]: e.target.checked ? UNLIMITED : '' })} className="h-3.5 w-3.5" /> Ilimitado
                      </label>
                    </div>
                  );
                })}
              </div>

              <fieldset className="space-y-2.5 rounded-2xl p-4 border border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60">
                <legend className="px-1 text-[10px] font-black text-gray-400 uppercase tracking-wider">Recursos incluídos</legend>
                {FEATURES.map((f) => (
                  <label key={f.id} className="flex items-center justify-between gap-3 cursor-pointer">
                    <span className="text-xs font-bold text-gray-700 dark:text-gray-200">{f.label}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(form.features[f.id])}
                      onChange={(e) => setForm({ ...form, features: { ...form.features, [f.id]: e.target.checked } })}
                      className="h-4 w-4 cursor-pointer"
                    />
                  </label>
                ))}
              </fieldset>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setEditingPlan(null)} className="flex-1 px-4 py-3 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-600 dark:text-gray-300 font-bold text-xs uppercase tracking-wider">Cancelar</button>
                <button type="submit" disabled={saving} className="flex-1 px-4 py-3 bg-brand text-white rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60">
                  <Save size={14} /> {saving ? 'Salvando...' : 'Salvar plano'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default NexusPlansManager;
