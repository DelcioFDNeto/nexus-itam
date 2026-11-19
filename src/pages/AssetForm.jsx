// src/pages/AssetForm.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getEmployees } from '../services/employeeService';
import {
  createAsset,
  updateAsset,
  getAssetById,
  getAssetByInternalId,
  getAllAssets,
} from '../services/assetService';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import { assertWithinLimit, describeFirebaseError } from '../services/tenantService';
import { microservicesApi } from '../services/microservicesClient';
import { toast } from 'sonner';
import {
  Save, ArrowLeft, Search, Server, User, MapPin, Building2, Tag,
  DollarSign, FileText, ShieldCheck, Archive, Camera, Sparkles,
  AlertCircle, Plus, Hash, RefreshCw,
} from 'lucide-react';
import QRScanner from '../components/QRScanner';
import AssetIcon from '../components/AssetIcon';
import { buildAssetCatalog, SPEC_FIELDS, isRootSpec } from '../utils/assetTypes';
import { generateNextAssetTag } from '../utils/assetTagGenerator';
import { AGENT_VERSION } from '../utils/agentInventory';
import LocationSelect from '../components/LocationSelect';
import StatusBadge from '../components/StatusBadge';
import {
  MANUAL_STATUSES,
  isRetired,
  statusDotClass,
  warrantyStatus,
  WARRANTY_BADGE,
  WARRANTY_LABEL,
} from '../utils/assetStatus';

const fieldCls =
  'w-full min-h-[44px] px-3.5 py-2.5 bg-slate-50 hover:border-slate-300 active:border-slate-400 focus-visible:bg-white focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25 disabled:opacity-50 disabled:cursor-not-allowed aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500/25 dark:bg-[#111113] dark:border-zinc-800 dark:hover:border-zinc-700 dark:focus-visible:bg-[#111113] dark:text-[#fafafa] dark:placeholder:text-zinc-500 dark:[&_option]:bg-[#111113] dark:[&_option]:text-[#fafafa] border border-slate-200/90 rounded-xl text-sm font-semibold text-slate-900 placeholder:text-slate-400 transition-colors';

/**
 * Módulo de Cadastro & Edição de Ativos — Nexus ITAM v3.0.
 * - Organização executiva por blocos temáticos de alta definição.
 * - Auto-gerador de Tag/Patrimônio e validação de duplicidade em tempo real.
 * - Atalhos rápidos para cálculo de garantia (+1A, +2A, +3A, +5A).
 * - Modo Lote ("Salvar e Adicionar Outro") para cadastro ágil de remessas.
 * - Integração e preservação total de telemetria do Agente / NexusDesk.
 * - Barra de ações fixa responsiva para desktop e dispositivos móveis.
 */
const AssetForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [loadingAsset, setLoadingAsset] = useState(Boolean(id));
  const [assetNotFound, setAssetNotFound] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const submittingRef = useRef(false);
  const [employees, setEmployees] = useState([]);
  const [initialData, setInitialData] = useState(null);
  // Transferência aberta (Termos): status e local ficam travados no formulário.
  const [transit, setTransit] = useState(null);
  // Inquilino dono do registro: a edição nunca move o ativo de empresa.
  const [originalTenantId, setOriginalTenantId] = useState(null);
  const [customFieldsDef, setCustomFieldsDef] = useState([]);
  const [scanTarget, setScanTarget] = useState(null);
  // Tipos próprios da empresa, somados ao catálogo base.
  const [customTypes, setCustomTypes] = useState([]);

  // Verificação de patrimônio duplicado
  const [tagChecking, setTagChecking] = useState(false);
  const [tagExists, setTagExists] = useState(false);
  const [tagGenerating, setTagGenerating] = useState(false);

  // Cache de ativos e configurações da empresa para geração de patrimônio sequencial
  const [tenantAssets, setTenantAssets] = useState([]);
  const [tenantSettings, setTenantSettings] = useState(null);

  const [formData, setFormData] = useState({
    model: '',
    internalId: '',
    type: localStorage.getItem('itam_last_type') || 'Computador',
    category: localStorage.getItem('itam_last_category') || 'Corporativo', // 'Corporativo', 'Promocional', 'Infra'
    status: 'Em Uso',
    location: localStorage.getItem('itam_last_location') || '',
    assignedTo: '',
    assignedToEmail: '',
    clientCpf: '',
    sector: '',
    vendedor: '',
    employeeId: '',
    purchaseDate: '',
    warrantyEnd: '',
    supplier: '',
    invoiceNumber: '',
    costCenter: '',
    serialNumber: '',
    imei1: '',
    imei2: '',
    valor: '',
    notes: '',
    // Especificações técnicas flexíveis
    specs: { ip: '', ram: '', storage: '', pageCount: '', processor: '' },
    customData: {},
    writeOffDate: '',
    writeOffReason: '',
    writeOffNotes: '',
    agent: null,
  });

  useEffect(() => {
    let active = true;
    if (id) {
      setLoadingAsset(true);
      setAssetNotFound(false);
      setLoadError('');
    } else {
      setLoadingAsset(false);
      setAssetNotFound(false);
      setLoadError('');
    }

    const init = async () => {
      try {
        const empList = await getEmployees(currentUser?.tenantId);
        if (!active) return;
        setEmployees(empList);

        if (currentUser?.tenantId) {
          if (currentUser?.authSource === 'gateway') {
            const cfg = {
              companyName: currentUser?.companyName || 'Nexus Indústria & Tecnologia S.A.',
              assetPrefix: currentUser?.assetPrefix || 'NEX',
            };
            setTenantSettings(cfg);
          } else {
            const settingsSnap = await getDoc(doc(db, 'settings', currentUser.tenantId));
            if (!active) return;
            if (settingsSnap.exists()) {
              const cfg = settingsSnap.data();
              setTenantSettings(cfg);
              if (cfg.customFields) setCustomFieldsDef(cfg.customFields);
              if (cfg.assetTypes) setCustomTypes(cfg.assetTypes);
            }
          }

          // Carrega ativos da empresa em segundo plano para o sequenciador de tags
          getAllAssets(currentUser.tenantId)
            .then((list) => {
              if (active && Array.isArray(list)) setTenantAssets(list);
            })
            .catch(() => {});
        }

        if (id) {
          const data = await getAssetById(id, currentUser?.role === 'superadmin' ? null : currentUser?.tenantId);
          if (!active) return;
          if (data) {
            const loadedData = {
              model: data.model || '',
              internalId: data.internalId || '',
              type: data.type || 'Computador',
              category: data.category || 'Corporativo',
              status: data.status || 'Em Uso',
              location: data.location || '',
              assignedTo: data.assignedTo || '',
              assignedToEmail: data.assignedToEmail || data.assignedEmail || '',
              clientCpf: data.clientCpf || '',
              sector: data.sector || '',
              vendedor: data.vendedor || '',
              employeeId: data.employeeId || '',
              purchaseDate: data.purchaseDate || '',
              warrantyEnd: data.warrantyEnd || '',
              supplier: data.supplier || '',
              invoiceNumber: data.invoiceNumber || '',
              costCenter: data.costCenter || '',
              serialNumber: data.serialNumber || '',
              imei1: data.imei1 || '',
              imei2: data.imei2 || '',
              valor: data.valor || '',
              notes: data.notes || '',
              // Preserva todas as specs coletadas pelo Agente ITAM (MAC, SO, SAM, antivírus, monitores)
              specs: {
                ip: '', ram: '', storage: '', pageCount: '', processor: '',
                ...(data.specs || {}),
              },
              customData: data.customData || {},
              writeOffDate: data.writeOffDate || '',
              writeOffReason: data.writeOffReason || '',
              writeOffNotes: data.writeOffNotes || '',
              agent: data.agent || null,
            };
            setFormData(loadedData);
            setInitialData(loadedData);
            setIsDirty(false);
            setTransit(data.transit || null);
            setOriginalTenantId(data.tenantId || null);
          } else {
            setAssetNotFound(true);
          }
        }
      } catch (error) {
        console.error(error);
        if (active && id) {
          setLoadError('Não foi possível carregar os dados deste ativo. Verifique sua conexão e tente novamente.');
        }
      } finally {
        if (active && id) setLoadingAsset(false);
      }
    };
    init();
    return () => {
      active = false;
    };
  }, [id, reloadKey, currentUser?.tenantId, currentUser?.role, currentUser?.authSource, currentUser?.companyName, currentUser?.assetPrefix]);

  // Proteção contra saída acidental com alterações não salvas
  useEffect(() => {
    if (!isDirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  // Validação em tempo real de Patrimônio (Tag) duplicado
  useEffect(() => {
    const tag = (formData.internalId || '').trim();
    if (!tag || !currentUser?.tenantId) {
      setTagExists(false);
      return;
    }

    // Se estiver editando e o patrimônio não foi alterado, ignora
    if (id && initialData?.internalId && initialData.internalId.trim().toUpperCase() === tag.toUpperCase()) {
      setTagExists(false);
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      try {
        setTagChecking(true);
        const existing = await getAssetByInternalId(tag, currentUser.tenantId);
        if (active) {
          setTagExists(Boolean(existing && existing.id !== id));
        }
      } catch {
        /* noop */
      } finally {
        if (active) setTagChecking(false);
      }
    }, 450);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [formData.internalId, currentUser?.tenantId, id, initialData?.internalId]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setIsDirty(true);
    if (name.startsWith('specs.')) {
      const field = name.split('.')[1];
      setFormData((prev) => ({ ...prev, specs: { ...prev.specs, [field]: value } }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleCustomDataChange = (fieldId, value) => {
    setIsDirty(true);
    setFormData((prev) => ({ ...prev, customData: { ...prev.customData, [fieldId]: value } }));
  };

  const handleEmployeeSelect = (e) => {
    const selectedName = e.target.value;
    setIsDirty(true);
    if (!selectedName) {
      setFormData((prev) => ({
        ...prev,
        assignedTo: '',
        assignedToEmail: '',
        clientCpf: '',
        sector: '',
        employeeId: '',
      }));
      return;
    }
    const emp = employees.find((ep) => ep.name === selectedName);
    if (emp) {
      setFormData((prev) => ({
        ...prev,
        assignedTo: emp.name,
        assignedToEmail: emp.email ? String(emp.email).trim().toLowerCase() : '',
        clientCpf: emp.cpf || '',
        sector: emp.sector || '',
        location: emp.branch || prev.location,
        employeeId: emp.id,
      }));
    } else {
      setFormData((prev) => ({ ...prev, assignedTo: selectedName, assignedToEmail: '' }));
    }
  };

  // Gerador Inteligente de Patrimônio / Tag Automático baseado no padrão da empresa
  const handleGenerateTag = useCallback(async () => {
    try {
      setTagGenerating(true);
      if (currentUser?.authSource === 'gateway') {
        const next = await microservicesApi.suggestNextTag(formData.type || 'Notebook').catch(() => null);
        if (next?.suggestedTag) {
          setIsDirty(true);
          setFormData((prev) => ({ ...prev, internalId: next.suggestedTag }));
          toast.success(`Patrimônio gerado: ${next.suggestedTag}`, {
            description: `Sequência ${next.nextSequence} calculada pela API 1 do microsserviço de ativos.`,
          });
          return;
        }
      }

      let currentAssets = tenantAssets;
      if (!currentAssets || currentAssets.length === 0) {
        if (currentUser?.tenantId) {
          try {
            currentAssets = await getAllAssets(currentUser.tenantId);
            setTenantAssets(currentAssets);
          } catch {
            currentAssets = [];
          }
        } else {
          currentAssets = [];
        }
      }

      const result = generateNextAssetTag({
        existingAssets: currentAssets,
        targetType: formData.type || 'Computador',
        targetLocation: formData.location || '',
        tenantSettings,
        companyName: tenantSettings?.companyName || currentUser?.companyName || '',
      });

      setIsDirty(true);
      setFormData((prev) => ({ ...prev, internalId: result.tag }));
      toast.success(`Patrimônio gerado: ${result.tag}`, {
        description: result.description,
      });
    } catch (err) {
      console.error('Falha ao gerar tag sequencial:', err);
      toast.error('Erro ao calcular sequência de patrimônio.');
    } finally {
      setTagGenerating(false);
    }
  }, [formData.type, formData.location, tenantAssets, tenantSettings, currentUser?.tenantId, currentUser?.companyName, currentUser?.authSource]);

  // Atalhos Rápidos para Cálculo de Garantia (+1A, +2A, +3A, +5A)
  const handleAddWarrantyYears = (years) => {
    const baseDateStr = formData.purchaseDate || new Date().toISOString().split('T')[0];
    const [year, month, day] = baseDateStr.split('-').map(Number);
    const newYear = year + years;
    const newDate = `${newYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setIsDirty(true);
    setFormData((prev) => ({ ...prev, warrantyEnd: newDate }));
    toast.success(`Garantia estendida em +${years} ano${years > 1 ? 's' : ''}`);
  };

  // Processo central de persistência
  const saveAssetInternal = async (isSaveAndNew = false) => {
    if (submittingRef.current || loading || tagChecking) return false;
    if (tagExists) {
      toast.error('Já existe um ativo cadastrado com esta Tag/Patrimônio!');
      return false;
    }
    const trimmedInternalId = String(formData.internalId || '').trim();
    if (!trimmedInternalId) {
      toast.error('Informe a Tag/Patrimônio do ativo.');
      return false;
    }

    submittingRef.current = true;
    setLoading(true);
    try {
      const cleanData = JSON.parse(JSON.stringify(formData));
      cleanData.internalId = trimmedInternalId;
      const userEmail = currentUser?.email || 'Usuário Desconhecido';

      if (id) {
        const diffs = [];
        if (initialData) {
          const fieldsMap = {
            model: 'Modelo', internalId: 'Patrimônio', type: 'Tipo', category: 'Categoria',
            status: 'Status', location: 'Localização', assignedTo: 'Responsável',
            sector: 'Setor', vendedor: 'Vendedor', purchaseDate: 'Data de Aquisição',
            serialNumber: 'Serial Number', valor: 'Valor', warrantyEnd: 'Fim da Garantia',
            supplier: 'Fornecedor', invoiceNumber: 'Nota Fiscal', costCenter: 'Centro de Custo',
          };

          Object.keys(fieldsMap).forEach((key) => {
            if (initialData[key] !== cleanData[key]) {
              diffs.push(`Alterou ${fieldsMap[key]} de '${initialData[key] || 'Vazio'}' para '${cleanData[key] || 'Vazio'}'`);
            }
          });
        }

        if (transit && initialData) {
          cleanData.status = initialData.status;
          cleanData.location = initialData.location;
        }

        const detailsText = diffs.length > 0 ? diffs.join(', ') : 'Dados atualizados sem modificações rastreadas.';
        const tenantId = originalTenantId || currentUser?.tenantId;

        await updateAsset(id, {
          ...cleanData,
          tenantId,
        }, {
          action: 'Edição de Ativo',
          details: detailsText,
          user: userEmail,
          tenantId,
        });

        setIsDirty(false);
        toast.success('Ativo atualizado com sucesso!');
        navigate('/assets');
        return true;
      }

      // Novo Ativo
      const tenantId = currentUser?.tenantId;
      if (currentUser?.authSource !== 'gateway') {
        await assertWithinLimit(currentUser, 'assets', 1);
      }
      await createAsset({
        ...cleanData,
        createdBy: userEmail,
        tenantId,
      });

      // Salva preferências de lote para o próximo ativo
      localStorage.setItem('itam_last_type', cleanData.type);
      localStorage.setItem('itam_last_category', cleanData.category);
      localStorage.setItem('itam_last_location', cleanData.location);

      setIsDirty(false);
      toast.success('Ativo cadastrado com sucesso!');

      if (isSaveAndNew) {
        // Modo lote: preserva propriedades de remessa e limpa identificadores individuais
        setFormData((prev) => ({
          ...prev,
          model: '',
          internalId: '',
          serialNumber: '',
          assignedTo: '',
          assignedToEmail: '',
          clientCpf: '',
          employeeId: '',
          sector: '',
          notes: '',
          specs: { ip: '', ram: '', storage: '', pageCount: '', processor: '' },
          customData: {},
        }));
        setTagExists(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return true;
      }

      navigate('/assets');
      return true;
    } catch (error) {
      console.error(error);
      toast.error(describeFirebaseError(error, 'Erro ao salvar! Verifique sua conexão.'));
      return false;
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    saveAssetInternal(false);
  };

  if (id && loadingAsset) {
    return (
      <div
        role="status"
        aria-label="Carregando dados do ativo…"
        className="flex min-h-[60vh] items-center justify-center"
      >
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-brand dark:border-zinc-800 dark:border-t-brand" aria-hidden="true" />
        <span className="sr-only">Carregando dados do ativo…</span>
      </div>
    );
  }

  if (id && (assetNotFound || loadError)) {
    return (
      <div
        role="alert"
        className="max-w-xl mx-auto mt-12 p-8 bg-white dark:bg-[#111113] rounded-2xl border border-rose-200 dark:border-rose-900/60 shadow-sm text-center space-y-4"
      >
        <div className="w-12 h-12 mx-auto rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center">
          <AlertCircle size={24} aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-slate-900 dark:text-[#fafafa]">
            {assetNotFound ? 'Ativo não encontrado' : 'Erro ao carregar ativo'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-zinc-400">
            {loadError || 'Este ativo não foi encontrado, foi excluído ou pertence a outra empresa.'}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          {loadError && (
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg font-semibold text-sm active:scale-[0.98] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <RefreshCw size={16} aria-hidden="true" /> Tentar novamente
            </button>
          )}
          <Link
            to="/assets"
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 font-semibold text-sm active:scale-[0.98] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <ArrowLeft size={16} aria-hidden="true" /> Voltar para Lista
          </Link>
        </div>
      </div>
    );
  }

  const isPromotional = formData.category === 'Promocional';
  const catalog = buildAssetCatalog(customTypes);
  const garantia = warrantyStatus(formData.warrantyEnd);
  const baixado = isRetired(formData.status);
  const statusOptions = MANUAL_STATUSES.some((st) => st.id === formData.status)
    ? MANUAL_STATUSES
    : [...MANUAL_STATUSES, { id: formData.status, label: formData.status }];
  const activeSpecs = catalog.find((t) => t.id === formData.type)?.specs || [];

  const isAgentCompatible = ['Computador', 'Notebook', 'Servidor'].includes(formData.type) || Boolean(formData.agent);

  return (
    <div className="max-w-6xl mx-auto pb-32 animate-fade-in">
      {/* =================================================================== */}
      {/* CABEÇALHO EXECUTIVO                                                 */}
      {/* =================================================================== */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-200/80 dark:border-zinc-800">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to="/assets"
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl border border-slate-200/90 dark:border-zinc-800 bg-white dark:bg-[#111113] text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-[#fafafa] hover:border-slate-300 dark:hover:border-zinc-700 shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            title="Cancelar e voltar à lista de ativos"
            aria-label="Cancelar e voltar à lista de ativos"
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-[#fafafa] truncate tracking-tight">
                {id ? 'Editar Ativo' : 'Novo Ativo'}
              </h1>
              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md border border-slate-200/90 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-300 shrink-0">
                {formData.type}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-zinc-400 truncate mt-0.5 tabular-nums">
              {id ? `Patrimônio: ${formData.internalId || id}` : 'Cadastro no inventário e telemetria'}
            </p>
          </div>
        </div>

        {/* Resumo visual do tipo e status */}
        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 dark:bg-brand text-white dark:text-brand-fg shadow-sm" aria-hidden="true">
            <AssetIcon type={formData.type} size={20} className="text-current" />
          </div>
        </div>
      </div>

      {/* =================================================================== */}
      {/* FORMULÁRIO PRINCIPAL                                               */}
      {/* =================================================================== */}
      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ================================================================= */}
        {/* COLUNA ESQUERDA & CENTRAL (2/3): IDENTIFICAÇÃO E HARDWARE         */}
        {/* ================================================================= */}
        <div className="lg:col-span-2 space-y-6">
          {/* BLOCO 1: IDENTIFICAÇÃO & CLASSIFICAÇÃO */}
          <div className="bg-white dark:bg-[#111113] p-5 sm:p-6 rounded-2xl border border-slate-200/90 dark:border-zinc-800 shadow-sm space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-zinc-800">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-2">
                <Tag size={15} className="text-brand-aa" aria-hidden="true" /> Identificação & Classificação
              </h2>
              <span className="text-xs font-medium tabular-nums text-slate-500 dark:text-zinc-400">
                Passo 1 de 4
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label htmlFor="asset-model" className="text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5 block">
                  Nome / Modelo do Equipamento <span className="text-rose-500">*</span>
                </label>
                <input
                  id="asset-model"
                  name="model"
                  value={formData.model}
                  onChange={handleChange}
                  required
                  placeholder="Ex: Notebook Dell Latitude 3420"
                  className={fieldCls}
                />
              </div>

              {/* Patrimônio (Tag) com auto-gerador e leitor de câmera */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="asset-internal-id" className="text-xs font-semibold text-slate-700 dark:text-zinc-300">
                    Patrimônio (Tag) <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateTag}
                    disabled={tagGenerating}
                    className="min-h-[44px] px-2 -my-1.5 text-xs font-semibold text-brand-aa hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-lg"
                    title="Gerar código sequencial de patrimônio no padrão da empresa"
                  >
                    <Sparkles size={12} className={tagGenerating ? 'animate-spin' : ''} aria-hidden="true" />
                    {tagGenerating ? 'Calculando…' : 'Gerar Tag'}
                  </button>
                </div>
                <div className="relative">
                  <Hash size={16} aria-hidden="true" className="absolute left-3.5 top-3.5 text-slate-400 dark:text-zinc-500 pointer-events-none" />
                  <input
                    id="asset-internal-id"
                    name="internalId"
                    value={formData.internalId}
                    onChange={handleChange}
                    required
                    aria-invalid={tagExists ? 'true' : undefined}
                    aria-describedby={tagExists ? 'tag-exists-error' : undefined}
                    placeholder="Ex: NB-001"
                    className={`${fieldCls} pl-10 pr-12 font-mono font-bold uppercase ${
                      tagExists
                        ? 'border-rose-500 dark:border-rose-600 text-rose-600 dark:text-rose-400 bg-rose-50/50 dark:bg-rose-950/20'
                        : ''
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setScanTarget('internalId')}
                    title="Escanear etiqueta por câmera"
                    aria-label="Escanear Patrimônio com a câmera"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center absolute right-0 top-0 rounded-xl text-slate-400 hover:text-brand-aa hover:bg-slate-200/60 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <Camera size={16} aria-hidden="true" />
                  </button>
                </div>
                {tagChecking && (
                  <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 flex items-center gap-1">
                    Verificando disponibilidade…
                  </p>
                )}
                {tagExists && (
                  <p id="tag-exists-error" role="alert" className="text-xs text-rose-600 dark:text-rose-400 font-semibold mt-1 flex items-center gap-1">
                    <AlertCircle size={12} aria-hidden="true" /> Já existe um ativo com esta Tag nesta empresa!
                  </p>
                )}
              </div>

              {/* Número de Série com leitor por câmera */}
              <div>
                <label htmlFor="asset-serial" className="text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5 block">
                  Número de Série (Serial)
                </label>
                <div className="relative">
                  <input
                    id="asset-serial"
                    name="serialNumber"
                    value={formData.serialNumber}
                    onChange={handleChange}
                    placeholder="N/A ou código serial"
                    className={`${fieldCls} pl-3.5 pr-12 font-mono`}
                  />
                  <button
                    type="button"
                    onClick={() => setScanTarget('serialNumber')}
                    title="Escanear número de série com a câmera"
                    aria-label="Escanear número de série com a câmera"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center absolute right-0 top-0 rounded-xl text-slate-400 hover:text-brand-aa hover:bg-slate-200/60 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <Camera size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>

            {/* Seletor visual de tipo de equipamento */}
            <div className="pt-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-2.5 block">
                Tipo de Equipamento
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2" role="group" aria-label="Tipo de Equipamento">
                {catalog.map((t) => {
                  const Icon = t.icon;
                  const isSelected = formData.type === t.id;
                  return (
                    <button
                      type="button"
                      key={t.id}
                      aria-pressed={isSelected}
                      onClick={() => {
                        setIsDirty(true);
                        setFormData((prev) => ({ ...prev, type: t.id }));
                      }}
                      className={`min-h-[44px] flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-xl border transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand text-center cursor-pointer ${
                        isSelected
                          ? 'border-brand bg-brand/10 dark:bg-brand/20 text-brand-aa font-bold ring-2 ring-brand/20 shadow-sm'
                          : 'border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/60 text-slate-600 dark:text-zinc-400 hover:border-slate-300 dark:hover:border-zinc-700 hover:bg-white dark:hover:bg-zinc-800'
                      }`}
                    >
                      <Icon size={18} strokeWidth={isSelected ? 2.3 : 1.8} aria-hidden="true" />
                      <span className="text-xs truncate tracking-tight">{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* BLOCO 2: ESPECIFICAÇÕES TÉCNICAS & NEXUSDESK AGENTE V3.1 */}
          <div className="bg-white dark:bg-[#111113] p-5 sm:p-6 rounded-2xl border border-slate-200/90 dark:border-zinc-800 shadow-sm space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-zinc-800">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-2">
                <Server size={15} className="text-brand-aa" aria-hidden="true" /> Especificações Técnicas & Hardware
              </h2>
              <span className="text-xs font-medium tabular-nums text-slate-500 dark:text-zinc-400">
                Passo 2 de 4
              </span>
            </div>

            {/* Painel do Agente ITAM / NexusDesk (se aplicável) */}
            {isAgentCompatible && (
              <div className="p-3.5 rounded-xl border border-brand/20 bg-brand/5 dark:bg-brand/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                    <span className="inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 dark:text-[#fafafa] truncate">
                      Telemetria NexusDesk v{AGENT_VERSION.slice(0, 3)}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 truncate">
                      {formData.agent?.machineId
                        ? `Máquina vinculada: ${formData.agent.machineId}`
                        : `Pronto para sincronização automática via Agente Nexus (v${AGENT_VERSION})`}
                    </p>
                  </div>
                </div>

                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-white dark:bg-[#111113] border border-brand/30 text-brand-aa shrink-0">
                  RMM TLS v{AGENT_VERSION.slice(0, 3)}
                </span>
              </div>
            )}

            {/* Campos de especificações dinâmicos baseados no catálogo */}
            {activeSpecs.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeSpecs.map((field) => {
                  const def = SPEC_FIELDS[field];
                  const name = isRootSpec(field) ? field : `specs.${field}`;
                  const inputId = `spec-${field}`;
                  const value = isRootSpec(field)
                    ? formData[field] || ''
                    : formData.specs?.[field] || '';
                  return (
                    <div key={field}>
                      <label htmlFor={inputId} className="text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5 block">
                        {def.label}
                      </label>
                      <input
                        id={inputId}
                        type={def.type || 'text'}
                        name={name}
                        value={value}
                        onChange={handleChange}
                        placeholder={def.placeholder}
                        className={`${fieldCls} font-medium ${def.mono ? 'font-mono tabular-nums' : ''}`}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-zinc-400 italic text-center py-4 bg-slate-50/50 dark:bg-zinc-900/40 rounded-xl border border-dashed border-slate-200 dark:border-zinc-800">
                Sem especificações adicionais obrigatórias para {formData.type}.
              </p>
            )}
          </div>

          {/* BLOCO 3: CAMPOS CUSTOMIZADOS & NOTAS */}
          <div className="bg-white dark:bg-[#111113] p-5 sm:p-6 rounded-2xl border border-slate-200/90 dark:border-zinc-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-zinc-800">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-2">
                <FileText size={15} className="text-brand-aa" aria-hidden="true" /> Observações & Campos Extras
              </h2>
              <span className="text-xs font-medium tabular-nums text-slate-500 dark:text-zinc-400">
                Passo 3 de 4
              </span>
            </div>

            {/* Campos configurados pela empresa */}
            {customFieldsDef.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-2">
                {customFieldsDef.map((cf) => {
                  const cfId = `custom-${cf.id}`;
                  return (
                    <div key={cf.id}>
                      <label htmlFor={cfId} className="text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5 block">
                        {cf.label}
                      </label>
                      {cf.type === 'textarea' ? (
                        <textarea
                          id={cfId}
                          name={`customData.${cf.id}`}
                          value={formData.customData[cf.id] || ''}
                          onChange={(e) => handleCustomDataChange(cf.id, e.target.value)}
                          className={`${fieldCls} font-normal resize-none h-20`}
                        />
                      ) : (
                        <input
                          id={cfId}
                          name={`customData.${cf.id}`}
                          type={cf.type === 'number' ? 'number' : cf.type === 'date' ? 'date' : 'text'}
                          value={formData.customData[cf.id] || ''}
                          onChange={(e) => handleCustomDataChange(cf.id, e.target.value)}
                          className={`${fieldCls} font-normal`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div>
              <label htmlFor="asset-notes" className="text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5 block">
                Histórico & Observações Livres
              </label>
              <textarea
                id="asset-notes"
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                rows={3}
                placeholder="Detalhes adicionais, avarias conhecidas, acessórios inclusos…"
                className={`${fieldCls} font-normal resize-none`}
              />
            </div>
          </div>
        </div>

        {/* ================================================================= */}
        {/* COLUNA DIREITA (1/3): CUSTÓDIA, STATUS E DADOS FINANCEIROS         */}
        {/* ================================================================= */}
        <div className="space-y-6">
          {/* BLOCO 4: STATUS OPERACIONAL & CLASSIFICAÇÃO */}
          <div className="bg-white dark:bg-[#111113] p-5 rounded-2xl border border-slate-200/90 dark:border-zinc-800 shadow-sm space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-zinc-800">
              <ShieldCheck size={15} className="text-brand-aa" aria-hidden="true" /> Status & Categoria
            </h2>

            <div>
              <label htmlFor="asset-status" className="text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5 block">
                Status Atual do Ativo
              </label>

              {transit ? (
                <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-3">
                  <StatusBadge status={formData.status} />
                  <p className="mt-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300 font-medium">
                    Em trânsito de {transit.from} para {transit.to} ({transit.number}).
                  </p>
                </div>
              ) : baixado ? (
                <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 p-3">
                  <div className="flex items-center gap-2">
                    <Archive size={15} className="text-slate-400 dark:text-zinc-400" aria-hidden="true" />
                    <StatusBadge status={formData.status} />
                  </div>
                  {formData.writeOffReason && (
                    <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-zinc-400">
                      {formData.writeOffReason}
                      {formData.writeOffDate && ` · ${formData.writeOffDate}`}
                    </p>
                  )}
                  <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-zinc-400">
                    Reativação permitida apenas pela tela de detalhe do ativo.
                  </p>
                </div>
              ) : (
                <div className="relative">
                  <select
                    id="asset-status"
                    name="status"
                    value={formData.status}
                    onChange={handleChange}
                    className={`${fieldCls} appearance-none pr-8 font-bold cursor-pointer`}
                  >
                    {statusOptions.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                  <div aria-hidden="true" className={`absolute right-3.5 top-4 w-2 h-2 rounded-full pointer-events-none ${statusDotClass(formData.status)}`} />
                </div>
              )}
            </div>

            <div>
              <label htmlFor="asset-category" className="text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5 block">
                Classificação Contábil
              </label>
              <select
                id="asset-category"
                name="category"
                value={formData.category}
                onChange={handleChange}
                className={`${fieldCls} font-bold cursor-pointer`}
              >
                <option value="Corporativo">Corporativo (Patrimônio)</option>
                <option value="Promocional">Promocional (Comodato)</option>
                <option value="Infra">Infraestrutura</option>
              </select>
            </div>
          </div>

          {/* BLOCO 5: CUSTÓDIA, EQUIPE & LOCALIZAÇÃO */}
          <div className="bg-white dark:bg-[#111113] p-5 rounded-2xl border border-slate-200/90 dark:border-zinc-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-zinc-800">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-2">
                <User size={15} className="text-brand-aa" aria-hidden="true" /> Custódia & Local
              </h2>
              <Link to="/employees" className="min-h-[44px] inline-flex items-center px-1 text-xs font-semibold text-brand-aa hover:underline active:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded">
                + Equipe
              </Link>
            </div>

            <div>
              <label htmlFor="asset-assigned-select" className="text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5 block">
                {isPromotional ? 'Beneficiário / Cliente' : 'Responsável (Colaborador)'}
              </label>
              <div className="relative">
                <select
                  id="asset-assigned-select"
                  name="assignedTo"
                  value={formData.assignedTo}
                  onChange={handleEmployeeSelect}
                  className={`${fieldCls} appearance-none pr-9 cursor-pointer`}
                >
                  <option value="">Selecione um colaborador…</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.name}>
                      {emp.name} {emp.sector ? `(${emp.sector})` : ''}
                    </option>
                  ))}
                </select>
                <Search size={15} aria-hidden="true" className="absolute right-3.5 top-3.5 text-slate-400 pointer-events-none" />
              </div>

              {/* Digitação avulsa fora do cadastro com aviso visual */}
              {formData.assignedTo && !employees.some((e) => e.name === formData.assignedTo) && (
                <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-900/50 rounded-lg text-xs text-amber-800 dark:text-amber-400 font-medium">
                  Responsável avulso: <span className="font-bold">{formData.assignedTo}</span>
                </div>
              )}
              <label htmlFor="asset-assigned-manual" className="sr-only">
                Ou digite um nome fora do cadastro
              </label>
              <input
                id="asset-assigned-manual"
                name="assignedToManual"
                value={formData.assignedTo}
                onChange={(e) => {
                  setIsDirty(true);
                  setFormData((prev) => ({
                    ...prev,
                    assignedTo: e.target.value,
                    assignedToEmail: '',
                    employeeId: '',
                  }));
                }}
                placeholder="Ou digite um nome fora do cadastro…"
                className={`${fieldCls} mt-2 text-xs font-medium`}
              />
            </div>

            <div>
              <label htmlFor="asset-sector" className="text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5 block">
                {isPromotional ? 'Campanha / Evento' : 'Setor / Departamento'}
              </label>
              <div className="relative">
                <Building2 size={15} aria-hidden="true" className="absolute left-3 top-3.5 text-slate-400 dark:text-zinc-500 pointer-events-none" />
                <input
                  id="asset-sector"
                  name="sector"
                  value={formData.sector}
                  onChange={handleChange}
                  placeholder="Ex: TI / Operações"
                  className={`${fieldCls} pl-9 font-medium`}
                />
              </div>
            </div>

            {isPromotional && (
              <div>
                <label htmlFor="asset-vendedor" className="text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5 block">
                  Vendedor Responsável
                </label>
                <input
                  id="asset-vendedor"
                  name="vendedor"
                  value={formData.vendedor}
                  onChange={handleChange}
                  placeholder="Nome do consultor/vendedor"
                  className={`${fieldCls} font-medium`}
                />
              </div>
            )}

            <div>
              <label htmlFor="asset-location" className="text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5 block">
                Localização Física / Filial
              </label>
              <div className="relative">
                <MapPin size={15} aria-hidden="true" className="absolute left-3 top-3.5 text-slate-400 dark:text-zinc-500 pointer-events-none" />
                <LocationSelect
                  id="asset-location"
                  value={formData.location}
                  onChange={handleChange}
                  disabled={Boolean(transit)}
                  showManageLink
                  className={`${fieldCls} pl-9 cursor-pointer`}
                />
              </div>
            </div>
          </div>

          {/* BLOCO 6: AQUISIÇÃO, GARANTIA & NOTA FISCAL */}
          <div className="bg-white dark:bg-[#111113] p-5 rounded-2xl border border-slate-200/90 dark:border-zinc-800 shadow-sm space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-zinc-800">
              <DollarSign size={15} className="text-brand-aa" aria-hidden="true" /> Aquisição & Garantia
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="asset-valor" className="text-xs font-semibold text-slate-600 dark:text-zinc-400 mb-1 block">
                  Valor (R$)
                </label>
                <input
                  id="asset-valor"
                  name="valor"
                  value={formData.valor}
                  onChange={handleChange}
                  inputMode="decimal"
                  placeholder="0,00"
                  className={`${fieldCls} font-mono font-bold tabular-nums`}
                />
              </div>

              <div>
                <label htmlFor="asset-purchase-date" className="text-xs font-semibold text-slate-600 dark:text-zinc-400 mb-1 block">
                  Data da Compra
                </label>
                <input
                  id="asset-purchase-date"
                  type="date"
                  name="purchaseDate"
                  value={formData.purchaseDate}
                  onChange={handleChange}
                  className={`${fieldCls} text-xs tabular-nums`}
                />
              </div>

              {/* Fim da Garantia com botões rápidos */}
              <div className="col-span-2 pt-1 border-t border-slate-100 dark:border-zinc-800">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <label htmlFor="asset-warranty-end" className="text-xs font-semibold text-slate-600 dark:text-zinc-400">
                    Fim da Garantia
                  </label>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 5].map((yrs) => (
                      <button
                        type="button"
                        key={yrs}
                        onClick={() => handleAddWarrantyYears(yrs)}
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-xs font-mono font-bold tabular-nums px-2 py-1 rounded-lg bg-slate-100 hover:bg-brand/10 dark:bg-zinc-900 dark:hover:bg-brand/20 text-slate-600 dark:text-zinc-300 hover:text-brand-aa transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand cursor-pointer"
                        title={`Calcular garantia para +${yrs} ano(s)`}
                      >
                        +{yrs}A
                      </button>
                    ))}
                  </div>
                </div>

                <input
                  id="asset-warranty-end"
                  type="date"
                  name="warrantyEnd"
                  value={formData.warrantyEnd}
                  onChange={handleChange}
                  className={`${fieldCls} text-xs tabular-nums`}
                />

                {garantia && (
                  <div className="mt-1.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold uppercase tabular-nums ${
                        WARRANTY_BADGE[garantia.state]
                      }`}
                    >
                      <ShieldCheck size={12} aria-hidden="true" />
                      {WARRANTY_LABEL[garantia.state]}
                      {garantia.state !== 'expirada' && ` · ${garantia.days}d`}
                    </span>
                  </div>
                )}
              </div>

              <div className="col-span-2">
                <label htmlFor="asset-supplier" className="text-xs font-semibold text-slate-600 dark:text-zinc-400 mb-1 block">
                  Fornecedor
                </label>
                <input
                  id="asset-supplier"
                  name="supplier"
                  value={formData.supplier}
                  onChange={handleChange}
                  placeholder="Ex: Dell do Brasil Ltda"
                  className={`${fieldCls} font-normal`}
                />
              </div>

              <div>
                <label htmlFor="asset-invoice" className="text-xs font-semibold text-slate-600 dark:text-zinc-400 mb-1 block">
                  Nota Fiscal
                </label>
                <input
                  id="asset-invoice"
                  name="invoiceNumber"
                  value={formData.invoiceNumber}
                  onChange={handleChange}
                  placeholder="Nº da NF"
                  className={`${fieldCls} font-mono font-normal tabular-nums`}
                />
              </div>

              <div>
                <label htmlFor="asset-cost-center" className="text-xs font-semibold text-slate-600 dark:text-zinc-400 mb-1 block">
                  Centro de Custo
                </label>
                <input
                  id="asset-cost-center"
                  name="costCenter"
                  value={formData.costCenter}
                  onChange={handleChange}
                  placeholder="Ex: TI-001"
                  className={`${fieldCls} font-normal`}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ================================================================= */}
        {/* BARRA DE AÇÕES FIXA (STICKY ACTION BAR)                           */}
        {/* ================================================================= */}
        <div className="lg:col-span-3 sticky bottom-4 z-30">
          <div className="bg-white/95 dark:bg-[#111113]/95 backdrop-blur-md p-3 sm:p-4 rounded-2xl border border-slate-200/90 dark:border-zinc-800 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-400">
              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
                {formData.internalId || 'SEM TAG'}
              </span>
              <span aria-hidden="true">•</span>
              <span className="font-semibold text-slate-700 dark:text-zinc-300">
                {formData.model || 'Sem modelo informado'}
              </span>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => navigate('/assets')}
                className="min-h-[44px] flex-1 sm:flex-initial px-4 py-2.5 rounded-xl border border-slate-200/90 dark:border-zinc-800 text-xs font-semibold text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Cancelar
              </button>

              {!id && (
                <button
                  type="button"
                  onClick={() => saveAssetInternal(true)}
                  disabled={loading || tagChecking || tagExists}
                  className="min-h-[44px] flex-1 sm:flex-initial px-4 py-2.5 rounded-xl border border-brand/30 bg-brand/10 dark:bg-brand/20 text-xs font-semibold text-brand-aa hover:bg-brand/20 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                  title="Salva o ativo atual e mantém fornecedor/local para cadastrar outro"
                >
                  <Plus size={14} aria-hidden="true" />
                  <span>Salvar & Novo</span>
                </button>
              )}

              <button
                type="submit"
                disabled={loading || tagChecking || tagExists}
                className="min-h-[44px] flex-1 sm:flex-initial px-5 py-2.5 bg-brand hover:bg-brand-dark text-brand-fg rounded-xl text-xs font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {loading ? (
                  <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" aria-hidden="true" />
                ) : (
                  <>
                    <Save size={15} aria-hidden="true" />
                    <span>{id ? 'Salvar Alterações' : 'Cadastrar Ativo'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Leitor de Código de Barras / QR Code via Câmera */}
      {scanTarget && (
        <QRScanner
          title={
            scanTarget === 'internalId'
              ? 'Escanear Etiqueta de Patrimônio'
              : 'Escanear Número de Série (Serial)'
          }
          onScan={(code) => {
            const clean = String(code || '').trim();
            setIsDirty(true);
            setFormData((prev) => ({
              ...prev,
              [scanTarget]: scanTarget === 'internalId' ? clean.toUpperCase() : clean,
            }));
            setScanTarget(null);
            toast.success(`Código escaneado: ${clean}`);
          }}
          onClose={() => setScanTarget(null)}
        />
      )}
    </div>
  );
};

export default AssetForm;
