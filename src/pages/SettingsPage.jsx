// src/pages/SettingsPage.jsx
// -----------------------------------------------------------------------------
// Configuracoes, divididas por assunto (Empresa, Operacao, Integracoes,
// Pessoal, Dados). Cada secao e um componente em components/settings/; esta
// pagina carrega /settings/{tenantId}, guarda as alteracoes de TODAS as secoes
// (trocar de secao nao perde o que foi digitado) e salva tudo de uma vez.
// -----------------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  AlertCircle, Building2, ChevronRight, Cpu, Database, Download, FileText, Layers, Lock, MapPin, Palette, RefreshCcw, Save, Settings, Smartphone, Tag, UserCog, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '../services/firebase';
import { describeFirebaseError } from '../services/tenantService';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../components/ConfirmDialog';
import { can } from '../utils/permissions';
import { hasFeature } from '../utils/entitlements';
import { safeCssColor, safeImageUrl } from '../utils/sanitize';
import { invalidateTenantSettings } from '../hooks/useTenantSettings';
import LocationManager from '../components/settings/LocationManager';
import CompanySection from '../components/settings/CompanySection';
import BrandingSection from '../components/settings/BrandingSection';
import ModulesSection from '../components/settings/ModulesSection';
import AssetCatalogSection from '../components/settings/AssetCatalogSection';
import DocumentsSection from '../components/settings/DocumentsSection';
import LabelsSection from '../components/settings/LabelsSection';
import AppearanceSection from '../components/settings/AppearanceSection';
import BackupSection from '../components/settings/BackupSection';
import AppSettingsSection from '../components/settings/AppSettingsSection';
import { buttonPrimaryClass, buttonSecondaryClass } from '../components/settings/settingsStyles';
import { Card, SectionHeader } from '../components/settings/settingsUi';

// Campos da empresa gravados em /settings/{tenantId}. Sem valores de outra
// empresa como padrao: antes toda empresa nova via "Délcio Farias" como gestor
// de TI e o e-mail de suporte da primeira cliente.
const EMPTY_CONFIG = {
  companyName: '',
  cnpj: '',
  itManager: '',
  supportEmail: '',
  labelFooter: '',
  termTitle: 'Termo de Responsabilidade',
  termClauses: '',
  termCity: '',
  termShowValue: false,
  termWitnesses: false,
  transferClauses: '',
  transferArrivalStatus: 'Disponível',
  transferAssignReceiver: false,
  termOverdueDays: 7,
  logoUrl: '',
  primaryColor: '',
  customFields: [],
  assetTypes: [],
  hiddenModules: [],
};
const EDITABLE_KEYS = Object.keys(EMPTY_CONFIG);

/**
 * Mapa das secoes. `keys`: campos do formulario daquela secao (marca a secao
 * com alteracao pendente). `to`: atalho para outra tela. `show`: quem ve.
 */
const NAV = [
  {
    group: 'Empresa',
    items: [
      { id: 'empresa', label: 'Empresa e plano', icon: Building2, keys: ['companyName', 'cnpj', 'itManager'] },
      { id: 'identidade', label: 'Identidade visual', icon: Palette, keys: ['logoUrl', 'primaryColor'] },
      { id: 'modulos', label: 'Módulos', icon: Layers, keys: ['hiddenModules'] },
    ],
  },
  {
    group: 'Operação',
    items: [
      { id: 'locais', label: 'Filiais e locais', icon: MapPin },
      { id: 'cadastro', label: 'Cadastro de ativos', icon: Database, keys: ['customFields', 'assetTypes'] },
      {
        id: 'documentos', label: 'Termos e documentos', icon: FileText,
        keys: ['termTitle', 'termClauses', 'termCity', 'termShowValue', 'termWitnesses', 'transferClauses', 'transferArrivalStatus', 'transferAssignReceiver', 'termOverdueDays'],
      },
      { id: 'etiquetas', label: 'Etiquetas', icon: Tag, keys: ['supportEmail', 'labelFooter'] },
    ],
  },
  {
    group: 'Integrações e acesso',
    items: [
      { id: 'agente', label: 'Agente ITAM', icon: Cpu, to: '/agent?aba=politicas', show: (u) => can(u, 'agent:manage') && hasFeature(u, 'agent') },
      { id: 'usuarios', label: 'Usuários e convites', icon: Users, to: '/users', show: (u) => can(u, 'users:manage') },
    ],
  },
  { group: 'Pessoal e Dispositivo', items: [{ id: 'aparencia', label: 'Minha aparência', icon: UserCog }, { id: 'app', label: 'Aplicativo & PWA', icon: Smartphone }] },
  {
    group: 'Dados',
    items: [{ id: 'backup', label: 'Backup e restauração', icon: Download, show: (u) => can(u, 'backup:create') || can(u, 'backup:restore') }],
  },
];

