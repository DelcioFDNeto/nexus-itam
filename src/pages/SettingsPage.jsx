// src/pages/SettingsPage.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  AlertTriangle, CheckCircle, Code, Database, Download, Eye, EyeOff, FileJson, FileText, Image as ImageIcon,
  Info, Layers, Lock, Palette, Play, Plus, RefreshCcw, RotateCcw, Save, Settings, Tag, Trash2, UploadCloud, UserCog,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '../services/firebase';
import { generateFullBackup, restoreBackup } from '../services/backupService';
import { countAssets, countMembers, describeFirebaseError } from '../services/tenantService';
import { useAuth } from '../contexts/AuthContext';
import { ACCENTS, useTheme } from '../contexts/ThemeContext';
import { can } from '../utils/permissions';
import { FEATURES, formatUsage, hasFeature, usageRatio, usageTone } from '../utils/entitlements';
import { contrastRatio, rgbChannels } from '../utils/color';
import { safeCssColor, safeImageUrl } from '../utils/sanitize';
import { ARRIVAL_STATUSES, DEFAULT_TERM_CLAUSES, DEFAULT_TRANSFER_CLAUSES } from '../utils/terms';
import { invalidateTenantSettings } from '../hooks/useTenantSettings';
import LocationManager from '../components/settings/LocationManager';
import AssetTypeManager from '../components/settings/AssetTypeManager';

// Campos da empresa gravados em /settings/{tenantId}. Sem valores de outra
// empresa como padrao: antes toda empresa nova via "Délcio Farias" como gestor
// de TI e o e-mail de suporte da primeira cliente, e a cor da marca vinha
// preta (#000000) — salvar sem perceber aplicava tudo isso.
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
const NEXUS_DEFAULT_COLOR = '#4F46E5';
const MODULES = FEATURES.filter((f) => f.module);

const inputClass =
  'w-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-lg p-2 font-bold text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:border-brand disabled:opacity-60 disabled:cursor-not-allowed';

const Card = ({ icon: Icon, title, subtitle, children, action }) => (
  <section className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
    <header className="bg-gray-50 dark:bg-slate-900 px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex items-center gap-3">
      <Icon className="text-brand shrink-0" size={18} />
      <div className="min-w-0 flex-1">
        <h2 className="font-bold text-gray-800 dark:text-white text-sm uppercase">{title}</h2>
        {subtitle && <p className="text-[11px] text-gray-500 dark:text-gray-400">{subtitle}</p>}
      </div>
      {action}
    </header>
    <div className="p-5 space-y-4">{children}</div>
  </section>
);

