// src/components/console/TenantDetailDrawer.jsx
// -----------------------------------------------------------------------------
// Visao 360 de uma empresa no console master: saude da conta, plano e ajustes
// individuais (limites, recursos, preco), identidade visual, membros e notas
// comerciais internas. Antes o master so conseguia trocar nome/plano/status.
// -----------------------------------------------------------------------------
import React, { useEffect, useMemo, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  AlertTriangle, Building2, CheckCircle, Copy, KeyRound, Layers, Lock, NotebookPen, Palette, Pause, Play,
  RotateCcw, Save, Unlock, Users, X, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import {
  describeFirebaseError, getTenantBranding, getTenantInternal, regularizeLegacyTenant, saveTenantBranding,
  saveTenantInternal, updateTenant,
} from '../../services/tenantService';
import { FEATURES, UNLIMITED, isUnlimited, isUserBlocked, resolveEntitlements } from '../../utils/entitlements';
import { ROLE_LABELS } from '../../utils/permissions';
import { safeCssColor, safeImageUrl } from '../../utils/sanitize';
import { ALERT_STYLE, brl, relativeDays, tenantAlerts } from '../../utils/consoleMetrics';
import { PlanBadge, TenantStatusBadge, UsageBar } from './consoleUi';

const TABS = [
  { id: 'overview', label: 'Visão geral', icon: Building2 },
  { id: 'plan', label: 'Plano', icon: Layers },
  { id: 'brand', label: 'Identidade', icon: Palette },
  { id: 'members', label: 'Membros', icon: Users },
  { id: 'notes', label: 'Notas', icon: NotebookPen },
];

const input =
  'w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-gray-800 dark:text-gray-100 focus:outline-none focus:border-brand';
const label = 'block text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1';

const toDate = (value) => (value?.toDate ? value.toDate() : null);

// Valor de limite no formulario: '' = segue o plano; UNLIMITED = sem limite.
const LimitInput = ({ id, labelText, value, planValue, onChange }) => {
  const unlimited = value !== '' && isUnlimited(value);
  return (
    <div>
      <label htmlFor={id} className={label}>{labelText}</label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          min="0"
          disabled={unlimited}
          value={unlimited ? '' : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isUnlimited(planValue) ? 'Plano: ilimitado' : `Plano: ${planValue}`}
          className={`${input} disabled:opacity-50`}
        />
        <label className="flex items-center gap-1 text-[10px] font-black uppercase text-gray-500 whitespace-nowrap cursor-pointer">
          <input type="checkbox" checked={unlimited} onChange={(e) => onChange(e.target.checked ? UNLIMITED : '')} className="h-4 w-4 accent-[rgb(var(--color-brand-rgb))]" />
          Ilimitado
        </label>
      </div>
    </div>
  );
};

const TenantDetailDrawer = ({ tenant, plans, initialTab = 'overview', onClose, onChanged }) => {
  const { resetPassword } = useAuth();
  const [tab, setTab] = useState(initialTab);
  const [busy, setBusy] = useState(false);

  // --- Plano & limites ---
  const overrides = tenant.overrides || {};
  const [plan, setPlan] = useState(tenant.plan ? String(tenant.plan).toLowerCase() : 'starter');
  const [maxAssets, setMaxAssets] = useState(overrides.maxAssets ?? '');
  const [maxUsers, setMaxUsers] = useState(overrides.maxUsers ?? '');
  const [price, setPrice] = useState(overrides.monthlyPrice ?? '');
  const [features, setFeatures] = useState(overrides.features || {});
  const [legacyOwner, setLegacyOwner] = useState(tenant.owner?.id || '');

  // --- Identidade e notas (carregadas sob demanda) ---
  const [brand, setBrand] = useState(null);
  const [notes, setNotes] = useState(null);
  const [confirmName, setConfirmName] = useState('');

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (tab === 'brand' && brand === null) {
      getTenantBranding(tenant.id)
        .then((data) => setBrand({
          companyName: data.companyName || tenant.companyName || '',
          logoUrl: data.logoUrl || '',
          primaryColor: data.primaryColor || '',
          supportEmail: data.supportEmail || '',
        }))
        .catch(() => setBrand({ companyName: tenant.companyName || '', logoUrl: '', primaryColor: '', supportEmail: '' }));
    }
    if (tab === 'notes' && notes === null) {
      getTenantInternal(tenant.id)
        .then((data) => setNotes({
          contactName: data.contactName || '',
          contactEmail: data.contactEmail || '',
          contactPhone: data.contactPhone || '',
          contractEnd: data.contractEnd || '',
          billingDay: data.billingDay || '',
          notes: data.notes || '',
        }))
        .catch(() => setNotes({ contactName: '', contactEmail: '', contactPhone: '', contractEnd: '', billingDay: '', notes: '' }));
    }
  }, [tab, brand, notes, tenant.id, tenant.companyName]);

  const draftOverrides = useMemo(() => {
    const clean = {};
    if (maxAssets !== '' && maxAssets !== null) clean.maxAssets = Number(maxAssets);
    if (maxUsers !== '' && maxUsers !== null) clean.maxUsers = Number(maxUsers);
    if (price !== '' && price !== null && Number.isFinite(Number(price))) clean.monthlyPrice = Number(price);
    const featureOverrides = Object.fromEntries(Object.entries(features).filter(([, v]) => typeof v === 'boolean'));
    if (Object.keys(featureOverrides).length) clean.features = featureOverrides;
    return clean;
  }, [maxAssets, maxUsers, price, features]);

  const planDoc = plans[plan];
  const preview = resolveEntitlements({ tenant: { plan, overrides: draftOverrides }, plan: planDoc });
  const planDefaults = resolveEntitlements({ tenant: { plan }, plan: planDoc });
  const alerts = tenantAlerts(tenant);

  const run = async (fn, success) => {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      await onChanged?.();
    } catch (error) {
      console.error(error);
      toast.error(describeFirebaseError(error));
    } finally {
      setBusy(false);
    }
  };

  const savePlan = () => run(() => updateTenant(tenant.id, { plan, overrides: draftOverrides }), 'Plano e ajustes salvos.');

  const regularize = () =>
    run(
      () => regularizeLegacyTenant(tenant.id, { companyName: tenant.companyName || tenant.id, plan, ownerUid: legacyOwner || null }),
      'Cadastro regularizado. Plano e limites passam a valer.',
    );

  const setStatus = (status, message) => run(() => updateTenant(tenant.id, { status }), message);

  const saveBrand = () => {
    const color = brand.primaryColor ? safeCssColor(brand.primaryColor) : '';
    if (brand.primaryColor && !color) return toast.error('Cor inválida.');
    if (brand.logoUrl && !safeImageUrl(brand.logoUrl)) return toast.error('URL do logotipo inválida (use https).');
    return run(async () => {
      await saveTenantBranding(tenant.id, {
        companyName: brand.companyName.trim(),
        logoUrl: brand.logoUrl.trim(),
        primaryColor: color || '',
        supportEmail: brand.supportEmail.trim(),
      });
      if (!tenant.legacy && brand.companyName.trim()) await updateTenant(tenant.id, { companyName: brand.companyName.trim() });
    }, 'Identidade da empresa atualizada.');
  };

  const saveNotes = () => run(() => saveTenantInternal(tenant.id, notes), 'Notas internas salvas.');

  const toggleMember = (member) => {
    const suspend = !isUserBlocked(member.status);
    return run(
      () => updateDoc(doc(db, 'users', member.id), { status: suspend ? 'suspended' : 'active', updatedAt: serverTimestamp() }),
      suspend ? 'Usuário suspenso.' : 'Usuário reativado.',
    );
  };

  const sendReset = async (email) => {
    try {
      await resetPassword(email);
      toast.success(`Link de redefinição enviado para ${email}.`);
    } catch (error) {
      toast.error(describeFirebaseError(error, 'Erro ao enviar o e-mail.'));
    }
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(tenant.id);
      toast.success('ID copiado.');
    } catch {
      toast.error('Não foi possível copiar.');
    }
  };

  const featureState = (id) => (typeof features[id] === 'boolean' ? (features[id] ? 'on' : 'off') : 'plan');
  const setFeatureState = (id, state) =>
    setFeatures((prev) => {
      const next = { ...prev };
      if (state === 'plan') delete next[id];
      else next[id] = state === 'on';
      return next;
    });

  return (
    <div className="fixed inset-0 z-[60] !mt-0 flex justify-end" role="dialog" aria-modal="true" aria-label={`Empresa ${tenant.companyName || tenant.id}`}>
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <aside className="relative h-full w-full max-w-2xl bg-slate-50 dark:bg-slate-950 shadow-2xl flex flex-col animate-[fadeIn_0.2s_ease-out]">
        {/* Cabecalho */}
        <header className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 px-6 pt-6 pb-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-2xl bg-brand/10 text-brand flex items-center justify-center font-black text-lg shrink-0">
                {(tenant.companyName || tenant.id).substring(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-black text-gray-900 dark:text-white truncate">{tenant.companyName || 'Empresa sem nome'}</h2>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <button onClick={copyId} className="text-[10px] font-mono text-gray-400 hover:text-brand flex items-center gap-1" title="Copiar ID">
                    #{tenant.id} <Copy size={10} />
                  </button>
                  <PlanBadge tenant={tenant} />
                  <TenantStatusBadge tenant={tenant} />
                </div>
              </div>
            </div>
            <button onClick={onClose} aria-label="Fechar" className="p-2 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-slate-800 dark:hover:text-white">
              <X size={20} />
            </button>
          </div>

          <nav className="flex gap-1 mt-5 overflow-x-auto scrollbar-hide" role="tablist">
            {TABS.map(({ id, label: text, icon: Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-black uppercase tracking-wider border-b-2 whitespace-nowrap transition-colors ${tab === id ? 'border-brand text-brand' : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
              >
                <Icon size={14} /> {text}
              </button>
            ))}
          </nav>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-5">
          {/* ------------------------------------------------ VISAO GERAL */}
          {tab === 'overview' && (
            <>
              {alerts.length > 0 && (
                <ul className="space-y-2">
                  {alerts.map((a, i) => (
                    <li key={i} className={`rounded-2xl border px-4 py-3 text-xs font-bold flex items-start gap-2 ${ALERT_STYLE[a.level]}`}>
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {a.text}
                    </li>
                  ))}
                </ul>
              )}

              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Receita mensal', tenant.mrr ? brl.format(tenant.mrr) : '—'],
                  ['Criada', tenant.createdAtDate ? tenant.createdAtDate.toLocaleDateString('pt-BR') : '—'],
                  ['Último acesso', relativeDays(tenant.lastActivity)],
                  ['Responsável', tenant.owner ? `${tenant.owner.name || tenant.owner.email}` : 'Sem owner'],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{k}</p>
                    <p className="mt-1 text-sm font-black text-gray-900 dark:text-white truncate">{v}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Ativos</p>
                  <UsageBar current={tenant.assetsCount} limit={tenant.entitlements?.maxAssets} />
                </div>
                <div className="rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Usuários</p>
                  <UsageBar current={tenant.usersCount} limit={tenant.entitlements?.maxUsers} />
                </div>
              </div>

              <div className="rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Recursos liberados</p>
                <ul className="grid grid-cols-2 gap-2">
                  {FEATURES.map((f) => {
                    const on = tenant.entitlements?.features?.[f.id] !== false;
                    return (
                      <li key={f.id} className={`flex items-center gap-2 text-xs font-bold ${on ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400'}`}>
                        {on ? <CheckCircle size={13} className="text-green-500" /> : <XCircle size={13} />} {f.label}
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Acoes de status */}
              {!tenant.legacy && (
                <div className="rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Status da conta</p>
                  <div className="flex flex-wrap gap-2">
                    {tenant.status === 'active' || tenant.status === 'trial' ? (
                      <button disabled={busy} onClick={() => setStatus('suspended', 'Empresa suspensa: o acesso foi bloqueado.')} className="px-4 py-2 rounded-xl border border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300 text-xs font-black uppercase flex items-center gap-1.5 hover:bg-amber-50 dark:hover:bg-amber-950/40">
                        <Pause size={14} /> Suspender acesso
                      </button>
                    ) : (
                      <button disabled={busy} onClick={() => setStatus('active', 'Empresa reativada.')} className="px-4 py-2 rounded-xl border border-green-300 text-green-700 dark:border-green-800 dark:text-green-300 text-xs font-black uppercase flex items-center gap-1.5 hover:bg-green-50 dark:hover:bg-green-950/40">
                        <Play size={14} /> Reativar conta
                      </button>
                    )}
                    {tenant.status === 'trial' ? null : (
                      tenant.status === 'active' && (
                        <button disabled={busy} onClick={() => setStatus('trial', 'Conta marcada como teste.')} className="px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 text-xs font-black uppercase">
                          Marcar como teste
                        </button>
                      )
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    Suspensa ou encerrada, a empresa perde o acesso aos dados (garantido pelas regras do Firestore) e o agente para de enviar inventário. Os dados são preservados.
                  </p>

                  {tenant.status !== 'cancelled' && (
                    <div className="pt-3 border-t border-gray-100 dark:border-slate-800 space-y-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-rose-500">Encerrar conta</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">Digite o nome da empresa para confirmar. É reversível pelo botão "Reativar conta".</p>
                      <div className="flex gap-2">
                        <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={tenant.companyName || tenant.id} className={input} aria-label="Confirmar nome da empresa" />
                        <button
                          disabled={busy || confirmName.trim() !== (tenant.companyName || tenant.id)}
                          onClick={() => setStatus('cancelled', 'Conta encerrada.').then(() => setConfirmName(''))}
                          className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-black uppercase disabled:opacity-40 whitespace-nowrap"
                        >
                          Encerrar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ------------------------------------------------ PLANO */}
          {tab === 'plan' && (
            <>
              {tenant.legacy ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30 p-5 space-y-4">
                  <p className="text-sm font-black text-amber-900 dark:text-amber-200">Empresa legada, sem cadastro comercial</p>
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    Ela opera sem plano nem limites. Regularizar cria o cadastro em /tenants com o plano escolhido — nenhum dado da empresa é alterado.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={label}>Plano</label>
                      <select value={plan} onChange={(e) => setPlan(e.target.value)} className={input}>
                        {Object.values(plans).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={label}>Proprietário</label>
                      <select value={legacyOwner} onChange={(e) => setLegacyOwner(e.target.value)} className={input}>
                        <option value="">—</option>
                        {tenant.members.map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
                      </select>
                    </div>
                  </div>
                  <button disabled={busy} onClick={regularize} className="px-5 py-2.5 rounded-xl bg-amber-600 text-white text-xs font-black uppercase flex items-center gap-2">
                    <Save size={14} /> Regularizar cadastro
                  </button>
                </div>
              ) : (
                <>
                  <div className="rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-5 space-y-4">
                    <div>
                      <label className={label} htmlFor="tenant-plan">Plano comercial</label>
                      <select id="tenant-plan" value={plan} onChange={(e) => setPlan(e.target.value)} className={input}>
                        {Object.values(plans).map((p) => (
                          <option key={p.id} value={p.id}>{p.name} — {brl.format(Number(p.monthlyPrice) || 0)}/mês</option>
                        ))}
                      </select>
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      Campos em branco seguem o plano. Preencha só o que for negociado com esta empresa.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <LimitInput id="tenant-max-assets" labelText="Limite de ativos" value={maxAssets} planValue={planDoc?.maxAssets} onChange={setMaxAssets} />
                      <LimitInput id="tenant-max-users" labelText="Limite de usuários" value={maxUsers} planValue={planDoc?.maxUsers} onChange={setMaxUsers} />
                      <div>
                        <label className={label} htmlFor="tenant-price">Mensalidade negociada (R$)</label>
                        <input id="tenant-price" type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={`Plano: ${brl.format(Number(planDoc?.monthlyPrice) || 0)}`} className={input} />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-5">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Recursos desta empresa</p>
                    <ul className="divide-y divide-gray-100 dark:divide-slate-800">
                      {FEATURES.map((f) => {
                        const state = featureState(f.id);
                        const planOn = planDefaults.features[f.id];
                        return (
                          <li key={f.id} className="py-3 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{f.label}</p>
                              <p className="text-[11px] text-gray-500 dark:text-gray-400">{f.description}</p>
                            </div>
                            <div className="flex rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden shrink-0" role="radiogroup" aria-label={f.label}>
                              {[
                                ['plan', `Plano (${planOn ? 'sim' : 'não'})`],
                                ['on', <Unlock key="on" size={13} />],
                                ['off', <Lock key="off" size={13} />],
                              ].map(([value, content]) => (
                                <button
                                  key={value}
                                  role="radio"
                                  aria-checked={state === value}
                                  title={value === 'on' ? 'Liberar para esta empresa' : value === 'off' ? 'Bloquear para esta empresa' : 'Seguir o plano'}
                                  onClick={() => setFeatureState(f.id, value)}
                                  className={`px-2.5 py-1.5 text-[10px] font-black uppercase transition-colors ${state === value ? (value === 'off' ? 'bg-rose-600 text-white' : value === 'on' ? 'bg-green-600 text-white' : 'bg-slate-800 text-white dark:bg-white dark:text-slate-900') : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-800'}`}
                                >
                                  {content}
                                </button>
                              ))}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-brand/30 bg-brand/5 p-4 text-xs text-gray-700 dark:text-gray-200 space-y-1">
                    <p className="font-black uppercase tracking-widest text-[10px] text-brand">Resultado</p>
                    <p>
                      {preview.planName}: {preview.maxAssets === null ? 'ativos ilimitados' : `${preview.maxAssets.toLocaleString('pt-BR')} ativos`} ·{' '}
                      {preview.maxUsers === null ? 'usuários ilimitados' : `${preview.maxUsers} usuários`} · {brl.format(preview.monthlyPrice)}/mês
                    </p>
                    <p className="text-gray-500 dark:text-gray-400">
                      Uso atual: {tenant.assetsCount ?? '—'} ativos e {tenant.usersCount} usuários. A mudança vale no próximo acesso de cada usuário.
                    </p>
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => { setMaxAssets(''); setMaxUsers(''); setPrice(''); setFeatures({}); }}
                      className="px-4 py-2.5 rounded-xl text-xs font-black uppercase text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800 flex items-center gap-1.5"
                    >
                      <RotateCcw size={14} /> Seguir só o plano
                    </button>
                    <button disabled={busy} onClick={savePlan} className="px-5 py-2.5 rounded-xl bg-brand text-white text-xs font-black uppercase flex items-center gap-2 disabled:opacity-60">
                      <Save size={14} /> Salvar plano
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ------------------------------------------------ IDENTIDADE */}
          {tab === 'brand' && (
            brand === null ? (
              <p className="text-sm text-gray-400">Carregando...</p>
            ) : (
              <div className="rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-5 space-y-4">
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  Ajuste a identidade em nome do cliente (ex.: durante a implantação). O proprietário também pode alterar em Configurações.
                </p>
                <div>
                  <label className={label} htmlFor="brand-name">Nome exibido</label>
                  <input id="brand-name" value={brand.companyName} onChange={(e) => setBrand({ ...brand, companyName: e.target.value })} className={input} />
                </div>
                <div>
                  <label className={label} htmlFor="brand-logo">URL do logotipo</label>
                  <input id="brand-logo" value={brand.logoUrl} onChange={(e) => setBrand({ ...brand, logoUrl: e.target.value })} placeholder="https://..." className={input} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={label} htmlFor="brand-color">Cor da marca</label>
                    <div className="flex gap-2">
                      <input type="color" aria-label="Seletor de cor" value={/^#[0-9a-f]{6}$/i.test(brand.primaryColor) ? brand.primaryColor : '#4f46e5'} onChange={(e) => setBrand({ ...brand, primaryColor: e.target.value })} className="h-10 w-12 rounded-lg border border-gray-200 dark:border-slate-700 bg-transparent p-1" />
                      <input id="brand-color" value={brand.primaryColor} onChange={(e) => setBrand({ ...brand, primaryColor: e.target.value })} placeholder="#4F46E5" className={`${input} font-mono`} />
                    </div>
                  </div>
                  <div>
                    <label className={label} htmlFor="brand-support">E-mail de suporte</label>
                    <input id="brand-support" type="email" value={brand.supportEmail} onChange={(e) => setBrand({ ...brand, supportEmail: e.target.value })} className={input} />
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-gray-100 dark:border-slate-800 p-3">
                  {safeImageUrl(brand.logoUrl) ? (
                    <img src={safeImageUrl(brand.logoUrl)} alt="" className="h-9 w-9 object-contain" />
                  ) : (
                    <div className="h-9 w-9 rounded-lg flex items-center justify-center text-white font-black" style={{ backgroundColor: safeCssColor(brand.primaryColor) || '#4F46E5' }}>
                      {(brand.companyName || 'E').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="font-black text-gray-900 dark:text-white">{brand.companyName || 'Empresa'}</span>
                  <span className="ml-auto px-3 py-1.5 rounded-lg text-white text-xs font-bold" style={{ backgroundColor: safeCssColor(brand.primaryColor) || '#4F46E5' }}>Botão</span>
                </div>
                <div className="flex justify-end">
                  <button disabled={busy} onClick={saveBrand} className="px-5 py-2.5 rounded-xl bg-brand text-white text-xs font-black uppercase flex items-center gap-2 disabled:opacity-60">
                    <Save size={14} /> Salvar identidade
                  </button>
                </div>
              </div>
            )
          )}

          {/* ------------------------------------------------ MEMBROS */}
          {tab === 'members' && (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 divide-y divide-gray-100 dark:divide-slate-800">
              {tenant.members.length === 0 && <p className="p-6 text-sm text-gray-400 text-center">Nenhum usuário vinculado.</p>}
              {tenant.members.map((m) => {
                const blocked = isUserBlocked(m.status);
                return (
                  <div key={m.id} className="p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-brand/10 text-brand flex items-center justify-center font-black shrink-0">
                      {(m.name || m.email || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-gray-900 dark:text-white truncate">
                        {m.name || 'Sem nome'} {blocked && <span className="ml-1 text-[9px] font-black uppercase text-amber-600">Suspenso</span>}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{m.email} · {ROLE_LABELS[m.role] || m.role} · acesso {relativeDays(toDate(m.lastLoginAt))}</p>
                    </div>
                    <button onClick={() => sendReset(m.email)} title="Enviar redefinição de senha" aria-label="Enviar redefinição de senha" className="p-2 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-500 hover:text-brand">
                      <KeyRound size={14} />
                    </button>
                    <button disabled={busy} onClick={() => toggleMember(m)} title={blocked ? 'Reativar usuário' : 'Suspender usuário'} aria-label={blocked ? 'Reativar usuário' : 'Suspender usuário'} className={`p-2 rounded-lg border ${blocked ? 'border-green-200 text-green-600 dark:border-green-900' : 'border-amber-200 text-amber-600 dark:border-amber-900'}`}>
                      {blocked ? <Play size={14} /> : <Pause size={14} />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* ------------------------------------------------ NOTAS */}
          {tab === 'notes' && (
            notes === null ? (
              <p className="text-sm text-gray-400">Carregando...</p>
            ) : (
              <div className="rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-5 space-y-4">
                <p className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500 dark:text-gray-400">
                  <Lock size={12} /> Visível apenas para o Nexus Master. O cliente nunca vê estas informações.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    ['contactName', 'Contato comercial', 'text'],
                    ['contactEmail', 'E-mail do contato', 'email'],
                    ['contactPhone', 'Telefone / WhatsApp', 'tel'],
                    ['billingDay', 'Dia de cobrança', 'number'],
                    ['contractEnd', 'Fim do contrato', 'date'],
                  ].map(([key, text, type]) => (
                    <div key={key}>
                      <label className={label} htmlFor={`note-${key}`}>{text}</label>
                      <input id={`note-${key}`} type={type} value={notes[key]} onChange={(e) => setNotes({ ...notes, [key]: e.target.value })} className={input} />
                    </div>
                  ))}
                </div>
                <div>
                  <label className={label} htmlFor="note-body">Observações</label>
                  <textarea id="note-body" value={notes.notes} onChange={(e) => setNotes({ ...notes, notes: e.target.value })} className={`${input} h-40 resize-y`} placeholder="Histórico da negociação, combinados, pendências..." />
                </div>
                <div className="flex justify-end">
                  <button disabled={busy} onClick={saveNotes} className="px-5 py-2.5 rounded-xl bg-brand text-white text-xs font-black uppercase flex items-center gap-2 disabled:opacity-60">
                    <Save size={14} /> Salvar notas
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      </aside>
    </div>
  );
};

export default TenantDetailDrawer;