const ALL_ITEMS = NAV.flatMap((g) => g.items);

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const SettingsPage = () => {
  const { currentUser, refreshProfile } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const tenantId = currentUser?.tenantId;
  const canEdit = can(currentUser, 'settings:write');
  const whitelabel = hasFeature(currentUser, 'whitelabel');
  const [params, setParams] = useSearchParams();

  const nav = useMemo(
    () => NAV.map((g) => ({ ...g, items: g.items.filter((item) => !item.show || item.show(currentUser)) })).filter((g) => g.items.length),
    [currentUser],
  );
  const visibleIds = nav.flatMap((g) => g.items.filter((i) => !i.to).map((i) => i.id));
  const requestedSection = params.get('section') || params.get('secao');
  const section = visibleIds.includes(requestedSection) ? requestedSection : 'empresa';

  const [config, setConfig] = useState(EMPTY_CONFIG);
  const [savedConfig, setSavedConfig] = useState(EMPTY_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);

  const isMountedRef = useRef(true);
  const loadSeqRef = useRef(0);
  const loadedRef = useRef(false);
  const companyNameRef = useRef(currentUser?.companyName);
  companyNameRef.current = currentUser?.companyName;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadSettings = useCallback(async () => {
    if (!tenantId) {
      loadedRef.current = false;
      setLoaded(false);
      return;
    }
    const seq = ++loadSeqRef.current;
    setLoadError(null);
    if (!loadedRef.current) {
      setLoaded(false);
    }
    try {
      const snap = await getDoc(doc(db, 'settings', tenantId));
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;
      const data = snap.exists() ? snap.data() : {};
      const next = { ...EMPTY_CONFIG };
      EDITABLE_KEYS.forEach((key) => {
        if (data[key] !== undefined && data[key] !== null) {
          if (key === 'termOverdueDays' && data[key] === '') return;
          next[key] = data[key];
        }
      });
      if (!next.companyName) {
        next.companyName = companyNameRef.current && companyNameRef.current !== 'Nexus ITAM' ? companyNameRef.current : '';
      }
      loadedRef.current = true;
      setConfig(next);
      setSavedConfig(next);
      setLoaded(true);
    } catch (error) {
      console.error('Erro ao carregar configurações:', error);
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;
      setLoadError('Não foi possível carregar as configurações da empresa.');
      toast.error('Não foi possível carregar as configurações.');
    }
  }, [tenantId]);

  useEffect(() => {
    loadedRef.current = false;
    setLoaded(false);
    loadSettings();
  }, [loadSettings]);

  const dirtyKeys = useMemo(() => EDITABLE_KEYS.filter((key) => !sameValue(config[key], savedConfig[key])), [config, savedConfig]);
  const dirty = dirtyKeys.length > 0;
  const dirtySections = new Set(ALL_ITEMS.filter((item) => item.keys?.some((k) => dirtyKeys.includes(k))).map((item) => item.id));
  const set = (key, value) => setConfig((prev) => ({ ...prev, [key]: value }));

  const goTo = async (id, { skipConfirm = false } = {}) => {
    if (id === section) return;
    if (!skipConfirm && dirty) {
      const proceed = await confirm({
        title: 'Alterações não salvas',
        message: 'Você possui alterações não salvas nesta seção. Deseja trocar de seção agora? Suas edições continuam pendentes para salvar.',
        confirmLabel: 'Trocar de seção',
        cancelLabel: 'Continuar aqui',
      });
      if (!proceed) return;
    }
    setParams(id === 'empresa' ? {} : { section: id }, { replace: true });
  };

  const handleExternalLinkClick = async (event, to) => {
    if (!dirty) return;
    event.preventDefault();
    const proceed = await confirm({
      title: 'Sair sem salvar?',
      message: 'Você possui alterações não salvas nas configurações. Se sair agora, essas alterações serão perdidas.',
      confirmLabel: 'Sair sem salvar',
      cancelLabel: 'Continuar editando',
      danger: true,
    });
    if (proceed) navigate(to);
  };

  // Fechar ou recarregar a aba com alteracoes pendentes pede confirmacao.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const handleSave = async (e) => {
    e?.preventDefault();
    if (!tenantId || !canEdit || !dirty || saving) return;

    const color = config.primaryColor ? safeCssColor(config.primaryColor) : '';
    if (config.primaryColor && !color) {
      toast.error('Cor inválida. Use o seletor ou um código como #1E40AF.');
      goTo('identidade', { skipConfirm: true });
      return;
    }
    if (config.logoUrl && !safeImageUrl(config.logoUrl)) {
      toast.error('URL do logotipo inválida. Use um endereço https:// público.');
      goTo('identidade', { skipConfirm: true });
      return;
    }
    const trimmedEmail = String(config.supportEmail || '').trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast.error('E-mail de suporte inválido.');
      goTo('etiquetas', { skipConfirm: true });
      return;
    }

    const parsedOverdue = Number(config.termOverdueDays);
    const termOverdueDays =
      config.termOverdueDays === '' ||
      config.termOverdueDays === null ||
      config.termOverdueDays === undefined ||
      !Number.isFinite(parsedOverdue)
        ? 30
        : Math.min(90, Math.max(1, Math.round(parsedOverdue)));

    setSaving(true);
    try {
      const payload = {
        ...Object.fromEntries(EDITABLE_KEYS.map((key) => [key, config[key]])),
        companyName: config.companyName.trim(),
        supportEmail: trimmedEmail,
        termOverdueDays,
        primaryColor: color || '',
        customFields: (config.customFields || []).filter((cf) => cf.label?.trim()),
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'settings', tenantId), payload, { merge: true });
      invalidateTenantSettings(tenantId);

      // Mantem o nome no cadastro da empresa (visto pelo console master).
      if (payload.companyName && payload.companyName !== savedConfig.companyName) {
        await updateDoc(doc(db, 'tenants', tenantId), { companyName: payload.companyName, updatedAt: serverTimestamp() }).catch(() => {
          /* empresa legada sem cadastro em /tenants */
        });
      }

      const next = {
        ...config,
        companyName: payload.companyName,
        supportEmail: trimmedEmail,
        termOverdueDays,
        primaryColor: color || '',
        customFields: payload.customFields,
      };
      if (isMountedRef.current) {
        setConfig(next);
        setSavedConfig(next);
      }
      // Aplica logo, cor e modulos agora — antes so apareciam apos recarregar.
      await refreshProfile();
      if (isMountedRef.current) {
        toast.success('Configurações salvas e aplicadas.');
      }
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) {
        toast.error(describeFirebaseError(error, 'Erro ao salvar as configurações.'));
      }
    } finally {
      if (isMountedRef.current) {
        setSaving(false);
      }
    }
  };

  const formSection = ALL_ITEMS.find((item) => item.id === section)?.keys;
  const hasActiveForm = Boolean(formSection && loaded && !loadError);
  const sectionProps = { config, set, currentUser, whitelabel, disabled: !canEdit || saving };

  const renderSection = () => {
    switch (section) {
      case 'empresa': return <CompanySection {...sectionProps} />;
      case 'identidade': return <BrandingSection {...sectionProps} />;
      case 'modulos': return <ModulesSection {...sectionProps} />;
      case 'cadastro': return <AssetCatalogSection {...sectionProps} />;
      case 'documentos': return <DocumentsSection {...sectionProps} />;
      case 'etiquetas': return <LabelsSection {...sectionProps} />;
      case 'aparencia': return <AppearanceSection />;
      case 'app': return <AppSettingsSection />;
      case 'backup': return <BackupSection currentUser={currentUser} />;
      case 'locais':
        return (
          <div className="space-y-6">
            <SectionHeader icon={MapPin} title="Filiais e locais" description="Matriz, lojas e depósitos: usados nos seletores, nas transferências, na auditoria e pelo Agente ITAM (redes de cada loja)." />
            <Card icon={MapPin} title="Locais" subtitle="Alterações aqui são gravadas na hora">
              <LocationManager showHeader={false} />
            </Card>
          </div>
        );
      default: return null;
    }
  };

  return (
    <div className="max-w-6xl mx-auto pb-28">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-slate-900 dark:bg-[#111113] dark:border dark:border-zinc-800 text-white rounded-xl">
            <Settings size={26} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-[#fafafa]">Configurações</h1>
            <p className="text-sm text-slate-500 dark:text-zinc-400">{config.companyName || 'Sua empresa'}</p>
          </div>
        </div>
        {canEdit && (
          <button
            type={hasActiveForm ? 'submit' : 'button'}
            form={hasActiveForm ? 'settings-form' : undefined}
            onClick={hasActiveForm ? undefined : handleSave}
            disabled={saving || !dirty}
            className={`${buttonPrimaryClass} self-start md:self-auto min-h-[44px] shadow-sm`}
          >
            {saving ? <RefreshCcw size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
            {saving ? 'Salvando…' : dirty ? <span className="tabular-nums">Salvar alterações ({dirtySections.size})</span> : 'Tudo salvo'}
          </button>
        )}
      </div>

      {!canEdit && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          <Lock size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
          <p>Somente o proprietário da conta altera empresa, identidade visual, documentos e módulos. Você pode gerenciar os locais e a sua aparência pessoal.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-6 lg:gap-8">
        {/* Navegacao: lateral no desktop, faixa rolavel no celular */}
        <nav aria-label="Seções das configurações" className="lg:sticky lg:top-4 lg:self-start">
          <div className="flex lg:flex-col gap-1 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1 lg:pb-0">
            {nav.map((group) => (
              <div key={group.group} className="flex lg:flex-col gap-1 shrink-0 lg:shrink lg:mb-3">
                <p className="hidden lg:block px-3 pt-1 pb-1 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">{group.group}</p>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = section === item.id;
                  const className = `flex items-center gap-2.5 px-3 py-2.5 min-h-[44px] rounded-xl text-sm font-bold whitespace-nowrap transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                    active ? 'bg-brand text-brand-fg shadow-sm' : 'text-slate-700 dark:text-zinc-300 hover:bg-white dark:hover:bg-[#111113]'
                  }`;
                  return item.to ? (
                    <Link key={item.id} to={item.to} onClick={(e) => handleExternalLinkClick(e, item.to)} className={className}>
                      <Icon size={16} aria-hidden="true" /> <span className="flex-1">{item.label}</span> <ChevronRight size={14} className="opacity-50 hidden lg:block" aria-hidden="true" />
                    </Link>
                  ) : (
                    <button key={item.id} type="button" onClick={() => goTo(item.id)} aria-current={active ? 'page' : undefined} className={className}>
                      <Icon size={16} aria-hidden="true" /> <span className="flex-1 text-left">{item.label}</span>
                      {dirtySections.has(item.id) && <span className={`h-2 w-2 rounded-full ${active ? 'bg-brand-fg' : 'bg-amber-500'}`} aria-label="alterações não salvas" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>

        <div className="min-w-0">
          {loadError && formSection ? (
            <div role="alert" className="rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <AlertCircle size={20} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-bold text-rose-900 dark:text-rose-200">Erro ao carregar configurações</h2>
                  <p className="text-xs text-rose-700 dark:text-rose-300 mt-1">{loadError}</p>
                </div>
              </div>
              <button type="button" onClick={loadSettings} className={`${buttonSecondaryClass} min-h-[44px] shrink-0`}>
                <RefreshCcw size={15} aria-hidden="true" /> Tentar novamente
              </button>
            </div>
          ) : !loaded && formSection ? (
            <p role="status" className="py-16 text-center text-sm text-slate-500 dark:text-zinc-400">Carregando configurações…</p>
          ) : formSection ? (
            <form id="settings-form" onSubmit={handleSave}>
              <fieldset disabled={!canEdit || saving} className="min-w-0">{renderSection()}</fieldset>
            </form>
          ) : (
            renderSection()
          )}
        </div>
      </div>

      {canEdit && dirty && (
        <div className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-2rem)] max-w-xl flex items-center justify-between gap-3 rounded-2xl border border-brand/30 bg-white/95 dark:bg-[#111113]/95 dark:border-zinc-800 backdrop-blur-sm px-4 py-3 shadow-xl" role="region" aria-label="Alterações não salvas">
          <span className="text-xs font-bold text-slate-700 dark:text-zinc-300">
            Alterações não salvas em: {ALL_ITEMS.filter((i) => dirtySections.has(i.id)).map((i) => i.label).join(', ')}
          </span>
          <div className="flex gap-2 shrink-0">
            <button type="button" onClick={() => setConfig(savedConfig)} className={`${buttonSecondaryClass} min-h-[44px] py-2 px-3 text-xs`}>
              Descartar
            </button>
            <button
              type={hasActiveForm ? 'submit' : 'button'}
              form={hasActiveForm ? 'settings-form' : undefined}
              onClick={hasActiveForm ? undefined : handleSave}
              disabled={saving}
              className={`${buttonPrimaryClass} min-h-[44px] py-2 px-4 text-xs font-black`}
            >
              <Save size={14} aria-hidden="true" /> {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsPage;