const Field = ({ label, hint, children }) => (
  <div>
    <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">{label}</label>
    {children}
    {hint && <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">{hint}</p>}
  </div>
);

/** Pre-visualizacao da identidade antes de salvar (usa a cor em edicao, nao a aplicada). */
const BrandPreview = ({ companyName, logoUrl, color }) => {
  // Guarda QUAL url falhou: trocar a url limpa o aviso sem precisar de efeito.
  const [failedUrl, setFailedUrl] = useState(null);
  const channels = rgbChannels(color) || '79 70 229';
  const safeLogo = safeImageUrl(logoUrl);
  const logoFailed = Boolean(safeLogo) && failedUrl === safeLogo;
  const tint = `rgb(${channels} / 0.12)`;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-900">
        {safeLogo && !logoFailed ? (
          <img src={safeLogo} alt="" className="h-7 w-7 object-contain" onError={() => setFailedUrl(safeLogo)} />
        ) : (
          <div className="h-7 w-7 rounded-lg flex items-center justify-center text-white text-xs font-black" style={{ backgroundColor: color }}>
            {(companyName || 'N').charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-sm font-black text-gray-900 dark:text-white truncate">{companyName || 'Sua empresa'}</span>
      </div>
      <div className="p-4 flex flex-wrap items-center gap-2 bg-gray-50 dark:bg-slate-900/60">
        <span className="px-3 py-2 rounded-lg text-white text-xs font-bold" style={{ backgroundColor: color }}>Botão principal</span>
        <span className="px-3 py-2 rounded-lg text-xs font-bold" style={{ backgroundColor: tint, color }}>Item ativo</span>
        <span className="text-xs font-bold underline" style={{ color }}>Link</span>
      </div>
      {safeLogo && logoFailed && (
        <p className="px-4 py-2 text-[11px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400">
          Não foi possível carregar a imagem do logotipo. Verifique se a URL é pública (https).
        </p>
      )}
    </div>
  );
};

const SettingsPage = () => {
  const { currentUser, refreshProfile } = useAuth();
  const { theme, setTheme, accentColor, setAccentColor, tenantBrand } = useTheme();
  const tenantId = currentUser?.tenantId;

  const canEdit = can(currentUser, 'settings:write');
  const canBackup = can(currentUser, 'backup:create');
  const canRestore = can(currentUser, 'backup:restore');
  const whitelabel = hasFeature(currentUser, 'whitelabel');
  const entitlements = currentUser?.entitlements;

  const [config, setConfig] = useState(EMPTY_CONFIG);
  const [savedConfig, setSavedConfig] = useState(EMPTY_CONFIG);
  const [saving, setSaving] = useState(false);
  const [usage, setUsage] = useState({ assets: null, users: null });

  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restoreStatus, setRestoreStatus] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [importSummary, setImportSummary] = useState(null);
  const [showFormatGuide, setShowFormatGuide] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', tenantId));
        const data = snap.exists() ? snap.data() : {};
        const loaded = { ...EMPTY_CONFIG };
        EDITABLE_KEYS.forEach((key) => {
          if (data[key] !== undefined && data[key] !== null) loaded[key] = data[key];
        });
        if (!loaded.companyName) loaded.companyName = currentUser?.companyName && currentUser.companyName !== 'Nexus ITAM' ? currentUser.companyName : '';
        setConfig(loaded);
        setSavedConfig(loaded);
      } catch (error) {
        console.error('Erro ao carregar configurações:', error);
        toast.error('Não foi possível carregar as configurações.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Uso atual x limites do plano (contagem por agregacao, barata).
  useEffect(() => {
    if (!tenantId) return;
    Promise.allSettled([countAssets(tenantId), countMembers(tenantId)]).then(([assets, users]) => {
      setUsage({
        assets: assets.status === 'fulfilled' ? assets.value : null,
        users: users.status === 'fulfilled' ? users.value : null,
      });
    });
  }, [tenantId]);

  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(savedConfig), [config, savedConfig]);
  const set = (key, value) => setConfig((prev) => ({ ...prev, [key]: value }));

  const effectiveColor = safeCssColor(config.primaryColor) || NEXUS_DEFAULT_COLOR;
  const contrast = contrastRatio(effectiveColor, '#ffffff');
  const lowContrast = contrast !== null && contrast < 3;

  // --- Campos customizados (sem mutar o estado, como o codigo antigo fazia) ---
  const addCustomField = () =>
    set('customFields', [...(config.customFields || []), { id: `cf_${Date.now()}`, label: '', type: 'text' }]);
  const updateCustomField = (index, key, value) =>
    set('customFields', (config.customFields || []).map((cf, i) => (i === index ? { ...cf, [key]: value } : cf)));
  const removeCustomField = (index) =>
    set('customFields', (config.customFields || []).filter((_, i) => i !== index));

  const toggleModule = (moduleId) => {
    const hidden = new Set(config.hiddenModules || []);
    if (hidden.has(moduleId)) hidden.delete(moduleId);
    else hidden.add(moduleId);
    set('hiddenModules', [...hidden]);
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    if (!tenantId || !canEdit) return;

    const color = config.primaryColor ? safeCssColor(config.primaryColor) : '';
    if (config.primaryColor && !color) {
      toast.error('Cor inválida. Use o seletor ou um código como #1E40AF.');
      return;
    }
    if (config.logoUrl && !safeImageUrl(config.logoUrl)) {
      toast.error('URL do logotipo inválida. Use um endereço https:// público.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...Object.fromEntries(EDITABLE_KEYS.map((key) => [key, config[key]])),
        companyName: config.companyName.trim(),
        primaryColor: color || '',
        customFields: (config.customFields || []).filter((cf) => cf.label?.trim()),
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'settings', tenantId), payload, { merge: true });
      // Termos e etiquetas releem a identidade atualizada.
      invalidateTenantSettings(tenantId);

      // Mantem o nome no cadastro da empresa (visto pelo console master).
      if (payload.companyName && payload.companyName !== savedConfig.companyName) {
        await updateDoc(doc(db, 'tenants', tenantId), { companyName: payload.companyName, updatedAt: serverTimestamp() }).catch(() => {
          /* empresa legada sem cadastro em /tenants */
        });
      }

      const next = { ...config, primaryColor: color || '', customFields: payload.customFields };
      setConfig(next);
      setSavedConfig(next);
      // Aplica logo, cor e modulos agora — antes so apareciam apos recarregar.
      await refreshProfile();
      toast.success('Configurações salvas e aplicadas.');
    } catch (error) {
      console.error(error);
      toast.error(describeFirebaseError(error, 'Erro ao salvar as configurações.'));
    } finally {
      setSaving(false);
    }
  };

  // --- Backup / restauracao ---------------------------------------------------
  const downloadJson = (data, filename) => {
    // Blob em vez de data: URI — backups grandes estouravam o limite de URL.
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleFullBackup = async () => {
    setBackupLoading(true);
    try {
      const backupData = await generateFullBackup(tenantId, false);
      downloadJson(backupData, `BACKUP_NEXUS_${new Date().toISOString().slice(0, 10)}.json`);
      toast.success('Backup gerado.');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao gerar backup.');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleDownloadTemplate = () =>
    downloadJson(
      {
        meta: { version: '2.0', type: 'full_backup', date: new Date().toISOString() },
        data: {
          assets: [{ internalId: 'TAG-001', model: 'Exemplo', type: 'Notebook', status: 'Disponível' }],
          employees: [], history: [], projects: [], tasks: [], sectors: [],
        },
      },
      'TEMPLATE_IMPORTACAO.json',
    );

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleFile = (file) => {
    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      toast.error('Arquivo inválido. Envie um JSON.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        if (!json.meta || !json.data) {
          toast.error("Estrutura inválida: faltam 'meta' ou 'data'. Consulte o formato esperado.");
          return;
        }
        setImportSummary({
          filename: file.name,
          date: json.meta.date ? new Date(json.meta.date).toLocaleString('pt-BR') : 'N/A',
          counts: Object.keys(json.data).reduce((acc, key) => {
            if (Array.isArray(json.data[key])) acc[key] = json.data[key].length;
            return acc;
          }, {}),
          rawData: json,
        });
      } catch (err) {
        toast.error(`Erro ao ler o arquivo JSON: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  };

  const confirmRestore = async () => {
    if (!importSummary) return;
    const summary = importSummary;
    setImportSummary(null);
    setRestoreLoading(true);
    setRestoreProgress(0);
    setRestoreStatus('Inicializando...');
    try {
      const stats = await restoreBackup(summary.rawData, (progress, message) => {
        setRestoreProgress(progress);
        setRestoreStatus(message);
      }, tenantId);
      const notes = [
        `Documentos restaurados: ${stats.totalDocsProcessed}`,
        stats.rejectedDocs ? `Recusados (outra empresa ou ID inválido): ${stats.rejectedDocs}` : null,
        stats.skippedCollections.length ? `Ignoradas por segurança: ${stats.skippedCollections.join(', ')}` : null,
        stats.errors.length ? `Erros: ${stats.errors.length}` : null,
      ].filter(Boolean);
      toast.success('Restauração finalizada.', { description: notes.join(' · '), duration: 8000 });
    } catch (error) {
      console.error(error);
      toast.error(`Falha na restauração: ${error.message}`);
    } finally {
      setRestoreLoading(false);
      setRestoreStatus('');
    }
  };

  const assetsTone = usageTone(usageRatio(usage.assets ?? 0, entitlements?.maxAssets));
  const usersTone = usageTone(usageRatio(usage.users ?? 0, entitlements?.maxUsers));
  const toneBar = (tone) => (tone === 'critical' ? 'bg-rose-500' : tone === 'warning' ? 'bg-amber-500' : 'bg-brand');

  return (
    <div className="max-w-6xl mx-auto pb-28">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gray-900 dark:bg-slate-800 text-white rounded-xl">
            <Settings size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900 dark:text-white">Configurações</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Identidade, documentos, módulos e dados de {config.companyName || 'sua empresa'}</p>
          </div>
        </div>
        {canEdit && (
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="self-start md:self-auto bg-brand text-white px-5 py-3 rounded-xl font-bold hover:bg-brand-dark flex items-center gap-2 text-sm shadow-md shadow-brand/30 transition-all active:scale-95 disabled:opacity-50 disabled:shadow-none"
          >
            {saving ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Salvando...' : dirty ? 'Salvar alterações' : 'Tudo salvo'}
          </button>
        )}
      </div>

      {!canEdit && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          <Lock size={18} className="shrink-0 mt-0.5" />
          <p>Somente o proprietário da conta altera identidade visual, documentos e módulos. Você pode gerenciar os locais e a sua aparência pessoal.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ------------------------------------------------------------ */}
        <div className="lg:col-span-3 space-y-6">
          <form onSubmit={handleSave} className="space-y-6">
            <fieldset disabled={!canEdit || saving} className="space-y-6 min-w-0">
              <Card icon={Palette} title="Identidade visual" subtitle="Aparece no menu, nas etiquetas e no termo de responsabilidade">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Nome da empresa">
                    <input className={inputClass} value={config.companyName} onChange={(e) => set('companyName', e.target.value)} placeholder="Ex: ACME Indústria" maxLength={120} />
                  </Field>
                  <Field label="URL do logotipo" hint="PNG, SVG ou WebP públicos (https). Ideal: fundo transparente.">
                    <div className="relative">
                      <ImageIcon size={14} className="absolute left-2.5 top-3 text-gray-400" />
                      <input className={`${inputClass} pl-8`} value={config.logoUrl} onChange={(e) => set('logoUrl', e.target.value.trim())} placeholder="https://..." />
                    </div>
                  </Field>
                </div>

                <Field label="Cor da marca" hint="Botões, destaques e itens ativos do menu de toda a equipe.">
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="color"
                      value={effectiveColor.startsWith('#') && effectiveColor.length === 7 ? effectiveColor : NEXUS_DEFAULT_COLOR}
                      onChange={(e) => set('primaryColor', e.target.value)}
                      className="h-10 w-14 rounded-lg border border-gray-200 dark:border-slate-700 bg-transparent p-1 cursor-pointer"
                      aria-label="Selecionar cor da marca"
                    />
                    <input className={`${inputClass} w-32 font-mono`} value={config.primaryColor} onChange={(e) => set('primaryColor', e.target.value.trim())} placeholder={NEXUS_DEFAULT_COLOR} />
                    {config.primaryColor && (
                      <button type="button" onClick={() => set('primaryColor', '')} className="text-xs font-bold text-gray-500 hover:text-brand flex items-center gap-1">
                        <RotateCcw size={12} /> Usar cor padrão Nexus
                      </button>
                    )}
                  </div>
                  {lowContrast && (
                    <p className="mt-2 flex items-start gap-1.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                      <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                      Texto branco sobre esta cor fica difícil de ler (contraste {contrast.toFixed(1)}:1). Prefira um tom mais escuro.
                    </p>
                  )}
                </Field>

                <BrandPreview companyName={config.companyName} logoUrl={config.logoUrl} color={effectiveColor} />

                <p className="flex items-start gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                  <Info size={13} className="shrink-0 mt-0.5 text-brand" />
                  {whitelabel
                    ? 'Whitelabel completo ativo: a marca Nexus não aparece no menu, etiquetas nem termos.'
                    : 'Seu plano exibe "Nexus ITAM" junto à sua marca. O whitelabel completo remove a marca Nexus dos impressos e do menu — fale com o suporte.'}
                </p>
              </Card>

              <Card icon={FileText} title="Documentos e etiquetas" subtitle="Dados usados nos termos (responsabilidade, devolução, transferência) e nas etiquetas">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="CNPJ">
                    <input className={inputClass} value={config.cnpj} onChange={(e) => set('cnpj', e.target.value)} placeholder="00.000.000/0001-00" />
                  </Field>
                  <Field label="Gestor de TI (assina o termo)">
                    <input className={inputClass} value={config.itManager} onChange={(e) => set('itManager', e.target.value)} placeholder="Nome do responsável" />
                  </Field>
                  <Field label="E-mail de suporte (etiquetas)">
                    <input type="email" className={inputClass} value={config.supportEmail} onChange={(e) => set('supportEmail', e.target.value)} placeholder="suporte@empresa.com" />
                  </Field>
                  <Field label="Texto do rodapé da etiqueta">
                    <input className={inputClass} value={config.labelFooter} onChange={(e) => set('labelFooter', e.target.value.toUpperCase())} placeholder="SUPORTE TI" maxLength={24} />
                  </Field>
                </div>
                <Field label="Título do termo">
                  <input className={inputClass} value={config.termTitle} onChange={(e) => set('termTitle', e.target.value)} placeholder="Termo de Responsabilidade" />
                </Field>
                <Field label="Cláusulas do termo" hint="Uma cláusula por linha. Em branco, o termo usa o texto padrão (CLT Art. 462 e Código Civil).">
                  <textarea
                    value={config.termClauses}
                    onChange={(e) => set('termClauses', e.target.value)}
                    className={`${inputClass} h-36 resize-y font-medium`}
                    placeholder="1. DO USO E FINALIDADE: ..."
                  />
                  <button type="button" onClick={() => set('termClauses', DEFAULT_TERM_CLAUSES)} className="mt-2 text-xs font-bold text-brand hover:underline flex items-center gap-1">
                    <RotateCcw size={12} /> Carregar texto padrão para editar
                  </button>
                </Field>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                  <Field label="Cidade (data dos termos)" hint="Ex.: Belém. Sai como “Belém, 9 de outubro de 2026”.">
                    <input className={inputClass} value={config.termCity} onChange={(e) => set('termCity', e.target.value)} placeholder="Deixe em branco para preencher à mão" />
                  </Field>
                  <label className="flex items-center gap-2 pb-6 text-xs font-bold text-gray-600 dark:text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={Boolean(config.termShowValue)} onChange={(e) => set('termShowValue', e.target.checked)} className="h-4 w-4" />
                    Mostrar o valor dos bens no termo de responsabilidade
                  </label>
                  <label className="flex items-center gap-2 pb-6 text-xs font-bold text-gray-600 dark:text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={Boolean(config.termWitnesses)} onChange={(e) => set('termWitnesses', e.target.checked)} className="h-4 w-4" />
                    Incluir duas testemunhas
                  </label>
                </div>

                <Field label="Condições do termo de transferência" hint="Saem no Termo de Transferência e Recebimento (matriz → loja). Uma condição por linha; em branco usa o texto padrão.">
                  <textarea
                    value={config.transferClauses}
                    onChange={(e) => set('transferClauses', e.target.value)}
                    className={`${inputClass} h-28 resize-y font-medium`}
                    placeholder="1. DA CONFERÊNCIA: ..."
                  />
                  <button type="button" onClick={() => set('transferClauses', DEFAULT_TRANSFER_CLAUSES)} className="mt-2 text-xs font-bold text-brand hover:underline flex items-center gap-1">
                    <RotateCcw size={12} /> Carregar texto padrão para editar
                  </button>
                </Field>

                <div className="rounded-xl border border-gray-200 dark:border-slate-600 p-4 space-y-3">
                  <div>
                    <p className="text-xs font-black text-gray-800 dark:text-gray-100">Conclusão automática</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      Ao anexar o termo assinado, o sistema conclui sozinho: a transferência vira "Recebido" e os itens passam para a loja; o termo de responsabilidade vira "Assinado".
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                    <Field label="Itens que chegam na loja ficam">
                      <select className={inputClass} value={config.transferArrivalStatus} onChange={(e) => set('transferArrivalStatus', e.target.value)}>
                        {ARRIVAL_STATUSES.map((status) => <option key={status} value={status}>{status === 'Disponível' ? 'Disponível (estoque da loja)' : status}</option>)}
                      </select>
                    </Field>
                    <label className="flex items-center gap-2 pb-2 text-xs font-bold text-gray-600 dark:text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={Boolean(config.transferAssignReceiver)} onChange={(e) => set('transferAssignReceiver', e.target.checked)} className="h-4 w-4" />
                      Registrar o recebedor da loja como responsável pelos itens
                    </label>
                    <Field label="Pendência atrasada após (dias)" hint="Sem previsão de chegada, vale este prazo.">
                      <input type="number" min={1} max={90} className={inputClass} value={config.termOverdueDays} onChange={(e) => set('termOverdueDays', Number(e.target.value) || '')} />
                    </Field>
                  </div>
                </div>

                {/* Etiqueta de exemplo com os dados em edicao */}
                <div className="rounded-xl border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-900 p-4">
                  <p className="text-[10px] font-black text-gray-500 dark:text-gray-400 uppercase mb-3 flex items-center gap-1.5"><Tag size={12} /> Prévia da etiqueta</p>
                  <div className="mx-auto w-full max-w-[280px] rounded-lg border-2 border-gray-900 bg-white p-3 font-sans text-gray-900">
                    <div className="border-b border-gray-200 pb-2 flex items-center gap-2 min-h-[28px]">
                      {safeImageUrl(config.logoUrl) ? (
                        <img src={safeImageUrl(config.logoUrl)} alt="" className="h-5 max-w-[110px] object-contain" />
                      ) : whitelabel ? (
                        <span className="text-sm font-black uppercase" style={{ color: effectiveColor }}>{config.companyName || 'Sua empresa'}</span>
                      ) : (
                        <span className="text-sm font-black leading-none text-[#4F46E5]">Nexus<span className="text-gray-900">ITAM</span></span>
                      )}
                    </div>
                    {(!whitelabel || safeImageUrl(config.logoUrl)) && (
                      <p className="mt-1 truncate text-[9px] font-black uppercase">{config.companyName || 'Sua empresa'}</p>
                    )}
                    <p className="pt-2 text-[9px] font-black uppercase text-gray-500">Patrimônio</p>
                    <p className="font-mono text-xl font-black">TAG-001</p>
                    <div className="mt-2 flex items-center justify-between border-t border-gray-900 pt-1 gap-2">
                      <span className="text-[8px] font-black text-gray-600">{config.labelFooter || 'SUPORTE TI'}</span>
                      <span className="truncate text-[9px] font-black">{config.supportEmail}</span>
                    </div>
                  </div>
                </div>
              </Card>

              <Card icon={Layers} title="Módulos" subtitle="Oculte do menu o que sua equipe não usa. Os dados continuam salvos.">
                <ul className="divide-y divide-gray-100 dark:divide-slate-700">
                  {MODULES.map((mod) => {
                    const entitled = hasFeature(currentUser, mod.id);
                    const visible = !(config.hiddenModules || []).includes(mod.id);
                    return (
                      <li key={mod.id} className="flex items-center justify-between gap-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                            {mod.label}
                            {!entitled && <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-300">Fora do plano</span>}
                          </p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{mod.description}</p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={entitled && visible}
                          aria-label={`Exibir ${mod.label}`}
                          disabled={!entitled}
                          onClick={() => toggleModule(mod.id)}
                          className={`relative h-6 min-h-0 w-11 shrink-0 rounded-full p-0 transition-colors disabled:opacity-40 ${entitled && visible ? 'bg-brand' : 'bg-gray-300 dark:bg-slate-600'}`}
                        >
                          <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${entitled && visible ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>

              <Card
                icon={Database}
                title="Cadastro de ativos"
                subtitle="Campos e tipos próprios da sua empresa"
                action={
                  <button type="button" onClick={addCustomField} className="text-[10px] flex items-center gap-1 bg-brand text-white px-2.5 py-1.5 rounded-lg font-bold hover:bg-brand-dark transition-colors disabled:opacity-50">
                    <Plus size={12} /> Campo
                  </button>
                }
              >
                <div className="space-y-2">
                  {(config.customFields || []).map((cf, idx) => (
                    <div key={cf.id} className="flex items-center gap-2 bg-gray-50 dark:bg-slate-900 p-2 border border-gray-200 dark:border-slate-700 rounded-lg">
                      <input
                        value={cf.label}
                        onChange={(e) => updateCustomField(idx, 'label', e.target.value)}
                        placeholder="Nome do campo"
                        aria-label="Nome do campo customizado"
                        className="flex-1 min-w-0 p-1.5 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded text-xs font-bold text-gray-800 dark:text-gray-100 focus:border-brand focus:outline-none"
                      />
                      <select
                        value={cf.type}
                        onChange={(e) => updateCustomField(idx, 'type', e.target.value)}
                        aria-label="Tipo do campo customizado"
                        className="p-1.5 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded text-xs font-bold text-gray-600 dark:text-gray-300 focus:border-brand focus:outline-none"
                      >
                        <option value="text">Texto curto</option>
                        <option value="textarea">Texto longo</option>
                        <option value="date">Data</option>
                        <option value="number">Número</option>
                      </select>
                      <button type="button" onClick={() => removeCustomField(idx)} aria-label="Remover campo" className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  {(config.customFields || []).length === 0 && (
                    <p className="text-xs text-center text-gray-400 dark:text-gray-500 font-medium py-2">Nenhum campo customizado criado.</p>
                  )}
                </div>

                <AssetTypeManager types={config.assetTypes || []} onChange={(assetTypes) => set('assetTypes', assetTypes)} />
              </Card>
            </fieldset>

            {canEdit && dirty && (
              <div className="sticky bottom-24 lg:bottom-4 z-20 flex items-center justify-between gap-3 rounded-2xl border border-brand/30 bg-white/95 dark:bg-slate-900/95 backdrop-blur px-4 py-3 shadow-lg">
                <span className="text-xs font-bold text-gray-600 dark:text-gray-300">Há alterações não salvas.</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setConfig(savedConfig)} className="px-3 py-2 rounded-lg text-xs font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800">
                    Descartar
                  </button>
                  <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand text-white text-xs font-black flex items-center gap-1.5 disabled:opacity-60">
                    <Save size={14} /> Salvar
                  </button>
                </div>
              </div>
            )}
          </form>

          {/* Locais ficam FORA do formulario: tem gravacao propria, imediata. */}
          <Card icon={Database} title="Filiais e locais" subtitle="Usados nos seletores de localização e na auditoria">
            <LocationManager showHeader={false} />
          </Card>
        </div>

        {/* ------------------------------------------------------------ */}
        <div className="lg:col-span-2 space-y-6">
          <Card icon={CheckCircle} title="Plano da empresa" subtitle={entitlements?.legacy ? 'Conta sem plano definido (sem limites)' : entitlements?.planName}>
            {[
              ['Ativos', usage.assets, entitlements?.maxAssets, assetsTone],
              ['Usuários', usage.users, entitlements?.maxUsers, usersTone],
            ].map(([label, current, limit, tone]) => (
              <div key={label}>
                <div className="flex justify-between text-xs font-bold text-gray-600 dark:text-gray-300">
                  <span>{label}</span>
                  <span className="tabular-nums">{current === null ? '…' : formatUsage(current, limit)}</span>
                </div>
                {limit !== null && limit !== undefined && (
                  <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden">
                    <div className={`h-full rounded-full ${toneBar(tone)}`} style={{ width: `${Math.min(100, usageRatio(current ?? 0, limit) * 100)}%` }} />
                  </div>
                )}
              </div>
            ))}
            <ul className="grid grid-cols-1 gap-1.5 pt-2">
              {FEATURES.map((feature) => {
                const on = hasFeature(currentUser, feature.id);
                return (
                  <li key={feature.id} className={`flex items-center gap-2 text-xs ${on ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}`}>
                    {on ? <CheckCircle size={13} className="text-green-500 shrink-0" /> : <Lock size={13} className="shrink-0" />}
                    {feature.label}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card icon={UserCog} title="Minha aparência" subtitle="Preferências só deste navegador">
            <div>
              <h3 className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-2">Modo de exibição</h3>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['light', 'Claro', 'bg-white border-gray-200'],
                  ['dark', 'Escuro', 'bg-slate-900 border-slate-700'],
                  ['system', 'Sistema', 'bg-gradient-to-tr from-slate-900 to-white border-gray-300'],
                ].map(([value, label, swatch]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTheme(value)}
                    aria-pressed={theme === value}
                    className={`py-3 border-2 rounded-xl text-xs font-bold flex flex-col items-center gap-2 transition-all ${theme === value ? 'border-brand text-brand bg-brand/5' : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-500'}`}
                  >
                    <span className={`w-7 h-7 rounded-full border shadow-sm ${swatch}`} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-2">Cor de destaque</h3>
              <div className="flex flex-wrap gap-3 items-center">
                {/* "Automatico" devolve a cor da empresa — antes nao havia como voltar */}
                <button
                  type="button"
                  onClick={() => setAccentColor(null)}
                  title="Automático: cor da empresa"
                  aria-pressed={!accentColor}
                  className={`h-10 px-3 rounded-full flex items-center gap-2 text-[11px] font-black border-2 transition-all ${!accentColor ? 'border-brand text-brand' : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-gray-400'}`}
                >
                  <span className="w-4 h-4 rounded-full" style={{ backgroundColor: safeCssColor(tenantBrand) || NEXUS_DEFAULT_COLOR }} />
                  Empresa
                </button>
                {Object.entries(ACCENTS).map(([id, color]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setAccentColor(id)}
                    aria-label={`Destaque ${id}`}
                    aria-pressed={accentColor === id}
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${accentColor === id ? 'ring-4 ring-offset-2 ring-brand dark:ring-offset-slate-800 scale-110' : 'hover:scale-105'}`}
                    style={{ backgroundColor: color }}
                  >
                    {accentColor === id && <CheckCircle size={16} className="text-white drop-shadow-md" />}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {canBackup && (
            <Card icon={Download} title="Backup" subtitle="Arquivo JSON com todos os dados da empresa">
              <button onClick={handleFullBackup} disabled={backupLoading} className="w-full bg-blue-600 text-white px-5 py-3 rounded-xl font-bold hover:bg-blue-700 flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 transition-all active:scale-95 disabled:opacity-60">
                {backupLoading ? <RefreshCcw className="animate-spin" size={18} /> : <FileJson size={18} />}
                {backupLoading ? 'Gerando arquivo...' : 'Baixar backup completo'}
              </button>
            </Card>
          )}

          {canRestore && (
            <Card
              icon={UploadCloud}
              title="Restauração"
              subtitle="Importa um backup JSON desta empresa"
              action={
                <button
                  type="button"
                  onClick={() => setShowFormatGuide((v) => !v)}
                  aria-expanded={showFormatGuide}
                  className="text-[10px] font-bold text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 bg-gray-100 dark:bg-slate-700 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600"
                >
                  {showFormatGuide ? <EyeOff size={12} /> : <Code size={12} />} {showFormatGuide ? 'Ocultar formato' : 'Ver formato'}
                </button>
              }
            >
              {showFormatGuide && (
                <div className="text-xs space-y-3">
                  <div className="flex justify-between items-center">
                    <p className="font-bold text-gray-700 dark:text-gray-200 flex items-center gap-1.5"><Info size={14} className="text-blue-500" /> Estrutura esperada</p>
                    <button type="button" onClick={handleDownloadTemplate} className="text-[10px] bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 px-2 py-1 rounded font-bold text-gray-700 dark:text-gray-200">Baixar modelo</button>
                  </div>
                  <pre className="bg-gray-900 text-gray-100 p-3 rounded-xl overflow-x-auto font-mono text-[11px]">{`{
  "meta": { "version": "2.0", "date": "2026-01-01T10:00:00Z" },
  "data": {
    "assets": [ { "internalId": "NB-001", "model": "Dell", ... } ],
    "employees": [ ... ],
    "history": [ ... ]
  }
}`}</pre>
                  <p className="flex items-start gap-1.5 text-orange-700 bg-orange-50 dark:bg-orange-950/30 dark:text-orange-300 p-2.5 rounded-lg">
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                    Registros com o mesmo ID são atualizados; os demais são criados. Usuários, planos e configurações nunca são restaurados.
                  </p>
                </div>
              )}

              {importSummary ? (
                <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/50 rounded-xl p-4 space-y-3">
                  <p className="font-bold text-blue-900 dark:text-blue-200 flex items-center gap-2 text-sm"><FileJson size={16} /> {importSummary.filename}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">Gerado em {importSummary.date}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(importSummary.counts).map(([key, count]) => (
                      <div key={key} className="bg-white dark:bg-slate-800 p-2 rounded text-center border border-gray-100 dark:border-slate-700">
                        <span className="block text-base font-black text-gray-800 dark:text-gray-100">{count}</span>
                        <span className="text-[9px] text-gray-500 dark:text-gray-400 uppercase font-bold">{key}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setImportSummary(null)} className="flex-1 py-2.5 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 font-bold rounded-lg text-xs">Cancelar</button>
                    <button type="button" onClick={confirmRestore} className="flex-1 py-2.5 bg-blue-600 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-1.5"><Play size={14} /> Restaurar</button>
                  </div>
                </div>
              ) : restoreLoading ? (
                <div className="text-center py-6">
                  <div className="w-12 h-12 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin mx-auto mb-3" />
                  <p className="font-bold text-lg text-gray-800 dark:text-gray-100">{restoreProgress}%</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{restoreStatus}</p>
                </div>
              ) : (
                <div
                  role="button"
                  tabIndex={0}
                  className={`p-6 border-2 border-dashed ${dragActive ? 'border-brand bg-brand/5' : 'border-gray-200 dark:border-slate-600 bg-gray-50/50 dark:bg-slate-900/50'} transition-all text-center rounded-xl cursor-pointer group`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                >
                  <input ref={fileInputRef} type="file" className="hidden" accept=".json" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
                  <UploadCloud size={28} className="mx-auto mb-2 text-gray-400 group-hover:text-orange-500 transition-colors" />
                  <p className="font-bold text-sm text-gray-700 dark:text-gray-200">Clique ou arraste o JSON aqui</p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">O arquivo é validado antes de importar.</p>
                </div>
              )}
            </Card>
          )}

          {!canBackup && (
            <p className="flex items-start gap-2 text-[11px] text-gray-500 dark:text-gray-400 px-1">
              <Eye size={13} className="shrink-0 mt-0.5" /> Backup e restauração ficam disponíveis para o proprietário da conta.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
