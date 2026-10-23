// src/pages/AssetForm.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getEmployees } from '../services/employeeService';
import {
  createAsset,
  updateAsset,
  getAssetById,
  getAssetByInternalId,
} from '../services/assetService';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import { assertWithinLimit, describeFirebaseError } from '../services/tenantService';
import { toast } from 'sonner';
import {
  Save, ArrowLeft, Search, Server, User, MapPin, Building2, Tag,
  DollarSign, FileText, ShieldCheck, Archive, Camera, Sparkles,
  AlertCircle, Plus, Hash,
} from 'lucide-react';
import QRScanner from '../components/QRScanner';
import AssetIcon from '../components/AssetIcon';
import { buildAssetCatalog, SPEC_FIELDS, isRootSpec } from '../utils/assetTypes';
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

/**
 * Módulo de Cadastro & Edição de Ativos — Nexus ITAM v2.2.
 * - Organização executiva por blocos temáticos de alta definição.
 * - Auto-gerador de Tag/Patrimônio e validação de duplicidade em tempo real.
 * - Atalhos rápidos para cálculo de garantia (+1A, +2A, +3A, +5A).
 * - Modo Lote ("Salvar e Adicionar Outro") para cadastro ágil de remessas.
 * - Integração e preservação total de telemetria do Agente v3.1 / NexusDesk.
 * - Barra de ações fixa responsiva para desktop e dispositivos móveis.
 */
const AssetForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(false);
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

  const [formData, setFormData] = useState({
    model: '',
    internalId: '',
    type: localStorage.getItem('itam_last_type') || 'Computador',
    category: localStorage.getItem('itam_last_category') || 'Corporativo', // 'Corporativo', 'Promocional', 'Infra'
    status: 'Em Uso',
    location: localStorage.getItem('itam_last_location') || '',
    assignedTo: '',
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
    const init = async () => {
      try {
        const empList = await getEmployees(currentUser?.tenantId);
        setEmployees(empList);

        if (currentUser?.tenantId) {
          const settingsSnap = await getDoc(doc(db, 'settings', currentUser.tenantId));
          if (settingsSnap.exists()) {
            const cfg = settingsSnap.data();
            if (cfg.customFields) setCustomFieldsDef(cfg.customFields);
            if (cfg.assetTypes) setCustomTypes(cfg.assetTypes);
          }
        }

        if (id) {
          const data = await getAssetById(id, currentUser?.role === 'superadmin' ? null : currentUser?.tenantId);
          if (data) {
            const loadedData = {
              model: data.model || '',
              internalId: data.internalId || '',
              type: data.type || 'Computador',
              category: data.category || 'Corporativo',
              status: data.status || 'Em Uso',
              location: data.location || '',
              assignedTo: data.assignedTo || '',
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
            setTransit(data.transit || null);
            setOriginalTenantId(data.tenantId || null);
          }
        }
      } catch (error) {
        console.error(error);
      }
    };
    init();
  }, [id, navigate, currentUser?.tenantId, currentUser?.role]);

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
    if (name.startsWith('specs.')) {
      const field = name.split('.')[1];
      setFormData((prev) => ({ ...prev, specs: { ...prev.specs, [field]: value } }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleCustomDataChange = (fieldId, value) => {
    setFormData((prev) => ({ ...prev, customData: { ...prev.customData, [fieldId]: value } }));
  };

  const handleEmployeeSelect = (e) => {
    const selectedName = e.target.value;
    if (!selectedName) {
      setFormData((prev) => ({ ...prev, assignedTo: '', clientCpf: '', sector: '', employeeId: '' }));
      return;
    }
    const emp = employees.find((ep) => ep.name === selectedName);
    if (emp) {
      setFormData((prev) => ({
        ...prev,
        assignedTo: emp.name,
        clientCpf: emp.cpf || '',
        sector: emp.sector || '',
        location: emp.branch || prev.location,
        employeeId: emp.id,
      }));
    } else {
      setFormData((prev) => ({ ...prev, assignedTo: selectedName }));
    }
  };

  // Gerador de Patrimônio / Tag Automático
  const handleGenerateTag = useCallback(() => {
    const year = new Date().getFullYear().toString().slice(-2);
    const rand = Math.floor(1000 + Math.random() * 9000);
    const prefixMap = {
      Computador: 'PC',
      Notebook: 'NB',
      Servidor: 'SRV',
      Celular: 'CEL',
      Tablet: 'TAB',
      Impressora: 'PRT',
      Monitor: 'MON',
      Switch: 'SW',
      Rede: 'NET',
      Storage: 'NAS',
      Nobreak: 'NOB',
      Projetor: 'PRJ',
      Camera: 'CAM',
    };
    const prefix = prefixMap[formData.type] || 'AST';
    const generated = `${prefix}-${year}${rand}`;
    setFormData((prev) => ({ ...prev, internalId: generated }));
    toast.info(`Patrimônio sugerido: ${generated}`);
  }, [formData.type]);

  // Atalhos Rápidos para Cálculo de Garantia (+1A, +2A, +3A, +5A)
  const handleAddWarrantyYears = (years) => {
    const baseDateStr = formData.purchaseDate || new Date().toISOString().split('T')[0];
    const [year, month, day] = baseDateStr.split('-').map(Number);
    const newYear = year + years;
    const newDate = `${newYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setFormData((prev) => ({ ...prev, warrantyEnd: newDate }));
    toast.success(`Garantia estendida em +${years} ano${years > 1 ? 's' : ''}`);
  };

  // Processo central de persistência
  const saveAssetInternal = async (isSaveAndNew = false) => {
    setLoading(true);
    try {
      const cleanData = JSON.parse(JSON.stringify(formData));
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

        toast.success('Ativo atualizado com sucesso!');
        navigate('/assets');
        return true;
      }

      // Novo Ativo
      const tenantId = currentUser?.tenantId;
      await assertWithinLimit(currentUser, 'assets', 1);
      await createAsset({
        ...cleanData,
        createdBy: userEmail,
        tenantId,
      });

      // Salva preferências de lote para o próximo ativo
      localStorage.setItem('itam_last_type', cleanData.type);
      localStorage.setItem('itam_last_category', cleanData.category);
      localStorage.setItem('itam_last_location', cleanData.location);

      toast.success('Ativo cadastrado com sucesso!');

      if (isSaveAndNew) {
        // Modo lote: preserva propriedades de remessa e limpa identificadores individuais
        setFormData((prev) => ({
          ...prev,
          model: '',
          internalId: '',
          serialNumber: '',
          assignedTo: '',
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
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (tagExists) {
      toast.error('Já existe um ativo cadastrado com esta Tag/Patrimônio!');
      return;
    }
    saveAssetInternal(false);
  };

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
    <div className="max-w-6xl mx-auto pb-32 animate-in fade-in duration-200">
      {/* =================================================================== */}
      {/* CABEÇALHO EXECUTIVO                                                 */}
      {/* =================================================================== */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-200/80 dark:border-slate-800/80">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to="/assets"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs transition-colors"
            title="Cancelar e voltar à lista de ativos"
          >
            <ArrowLeft size={16} />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 truncate tracking-tight">
                {id ? 'Editar Ativo' : 'Novo Ativo'}
              </h1>
              <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-md border border-slate-200/90 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 shrink-0">
                {formData.type}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
              {id ? `Patrimônio: ${formData.internalId || id}` : 'Cadastro no inventário e telemetria'}
            </p>
          </div>
        </div>

        {/* Resumo visual do tipo e status */}
        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 dark:bg-brand text-white shadow-xs">
            <AssetIcon type={formData.type} size={20} className="text-white" />
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
          <div className="bg-white dark:bg-[#0D121F] p-5 sm:p-6 rounded-2xl border border-slate-200/90 dark:border-slate-800/80 shadow-2xs space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800/80">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <Tag size={15} className="text-brand" /> Identificação & Classificação
              </h3>
              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                Passo 1 de 4
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 block">
                  Nome / Modelo do Equipamento <span className="text-rose-500">*</span>
                </label>
                <input
                  name="model"
                  value={formData.model}
                  onChange={handleChange}
                  required
                  placeholder="Ex: Notebook Dell Latitude 3420"
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-xl text-sm font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 focus:bg-white dark:focus:bg-slate-900 focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none transition-all"
                />
              </div>

              {/* Patrimônio (Tag) com auto-gerador e leitor de câmera */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Patrimônio (Tag) <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateTag}
                    className="text-[11px] font-semibold text-brand hover:underline flex items-center gap-1 cursor-pointer"
                    title="Gerar código sequencial de patrimônio"
                  >
                    <Sparkles size={11} /> Gerar Tag
                  </button>
                </div>
                <div className="relative">
                  <Hash size={16} className="absolute left-3.5 top-3 text-slate-400 dark:text-slate-500 pointer-events-none" />
                  <input
                    name="internalId"
                    value={formData.internalId}
                    onChange={handleChange}
                    required
                    placeholder="Ex: NB-001"
                    className={`w-full pl-10 pr-10 py-2 bg-slate-50 dark:bg-slate-900/80 border rounded-xl font-mono text-sm font-bold uppercase outline-none transition-all ${
                      tagExists
                        ? 'border-rose-400 dark:border-rose-700 text-rose-600 bg-rose-50/50 dark:bg-rose-950/20'
                        : 'border-slate-200/90 dark:border-slate-800 text-slate-900 dark:text-white focus:bg-white dark:focus:bg-slate-900 focus:border-brand focus:ring-2 focus:ring-brand/20'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setScanTarget('internalId')}
                    title="Escanear etiqueta por câmera"
                    aria-label="Escanear Patrimônio com a câmera"
                    className="absolute right-2 top-1.5 p-1.5 rounded-lg text-slate-400 hover:text-brand hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
                  >
                    <Camera size={16} />
                  </button>
                </div>
                {tagChecking && (
                  <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                    Verificando disponibilidade...
                  </p>
                )}
                {tagExists && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold mt-1 flex items-center gap-1">
                    <AlertCircle size={12} /> Já existe um ativo com esta Tag nesta empresa!
                  </p>
                )}
              </div>

              {/* Número de Série com leitor por câmera */}
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 block">
                  Número de Série (Serial)
                </label>
                <div className="relative">
                  <input
                    name="serialNumber"
                    value={formData.serialNumber}
                    onChange={handleChange}
                    placeholder="N/A ou código serial"
                    className="w-full pl-3.5 pr-10 py-2 bg-slate-50 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-xl font-mono text-sm font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 focus:bg-white dark:focus:bg-slate-900 focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setScanTarget('serialNumber')}
                    title="Escanear número de série com a câmera"
                    aria-label="Escanear número de série com a câmera"
                    className="absolute right-2 top-1.5 p-1.5 rounded-lg text-slate-400 hover:text-brand hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
                  >
                    <Camera size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* Seletor visual de tipo de equipamento */}
            <div className="pt-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2.5 block">
                Tipo de Equipamento
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {catalog.map((t) => {
                  const Icon = t.icon;
                  const isSelected = formData.type === t.id;
                  return (
                    <button
                      type="button"
                      key={t.id}
                      onClick={() => setFormData((prev) => ({ ...prev, type: t.id }))}
                      className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-xl border transition-all text-center cursor-pointer ${
                        isSelected
                          ? 'border-brand bg-brand/10 dark:bg-brand/20 text-brand-dark dark:text-brand-light font-bold ring-2 ring-brand/20 shadow-xs'
                          : 'border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-white dark:hover:bg-slate-800'
                      }`}
                    >
                      <Icon size={18} strokeWidth={isSelected ? 2.3 : 1.8} />
                      <span className="text-[11px] truncate tracking-tight">{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* BLOCO 2: ESPECIFICAÇÕES TÉCNICAS & NEXUSDESK AGENTE V3.1 */}
          <div className="bg-white dark:bg-[#0D121F] p-5 sm:p-6 rounded-2xl border border-slate-200/90 dark:border-slate-800/80 shadow-2xs space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800/80">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <Server size={15} className="text-brand" /> Especificações Técnicas & Hardware
              </h3>
              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                Passo 2 de 4
              </span>
            </div>

            {/* Painel do Agente ITAM v3.1 / NexusDesk (se aplicável) */}
            {isAgentCompatible && (
              <div className="p-3.5 rounded-xl border border-brand/20 bg-brand/5 dark:bg-brand/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      Telemetria NexusDesk v3.1
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {formData.agent?.machineId
                        ? `Máquina vinculada: ${formData.agent.machineId}`
                        : 'Pronto para sincronização automática via Agente Nexus 3.1'}
                    </p>
                  </div>
                </div>

                <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-brand/30 text-brand shrink-0">
                  RMM TLS v3.1
                </span>
              </div>
            )}

            {/* Campos de especificações dinâmicos baseados no catálogo */}
            {activeSpecs.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeSpecs.map((field) => {
                  const def = SPEC_FIELDS[field];
                  const name = isRootSpec(field) ? field : `specs.${field}`;
                  const value = isRootSpec(field)
                    ? formData[field] || ''
                    : formData.specs?.[field] || '';
                  return (
                    <div key={field}>
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 block">
                        {def.label}
                      </label>
                      <input
                        type={def.type || 'text'}
                        name={name}
                        value={value}
                        onChange={handleChange}
                        placeholder={def.placeholder}
                        className={`w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:bg-white dark:focus:bg-slate-900 focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none transition-all ${
                          def.mono ? 'font-mono' : ''
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400 dark:text-slate-500 italic text-center py-4 bg-slate-50/50 dark:bg-slate-900/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                Sem especificações adicionais obrigatórias para {formData.type}.
              </p>
            )}
          </div>

          {/* BLOCO 3: CAMPOS CUSTOMIZADOS & NOTAS */}
          <div className="bg-white dark:bg-[#0D121F] p-5 sm:p-6 rounded-2xl border border-slate-200/90 dark:border-slate-800/80 shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800/80">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <FileText size={15} className="text-brand" /> Observações & Campos Extras
              </h3>
            </div>

            {/* Campos configurados pela empresa */}
            {customFieldsDef.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-2">
                {customFieldsDef.map((cf) => (
                  <div key={cf.id}>
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 block">
                      {cf.label}
                    </label>
                    {cf.type === 'textarea' ? (
                      <textarea
                        value={formData.customData[cf.id] || ''}
                        onChange={(e) => handleCustomDataChange(cf.id, e.target.value)}
                        className="w-full p-3 bg-slate-50 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-xl text-sm text-slate-900 dark:text-white focus:border-brand outline-none resize-none h-20"
                      />
                    ) : (
                      <input
                        type={cf.type === 'number' ? 'number' : cf.type === 'date' ? 'date' : 'text'}
                        value={formData.customData[cf.id] || ''}
                        onChange={(e) => handleCustomDataChange(cf.id, e.target.value)}
                        className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-xl text-sm text-slate-900 dark:text-white focus:border-brand outline-none"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 block">
                Histórico & Observações Livres
              </label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                rows={3}
                placeholder="Detalhes adicionais, avarias conhecidas, acessórios inclusos..."
                className="w-full p-3 bg-slate-50 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:bg-white dark:focus:bg-slate-900 focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none resize-none transition-all"
              />
            </div>
          </div>
        </div>

        {/* ================================================================= */}
        {/* COLUNA DIREITA (1/3): CUSTÓDIA, STATUS E DADOS FINANCEIROS         */}
        {/* ================================================================= */}
        <div className="space-y-6">
          {/* BLOCO 4: STATUS OPERACIONAL & CLASSIFICAÇÃO */}
          <div className="bg-white dark:bg-[#0D121F] p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800/80 shadow-2xs space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800/80">
              <ShieldCheck size={15} className="text-brand" /> Status & Categoria
            </h3>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 block">
                Status Atual do Ativo
              </label>

              {transit ? (
                <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-3">
                  <StatusBadge status={formData.status} />
                  <p className="mt-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300 font-medium">
                    Em trânsito de {transit.from} para {transit.to} ({transit.number}).
                  </p>
                </div>
              ) : baixado ? (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3">
                  <div className="flex items-center gap-2">
                    <Archive size={15} className="text-slate-400" />
                    <StatusBadge status={formData.status} />
                  </div>
                  {formData.writeOffReason && (
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                      {formData.writeOffReason}
                      {formData.writeOffDate && ` · ${formData.writeOffDate}`}
                    </p>
                  )}
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    Reativação permitida apenas pela tela de detalhe do ativo.
                  </p>
                </div>
              ) : (
                <div className="relative">
                  <select
                    name="status"
                    value={formData.status}
                    onChange={handleChange}
                    className="w-full p-2.5 pl-3 pr-8 bg-slate-50 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-xl appearance-none font-bold text-sm text-slate-900 dark:text-white outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 cursor-pointer"
                  >
                    {statusOptions.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                  <div className={`absolute right-3.5 top-4 w-2 h-2 rounded-full ${statusDotClass(formData.status)}`} />
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 block">
                Classificação Contábil
              </label>
              <select
                name="category"
                value={formData.category}
                onChange={handleChange}
                className="w-full p-2.5 bg-slate-50 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none focus:border-brand cursor-pointer"
              >
                <option value="Corporativo">Corporativo (Patrimônio)</option>
                <option value="Promocional">Promocional (Comodato)</option>
                <option value="Infra">Infraestrutura</option>
              </select>
            </div>
          </div>

          {/* BLOCO 5: CUSTÓDIA, EQUIPE & LOCALIZAÇÃO */}
          <div className="bg-white dark:bg-[#0D121F] p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800/80 shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800/80">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <User size={15} className="text-brand" /> Custódia & Local
              </h3>
              <Link to="/employees" className="text-[11px] font-semibold text-brand hover:underline">
                + Equipe
              </Link>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 block">
                {isPromotional ? 'Beneficiário / Cliente' : 'Responsável (Colaborador)'}
              </label>
              <div className="relative">
                <select
                  name="assignedTo"
                  value={formData.assignedTo}
                  onChange={handleEmployeeSelect}
                  className="w-full p-2.5 pl-3 pr-8 bg-slate-50 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-xl appearance-none font-semibold text-sm outline-none focus:border-brand cursor-pointer text-slate-900 dark:text-slate-100"
                >
                  <option value="">Selecione um colaborador…</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.name}>
                      {emp.name} {emp.sector ? `(${emp.sector})` : ''}
                    </option>
                  ))}
                </select>
                <Search size={15} className="absolute right-3.5 top-3.5 text-slate-400 pointer-events-none" />
              </div>

              {/* Digitação avulsa fora do cadastro com aviso visual */}
              {formData.assignedTo && !employees.some((e) => e.name === formData.assignedTo) && (
                <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-900/50 rounded-lg text-xs text-amber-800 dark:text-amber-400 font-medium">
                  Responsável avulso: <span className="font-bold">{formData.assignedTo}</span>
                </div>
              )}
              <input
                value={formData.assignedTo}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    assignedTo: e.target.value,
                    employeeId: '',
                  }))
                }
                placeholder="Ou digite um nome fora do cadastro..."
                className="w-full mt-2 p-1.5 text-xs border-b border-slate-200 dark:border-slate-700 focus:border-brand outline-none bg-transparent text-slate-700 dark:text-slate-300"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 block">
                {isPromotional ? 'Campanha / Evento' : 'Setor / Departamento'}
              </label>
              <div className="relative">
                <Building2 size={15} className="absolute left-3 top-3 text-slate-400" />
                <input
                  name="sector"
                  value={formData.sector}
                  onChange={handleChange}
                  placeholder="Ex: TI / Operações"
                  className="w-full pl-9 p-2 bg-slate-50 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-xl text-sm text-slate-900 dark:text-white focus:border-brand outline-none"
                />
              </div>
            </div>

            {isPromotional && (
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 block">
                  Vendedor Responsável
                </label>
                <input
                  name="vendedor"
                  value={formData.vendedor}
                  onChange={handleChange}
                  placeholder="Nome do consultor/vendedor"
                  className="w-full p-2 bg-slate-50 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-xl text-sm text-slate-900 dark:text-white focus:border-brand outline-none"
                />
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 block">
                Localização Física / Filial
              </label>
              <div className="relative">
                <MapPin size={15} className="absolute left-3 top-3 text-slate-400" />
                <LocationSelect
                  value={formData.location}
                  onChange={handleChange}
                  disabled={Boolean(transit)}
                  showManageLink
                  className="w-full pl-9 p-2 bg-slate-50 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:border-brand outline-none cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* BLOCO 6: AQUISIÇÃO, GARANTIA & NOTA FISCAL */}
          <div className="bg-white dark:bg-[#0D121F] p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800/80 shadow-2xs space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800/80">
              <DollarSign size={15} className="text-brand" /> Aquisição & Garantia
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1 block">
                  Valor (R$)
                </label>
                <input
                  name="valor"
                  value={formData.valor}
                  onChange={handleChange}
                  inputMode="decimal"
                  placeholder="0,00"
                  className="w-full p-2 bg-slate-50 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white focus:border-brand outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1 block">
                  Data da Compra
                </label>
                <input
                  type="date"
                  name="purchaseDate"
                  value={formData.purchaseDate}
                  onChange={handleChange}
                  className="w-full p-2 bg-slate-50 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white focus:border-brand outline-none"
                />
              </div>

              {/* Fim da Garantia com botões rápidos */}
              <div className="col-span-2 pt-1 border-t border-slate-100 dark:border-slate-800/60">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                    Fim da Garantia
                  </label>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 5].map((yrs) => (
                      <button
                        type="button"
                        key={yrs}
                        onClick={() => handleAddWarrantyYears(yrs)}
                        className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 hover:bg-brand/10 dark:bg-slate-800 dark:hover:bg-brand/20 text-slate-600 dark:text-slate-300 hover:text-brand transition-colors cursor-pointer"
                        title={`Calcular garantia para +${yrs} ano(s)`}
                      >
                        +{yrs}A
                      </button>
                    ))}
                  </div>
                </div>

                <input
                  type="date"
                  name="warrantyEnd"
                  value={formData.warrantyEnd}
                  onChange={handleChange}
                  className="w-full p-2 bg-slate-50 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white focus:border-brand outline-none"
                />

                {garantia && (
                  <div className="mt-1.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                        WARRANTY_BADGE[garantia.state]
                      }`}
                    >
                      <ShieldCheck size={11} />
                      {WARRANTY_LABEL[garantia.state]}
                      {garantia.state !== 'expirada' && ` · ${garantia.days}d`}
                    </span>
                  </div>
                )}
              </div>

              <div className="col-span-2">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1 block">
                  Fornecedor
                </label>
                <input
                  name="supplier"
                  value={formData.supplier}
                  onChange={handleChange}
                  placeholder="Ex: Dell do Brasil Ltda"
                  className="w-full p-2 bg-slate-50 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-xl text-sm text-slate-900 dark:text-white focus:border-brand outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1 block">
                  Nota Fiscal
                </label>
                <input
                  name="invoiceNumber"
                  value={formData.invoiceNumber}
                  onChange={handleChange}
                  placeholder="Nº da NF"
                  className="w-full p-2 bg-slate-50 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-xl text-sm font-mono text-slate-900 dark:text-white focus:border-brand outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1 block">
                  Centro de Custo
                </label>
                <input
                  name="costCenter"
                  value={formData.costCenter}
                  onChange={handleChange}
                  placeholder="Ex: TI-001"
                  className="w-full p-2 bg-slate-50 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-xl text-sm text-slate-900 dark:text-white focus:border-brand outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ================================================================= */}
        {/* BARRA DE AÇÕES FIXA (STICKY ACTION BAR)                           */}
        {/* ================================================================= */}
        <div className="lg:col-span-3 sticky bottom-4 z-30">
          <div className="bg-white/95 dark:bg-[#0D121F]/95 backdrop-blur-md p-3 sm:p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800/80 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                {formData.internalId || 'SEM TAG'}
              </span>
              <span>•</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {formData.model || 'Sem modelo informado'}
              </span>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => navigate('/assets')}
                className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl border border-slate-200/90 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancelar
              </button>

              {!id && (
                <button
                  type="button"
                  onClick={() => saveAssetInternal(true)}
                  disabled={loading || tagExists}
                  className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl border border-brand/30 bg-brand/10 dark:bg-brand/20 text-xs font-semibold text-brand dark:text-brand-light hover:bg-brand/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                  title="Salva o ativo atual e mantém fornecedor/local para cadastrar outro"
                >
                  <Plus size={14} />
                  <span>Salvar & Novo</span>
                </button>
              )}

              <button
                type="submit"
                disabled={loading || tagExists}
                className="flex-1 sm:flex-initial px-5 py-2.5 bg-brand hover:bg-brand-dark text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {loading ? (
                  <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                ) : (
                  <>
                    <Save size={15} />
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
