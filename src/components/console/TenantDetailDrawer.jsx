// src/components/console/TenantDetailDrawer.jsx
// -----------------------------------------------------------------------------
// Visao 360 de uma empresa no console master: saude da conta, plano e ajustes
// individuais (limites, recursos, preco), identidade visual, membros e notas
// comerciais internas. Antes o master so conseguia trocar nome/plano/status.
// -----------------------------------------------------------------------------
import React, { useEffect, useId, useRef, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  AlertTriangle, Building2, CheckCircle, Copy, Info, KeyRound, Layers, Lock, NotebookPen, Palette, Pause, Play,
  Save, ShieldCheck, Users, X, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import {
  describeFirebaseError, getTenantBranding, getTenantInternal, loadPricingMatrix, regularizeLegacyTenant, saveTenantBranding,
  saveTenantInternal, updateTenant,
} from '../../services/tenantService';
import { DEFAULT_PRICING_MATRIX, FEATURES, isUserBlocked } from '../../utils/entitlements';
import { ROLE_LABELS } from '../../utils/permissions';
import { getNonShareableLogoNotice } from '../../utils/portalBranding';
import { safeCssColor, safeImageUrl } from '../../utils/sanitize';
import { captureFocusTarget, restoreFocusSafely, trapFocusWithin } from '../../utils/focusTrap';
import { isTopmostModal } from '../../utils/modalStack';
import { ALERT_STYLE, brl, relativeDays, tenantAlerts } from '../../utils/consoleMetrics';
import { PlanBadge, TenantStatusBadge, UsageBar } from './consoleUi';
import { NEXUS_DEFAULT_COLOR } from '../settings/settingsStyles';
import CustomPlanBuilder from '../plans/CustomPlanBuilder';

const TABS = [
  { id: 'overview', label: 'Visão geral', icon: Building2 },
  { id: 'plan', label: 'Plano & Contrato', icon: Layers },
  { id: 'brand', label: 'Identidade', icon: Palette },
  { id: 'members', label: 'Membros', icon: Users },
  { id: 'lgpd', label: 'LGPD & DPA', icon: ShieldCheck },
  { id: 'notes', label: 'Notas', icon: NotebookPen },
];

const input =
  'min-h-[44px] w-full px-3 py-2 bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 rounded-xl text-sm font-semibold text-slate-800 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 transition-colors hover:border-slate-300 dark:hover:border-zinc-700 active:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-zinc-900 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500';
const label = 'block text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider mb-1';

const toDate = (value) => (value?.toDate ? value.toDate() : null);

const TenantDetailDrawer = ({ tenant, plans, initialTab = 'overview', onClose, onChanged }) => {
  const { resetPassword } = useAuth();
  const [tab, setTab] = useState(initialTab);
  const [busy, setBusy] = useState(false);
  const [resettingEmail, setResettingEmail] = useState(null);
  const titleId = useId();
  const drawerRef = useRef(null);
  const closeBtnRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // --- Plano & limites ---
  const [plan, setPlan] = useState(tenant.plan ? String(tenant.plan).toLowerCase() : 'starter');
  const [pricingMatrix, setPricingMatrix] = useState(DEFAULT_PRICING_MATRIX);
  const [legacyOwner, setLegacyOwner] = useState(tenant.owner?.id || '');

  // --- Identidade e notas (carregadas sob demanda) ---
  const [brand, setBrand] = useState(null);
  const [notes, setNotes] = useState(null);
  const [confirmName, setConfirmName] = useState('');

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const container = drawerRef.current;
    previousFocusRef.current = captureFocusTarget(container);
    const raf = requestAnimationFrame(() => closeBtnRef.current?.focus());
    const onKey = (e) => {
      if (!isTopmostModal(container)) return;
      if (e.key === 'Escape') {
        if (busyRef.current) return;
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (e.key === 'Tab') {
        trapFocusWithin(e, container);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      restoreFocusSafely(previous, null, container);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (tab === 'plan') {
      loadPricingMatrix()
        .then((matrix) => {
          if (!cancelled) setPricingMatrix(matrix);
        })
        .catch(() => {});
    }
    if (tab === 'brand' && brand === null) {
      getTenantBranding(tenant.id)
        .then((data) => {
          if (cancelled) return;
          setBrand({
            companyName: data.companyName || tenant.companyName || '',
            logoUrl: data.logoUrl || '',
            primaryColor: data.primaryColor || '',
            supportEmail: data.supportEmail || '',
          });
        })
        .catch(() => {
          if (cancelled) return;
          setBrand({ companyName: tenant.companyName || '', logoUrl: '', primaryColor: '', supportEmail: '' });
        });
    }
    if (tab === 'notes' && notes === null) {
      getTenantInternal(tenant.id)
        .then((data) => {
          if (cancelled) return;
          setNotes({
            contactName: data.contactName || '',
            contactEmail: data.contactEmail || '',
            contactPhone: data.contactPhone || '',
            contractEnd: data.contractEnd || '',
            billingDay: data.billingDay || '',
            notes: data.notes || '',
          });
        })
        .catch(() => {
          if (cancelled) return;
          setNotes({ contactName: '', contactEmail: '', contactPhone: '', contractEnd: '', billingDay: '', notes: '' });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [tab, brand, notes, tenant.id, tenant.companyName]);

  const alerts = tenantAlerts(tenant);

  const run = async (fn, success) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
      if (isMountedRef.current) {
        toast.success(success);
      }
      await onChanged?.();
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) {
        toast.error(describeFirebaseError(error));
      }
      throw error;
    } finally {
      busyRef.current = false;
      if (isMountedRef.current) {
        setBusy(false);
      }
    }
  };

  const regularize = () =>
    run(
      () => regularizeLegacyTenant(tenant.id, { companyName: tenant.companyName || tenant.id, plan, ownerUid: legacyOwner || null }),
      'Cadastro regularizado. Plano e limites passam a valer.',
    );

  const setStatus = (status, message) => run(() => updateTenant(tenant.id, { status }), message);

  const saveBrand = async () => {
    if (!brand || busyRef.current) return;
    const color = brand.primaryColor ? safeCssColor(brand.primaryColor) : '';
    if (brand.primaryColor && !color) {
      toast.error('Cor inválida.');
      return;
    }
    if (brand.logoUrl && !safeImageUrl(brand.logoUrl)) {
      toast.error('URL do logotipo inválida (use https).');
      return;
    }
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
    if (!email || resettingEmail || busyRef.current) return;
    setResettingEmail(email);
    try {
      await resetPassword(email);
      if (isMountedRef.current) toast.success(`Link de redefinição enviado para ${email}.`);
    } catch (error) {
      if (isMountedRef.current) toast.error(describeFirebaseError(error, 'Erro ao enviar o e-mail.'));
    } finally {
      if (isMountedRef.current) setResettingEmail(null);
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

  return (
    <div
      ref={drawerRef}
      tabIndex={-1}
      className="fixed inset-0 z-[60] !mt-0 flex justify-end overscroll-contain animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => { if (!busy) onClose?.(); }} aria-hidden="true" />
      <aside className="relative h-full w-full max-w-2xl bg-slate-50 dark:bg-[#09090b] shadow-2xl flex flex-col border-l border-slate-200 dark:border-zinc-800 overscroll-contain">
        {/* Cabecalho */}
        <header className="bg-white dark:bg-[#111113] border-b border-slate-200 dark:border-zinc-800 px-6 pt-6 pb-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-2xl bg-brand/10 text-brand-aa flex items-center justify-center font-black text-lg shrink-0">
                {(tenant.companyName || tenant.id).substring(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h2 id={titleId} className="text-xl font-black text-slate-900 dark:text-[#fafafa] truncate">
                  {tenant.companyName || 'Empresa sem nome'}
                </h2>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <button
                    type="button"
                    onClick={copyId}
                    className="min-h-[44px] px-2 -ml-2 rounded-lg text-xs font-mono text-slate-500 dark:text-zinc-400 hover:text-brand-aa flex items-center gap-1.5 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    title="Copiar ID"
                  >
                    <span>#{tenant.id}</span>
                    <Copy size={12} aria-hidden="true" />
                  </button>
                  <PlanBadge tenant={tenant} />
                  <TenantStatusBadge tenant={tenant} />
                </div>
              </div>
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              disabled={busy}
              onClick={() => { if (!busy) onClose?.(); }}
              aria-label="Fechar detalhes da empresa"
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full text-slate-400 dark:text-zinc-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-zinc-800 dark:hover:text-[#fafafa] transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>

          <nav className="flex gap-1 mt-4 overflow-x-auto scrollbar-hide" role="tablist">
            {TABS.map(({ id, label: text, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`min-h-[44px] flex items-center gap-1.5 px-3 py-2.5 text-xs font-black uppercase tracking-wider border-b-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  tab === id
                    ? 'border-brand text-brand-aa'
                    : 'border-transparent text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'
                }`}
              >
                <Icon size={14} aria-hidden="true" /> {text}
              </button>
            ))}
          </nav>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar p-6 space-y-5">
          {/* ------------------------------------------------ VISAO GERAL */}
          {tab === 'overview' && (
            <>
              {alerts.length > 0 && (
                <ul className="space-y-2">
                  {alerts.map((a, i) => (
                    <li key={i} className={`rounded-2xl border px-4 py-3 text-xs font-bold flex items-start gap-2 ${ALERT_STYLE[a.level]}`}>
                      <AlertTriangle size={14} aria-hidden="true" className="shrink-0 mt-0.5" /> {a.text}
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
                  <div key={k} className="rounded-2xl bg-white dark:bg-[#111113] border border-slate-100 dark:border-zinc-800 p-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">{k}</p>
                    <p className="mt-1 text-sm font-black text-slate-900 dark:text-[#fafafa] truncate tabular-nums">{v}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white dark:bg-[#111113] border border-slate-100 dark:border-zinc-800 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-2">Ativos</p>
                  <UsageBar current={tenant.assetsCount} limit={tenant.entitlements?.maxAssets} />
                </div>
                <div className="rounded-2xl bg-white dark:bg-[#111113] border border-slate-100 dark:border-zinc-800 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-2">Usuários</p>
                  <UsageBar current={tenant.usersCount} limit={tenant.entitlements?.maxUsers} />
                </div>
              </div>

              <div className="rounded-2xl bg-white dark:bg-[#111113] border border-slate-100 dark:border-zinc-800 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-3">Recursos liberados</p>
                <ul className="grid grid-cols-2 gap-2">
                  {FEATURES.map((f) => {
                    const on = tenant.entitlements?.features?.[f.id] !== false;
                    return (
                      <li key={f.id} className={`flex items-center gap-2 text-xs font-bold ${on ? 'text-slate-700 dark:text-zinc-200' : 'text-slate-500 dark:text-zinc-400'}`}>
                        {on ? <CheckCircle size={13} aria-hidden="true" className="text-emerald-500" /> : <XCircle size={13} aria-hidden="true" />} {f.label}
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Acoes de status */}
              {!tenant.legacy && (
                <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-4 space-y-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">Status da conta</p>
                  <div className="flex flex-wrap gap-2">
                    {tenant.status === 'active' || tenant.status === 'trial' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setStatus('suspended', 'Empresa suspensa: o acesso foi bloqueado.').catch(() => {})}
                        className="min-h-[44px] px-4 py-2 rounded-xl border border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300 text-xs font-black uppercase flex items-center gap-1.5 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Pause size={14} aria-hidden="true" /> Suspender acesso
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setStatus('active', 'Empresa reativada.').catch(() => {})}
                        className="min-h-[44px] px-4 py-2 rounded-xl border border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300 text-xs font-black uppercase flex items-center gap-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Play size={14} aria-hidden="true" /> Reativar conta
                      </button>
                    )}
                    {tenant.status === 'trial' ? null : (
                      tenant.status === 'active' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setStatus('trial', 'Conta marcada como teste.').catch(() => {})}
                          className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 text-xs font-black uppercase hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Marcar como teste
                        </button>
                      )
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-zinc-400">
                    Suspensa ou encerrada, a empresa perde o acesso aos dados (garantido pelas regras do Firestore) e o agente para de enviar inventário. Os dados são preservados.
                  </p>

                  {tenant.status !== 'cancelled' && (
                    <div className="pt-3 border-t border-slate-100 dark:border-zinc-800 space-y-2">
                      <p className="text-xs font-bold uppercase tracking-wider text-rose-500">Encerrar conta</p>
                      <label htmlFor="tenant-confirm-name" className="block text-xs text-slate-500 dark:text-zinc-400">
                        Digite o nome da empresa para confirmar. É reversível pelo botão "Reativar conta".
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="tenant-confirm-name"
                          name="confirmName"
                          value={confirmName}
                          onChange={(e) => setConfirmName(e.target.value)}
                          placeholder={tenant.companyName || tenant.id}
                          className={input}
                        />
                        <button
                          type="button"
                          disabled={busy || confirmName.trim() !== (tenant.companyName || tenant.id)}
                          onClick={() => setStatus('cancelled', 'Conta encerrada.').then(() => {
                            if (isMountedRef.current) setConfirmName('');
                          }).catch(() => {})}
                          className="min-h-[44px] px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black uppercase disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
                      <label htmlFor="legacy-plan-select" className={label}>Plano</label>
                      <select id="legacy-plan-select" name="plan" value={plan} onChange={(e) => setPlan(e.target.value)} className={input}>
                        {Object.values(plans).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="legacy-owner-select" className={label}>Proprietário</label>
                      <select id="legacy-owner-select" name="legacyOwner" value={legacyOwner} onChange={(e) => setLegacyOwner(e.target.value)} className={input}>
                        <option value="">—</option>
                        {tenant.members.map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
                      </select>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => regularize().catch(() => {})}
                    className="min-h-[44px] px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-black uppercase flex items-center gap-2 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Save size={14} aria-hidden="true" /> Regularizar cadastro
                  </button>
                </div>
              ) : (
                <CustomPlanBuilder
                  key={`${tenant.id}-${tenant.plan || 'starter'}-${JSON.stringify(tenant.overrides || {})}`}
                  mode="master"
                  compact
                  plans={plans}
                  pricing={pricingMatrix}
                  initialPlanId={tenant.plan || 'starter'}
                  initialOverrides={tenant.overrides || {}}
                  initialCustomContract={tenant.customContract || {}}
                  currentEntitlements={tenant.entitlements}
                  usage={{ assets: tenant.assetsCount ?? 0, users: tenant.usersCount ?? 0 }}
                  saving={busy}
                  onApplyContract={(payload) => run(() => updateTenant(tenant.id, payload), 'Contrato e ajustes salvos.')}
                  onResetToPlan={() => run(() => updateTenant(tenant.id, { plan: tenant.plan || 'starter', overrides: {}, customContract: {} }), 'Empresa restaurada para o plano padrão.').catch(() => {})}
                />
              )}
            </>
          )}

          {/* ------------------------------------------------ IDENTIDADE */}
          {tab === 'brand' && (
            brand === null ? (
              <p role="status" className="text-sm text-slate-500 dark:text-zinc-400">Carregando…</p>
            ) : (
              <div className="rounded-2xl bg-white dark:bg-[#111113] border border-slate-100 dark:border-zinc-800 p-5 space-y-4">
                <p className="text-xs text-slate-500 dark:text-zinc-400">
                  Ajuste a identidade em nome do cliente (ex.: durante a implantação). O proprietário também pode alterar em Configurações.
                </p>
                <div>
                  <label className={label} htmlFor="brand-name">Nome exibido</label>
                  <input id="brand-name" name="companyName" value={brand.companyName} onChange={(e) => setBrand({ ...brand, companyName: e.target.value })} className={input} />
                </div>
                <div>
                  <label className={label} htmlFor="brand-logo">URL do logotipo</label>
                  <input id="brand-logo" name="logoUrl" value={brand.logoUrl} onChange={(e) => setBrand({ ...brand, logoUrl: e.target.value })} placeholder="https://…" className={input} />
                  {getNonShareableLogoNotice(brand.logoUrl) && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-600 dark:text-zinc-400">
                      <Info size={14} className="shrink-0 mt-0.5 text-brand-aa" aria-hidden="true" />
                      <span>{getNonShareableLogoNotice(brand.logoUrl)}</span>
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={label} htmlFor="brand-color">Cor da marca</label>
                    <div className="flex gap-2">
                      <input
                        id="brand-color-picker"
                        name="primaryColorPicker"
                        type="color"
                        aria-label="Seletor de cor"
                        value={/^#[0-9a-f]{6}$/i.test(brand.primaryColor) ? brand.primaryColor : NEXUS_DEFAULT_COLOR}
                        onChange={(e) => setBrand({ ...brand, primaryColor: e.target.value })}
                        className="h-11 min-h-[44px] w-12 rounded-lg border border-slate-200 dark:border-zinc-800 dark:bg-[#111113] bg-transparent p-1 cursor-pointer hover:border-slate-300 dark:hover:border-zinc-700 active:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed aria-[invalid=true]:border-rose-500"
                      />
                      <input
                        id="brand-color"
                        name="primaryColor"
                        value={brand.primaryColor}
                        onChange={(e) => setBrand({ ...brand, primaryColor: e.target.value })}
                        placeholder={NEXUS_DEFAULT_COLOR}
                        className={`${input} font-mono`}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={label} htmlFor="brand-support">E-mail de suporte</label>
                    <input id="brand-support" name="supportEmail" type="email" value={brand.supportEmail} onChange={(e) => setBrand({ ...brand, supportEmail: e.target.value })} className={input} />
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-slate-100 dark:border-zinc-800 p-3">
                  {safeImageUrl(brand.logoUrl) ? (
                    <img src={safeImageUrl(brand.logoUrl)} alt="" className="h-9 w-9 object-contain" />
                  ) : (
                    <div className="h-9 w-9 rounded-lg flex items-center justify-center text-white font-black" style={{ backgroundColor: safeCssColor(brand.primaryColor) || NEXUS_DEFAULT_COLOR }}>
                      {(brand.companyName || 'E').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="font-black text-slate-900 dark:text-[#fafafa]">{brand.companyName || 'Empresa'}</span>
                  <span className="ml-auto px-3 py-1.5 rounded-lg text-white text-xs font-bold" style={{ backgroundColor: safeCssColor(brand.primaryColor) || NEXUS_DEFAULT_COLOR }}>Botão</span>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => saveBrand().catch(() => {})}
                    className="min-h-[44px] px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-black uppercase flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <Save size={14} aria-hidden="true" /> Salvar identidade
                  </button>
                </div>
              </div>
            )
          )}

          {/* ------------------------------------------------ MEMBROS */}
          {tab === 'members' && (
            <div className="rounded-2xl bg-white dark:bg-[#111113] border border-slate-100 dark:border-zinc-800 divide-y divide-slate-100 dark:divide-zinc-800">
              {tenant.members.length === 0 && <p className="p-6 text-sm text-slate-500 dark:text-zinc-400 text-center">Nenhum usuário vinculado.</p>}
              {tenant.members.map((m) => {
                const blocked = isUserBlocked(m.status);
                return (
                  <div key={m.id} className="p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-brand/10 text-brand-aa flex items-center justify-center font-black shrink-0">
                      {(m.name || m.email || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-900 dark:text-[#fafafa] truncate">
                        {m.name || 'Sem nome'} {blocked && <span className="ml-1 text-xs font-black uppercase text-amber-600 dark:text-amber-400">Suspenso</span>}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-zinc-400 truncate tabular-nums">{m.email} · {ROLE_LABELS[m.role] || m.role} · acesso {relativeDays(toDate(m.lastLoginAt))}</p>
                    </div>
                    <button
                      type="button"
                      disabled={busy || Boolean(resettingEmail)}
                      onClick={() => sendReset(m.email)}
                      title="Enviar redefinição de senha"
                      aria-label={`Enviar redefinição de senha para ${m.name || m.email}`}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 hover:text-brand-aa hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <KeyRound size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => toggleMember(m).catch(() => {})}
                      title={blocked ? 'Reativar usuário' : 'Suspender usuário'}
                      aria-label={blocked ? `Reativar ${m.name || m.email}` : `Suspender ${m.name || m.email}`}
                      className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed ${
                        blocked
                          ? 'border-emerald-200 text-emerald-600 dark:border-emerald-900 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                          : 'border-amber-200 text-amber-600 dark:border-amber-900 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                      }`}
                    >
                      {blocked ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* ------------------------------------------------ LGPD & DPA */}
          {tab === 'lgpd' && (
            <div className="rounded-2xl bg-white dark:bg-[#111113] border border-slate-100 dark:border-zinc-800 p-5 space-y-5">
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100 dark:border-zinc-800">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-[#fafafa] text-sm flex items-center gap-2">
                    <ShieldCheck size={18} className="text-emerald-500" aria-hidden="true" /> Governança & Conformidade LGPD (Lei 13.709/2018)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                    Visão de controle para o proprietário da plataforma assegurando proteção jurídica e privacidade.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-mono text-xs font-bold shrink-0">
                  DPA Vigente
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="p-3.5 rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/60 space-y-1">
                  <span className="text-xs font-bold uppercase text-slate-500 dark:text-zinc-400">Base Legal Predominante</span>
                  <p className="text-xs font-bold text-slate-800 dark:text-zinc-200">
                    Art. 7º, V (Execução de Contrato CLT) & IX (Legítimo Interesse)
                  </p>
                  <p className="text-xs text-slate-500 dark:text-zinc-400">
                    Tratamento restrito à gestão patrimonial de ativos fornecidos para execução laboral.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/60 space-y-1">
                  <span className="text-xs font-bold uppercase text-slate-500 dark:text-zinc-400">Política Zero-Surveillance</span>
                  <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    Sem Monitoramento Invasivo
                  </p>
                  <p className="text-xs text-slate-500 dark:text-zinc-400">
                    Bloqueio técnico estrito de captura de tela, gravação de teclas ou inspeção de mensagens/arquivos pessoais.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/60 space-y-1">
                  <span className="text-xs font-bold uppercase text-slate-500 dark:text-zinc-400">Segurança Técnica (Art. 46)</span>
                  <p className="text-xs font-bold text-slate-800 dark:text-zinc-200">
                    Hash-Chain SHA-256 + HMAC CLT
                  </p>
                  <p className="text-xs text-slate-500 dark:text-zinc-400">
                    Logs imutáveis de custódia e selo criptográfico em termos CLT para garantia de não-repúdio.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/60 space-y-1">
                  <span className="text-xs font-bold uppercase text-slate-500 dark:text-zinc-400">Isolamento Multi-Tenant</span>
                  <p className="text-xs font-bold text-slate-800 dark:text-zinc-200">
                    Schemas Dedicados & RLS
                  </p>
                  <p className="text-xs text-slate-500 dark:text-zinc-400">
                    Segregação lógica nativa com tokens criptográficos assinados por inquilino.
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-sky-50/70 dark:bg-sky-950/25 border border-sky-200/70 dark:border-sky-800/40 text-xs text-sky-950 dark:text-sky-100 space-y-1">
                <span className="font-bold flex items-center gap-1.5 text-sky-950 dark:text-sky-100">
                  <ShieldCheck size={14} className="text-brand-aa" aria-hidden="true" /> Atendimento aos Direitos dos Titulares (Art. 18):
                </span>
                <p className="text-xs leading-relaxed text-sky-900 dark:text-sky-200">
                  Em caso de encerramento do contrato de trabalho de um colaborador, as senhas geradas e acessos ao Portal do Colaborador são revogáveis imediatamente pelo Console do Dono, preservando os registros de auditoria em conformidade com o prazo prescricional trabalhista (Art. 16, I da LGPD).
                </p>
              </div>
            </div>
          )}

          {/* ------------------------------------------------ NOTAS */}
          {tab === 'notes' && (
            notes === null ? (
              <p role="status" className="text-sm text-slate-500 dark:text-zinc-400">Carregando…</p>
            ) : (
              <div className="rounded-2xl bg-white dark:bg-[#111113] border border-slate-100 dark:border-zinc-800 p-5 space-y-4">
                <p className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-zinc-400">
                  <Lock size={12} aria-hidden="true" /> Visível apenas para o Nexus Master. O cliente nunca vê estas informações.
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
                      <input id={`note-${key}`} name={key} type={type} value={notes[key]} onChange={(e) => setNotes({ ...notes, [key]: e.target.value })} className={input} />
                    </div>
                  ))}
                </div>
                <div>
                  <label className={label} htmlFor="note-body">Observações</label>
                  <textarea id="note-body" name="notes" value={notes.notes} onChange={(e) => setNotes({ ...notes, notes: e.target.value })} className={`${input} h-40 resize-y`} placeholder="Histórico da negociação, combinados, pendências…" />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => saveNotes().catch(() => {})}
                    className="min-h-[44px] px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-black uppercase flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <Save size={14} aria-hidden="true" /> Salvar notas
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
