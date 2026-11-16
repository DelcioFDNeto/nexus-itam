// src/pages/CollaboratorAssetsPage.jsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getEmployees } from '../services/employeeService';
import { getAssets } from '../services/assetService';
import { isRetired } from '../utils/assetStatus';
import { can } from '../utils/permissions';
import {
  Laptop, Smartphone, Monitor, HardDrive, ShieldCheck,
  CheckCircle2, AlertCircle, Copy, Check,
  Search, RefreshCcw, MapPin, DollarSign,
  Cpu, Wrench, FileSignature, Sparkles, X,
  Briefcase, Boxes, Info
} from 'lucide-react';
import { toast } from 'sonner';
import { parseBRL, formatBRL } from '../utils/currency';
import { isMatchingHolder } from '../utils/employeeMatching';
import {
  captureFocusTarget,
  getFocusableElements,
  restoreFocusSafely,
  trapFocusWithin,
} from '../utils/focusTrap';
import { isTopmostModal } from '../utils/modalStack';

const getCategoryIcon = (type) => {
  const t = (type || '').toLowerCase();
  if (t.includes('note') || t.includes('laptop')) return Laptop;
  if (t.includes('cel') || t.includes('phone') || t.includes('smart')) return Smartphone;
  if (t.includes('monit') || t.includes('tela')) return Monitor;
  return HardDrive;
};

const CollaboratorAssetsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId;
  const userEmail = (currentUser?.email || '').toLowerCase();
  const userName = (currentUser?.displayName || currentUser?.name || '').toLowerCase();
  const userDisplayName = currentUser?.displayName || currentUser?.name || '';
  const isManager = can(currentUser, 'employees:write');

  const [employees, setEmployees] = useState([]);
  const [selectedEmployeeName, setSelectedEmployeeName] = useState('');
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [statusAnnouncement, setStatusAnnouncement] = useState('');

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Todos');
  const [copiedId, setCopiedId] = useState(null);

  // Modal de Ficha Técnica
  const [selectedAssetForModal, setSelectedAssetForModal] = useState(null);
  const assetModalRef = useRef(null);
  const assetModalReturnFocusRef = useRef(null);
  const requestSeqRef = useRef(0);
  const isMountedRef = useRef(true);
  const copyTimeoutRef = useRef(null);

  // Vistorias confirmadas nesta sessão (id -> timestamp)
  const [inspectedMap, setInspectedMap] = useState({});

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = null;
      }
    };
  }, []);

  const isAssetModalOpen = Boolean(selectedAssetForModal);

  useEffect(() => {
    const dialogEl = assetModalRef.current;
    if (!isAssetModalOpen || !dialogEl) return undefined;

    assetModalReturnFocusRef.current = captureFocusTarget(dialogEl);
    const focusables = getFocusableElements(dialogEl);
    (focusables[0] || dialogEl).focus();

    const handleKeyDown = (e) => {
      if (!isTopmostModal(dialogEl)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedAssetForModal(null);
        return;
      }
      if (e.key === 'Tab') {
        trapFocusWithin(e, dialogEl);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const previous = assetModalReturnFocusRef.current;
      assetModalReturnFocusRef.current = null;
      restoreFocusSafely(previous, null, dialogEl);
    };
  }, [isAssetModalOpen]);

  // 1. Carrega colaboradores do tenant e determina o colaborador ativo
  const loadData = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    const reqSeq = ++requestSeqRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const [empList, allAssets] = await Promise.all([
        getEmployees(tenantId),
        getAssets(tenantId)
      ]);
      if (!isMountedRef.current || reqSeq !== requestSeqRef.current) return;
      setEmployees(empList || []);

      // Determinar colaborador alvo
      const paramEmp = searchParams.get('employee');
      let targetName = '';

      if (paramEmp) {
        targetName = paramEmp;
      } else {
        // Tenta achar pelo nome ou email do usuário logado
        const found = (empList || []).find(e =>
          (e.email && e.email.toLowerCase() === userEmail) ||
          (e.name && e.name.toLowerCase() === userName) ||
          (e.login && userEmail.includes(e.login.toLowerCase()))
        );
        targetName = found ? found.name : (empList[0]?.name || userDisplayName || 'Colaborador');
      }

      setSelectedEmployeeName(targetName);

      // Filtra os ativos atribuídos a este colaborador com suporte a nomes compostos
      const activeAssets = (allAssets || []).filter(a =>
        isMatchingHolder(targetName, a.assignedTo) &&
        !isRetired(a.status) && !a.transit
      );
      setAssets(activeAssets);
    } catch (err) {
      if (!isMountedRef.current || reqSeq !== requestSeqRef.current) return;
      console.error('Erro ao carregar dados do colaborador:', err);
      const message = err?.message || 'Não foi possível carregar os ativos sob custódia.';
      setLoadError(message);
      toast.error('Não foi possível carregar os ativos sob custódia.');
    } finally {
      if (isMountedRef.current && reqSeq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [tenantId, searchParams, userEmail, userName, userDisplayName]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Atualizar URL quando o gestor troca o colaborador; loadData reage a searchParams sem duplicar requisição
  const handleSelectEmployee = (empName) => {
    setSelectedEmployeeName(empName);
    setSearchParams(empName ? { employee: empName } : {});
    setStatusAnnouncement(`Exibindo ativos sob responsabilidade de ${empName}.`);
  };

  const copyToClipboard = async (text, id) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (!isMountedRef.current) return;
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      setCopiedId(id);
      toast.success(`Copiado: ${text}`);
      setStatusAnnouncement(`Copiado para a área de transferência: ${text}`);
      copyTimeoutRef.current = setTimeout(() => {
        copyTimeoutRef.current = null;
        if (isMountedRef.current) setCopiedId(null);
      }, 2000);
    } catch {
      if (!isMountedRef.current) return;
      toast.error('Não foi possível copiar para a área de transferência.');
      setStatusAnnouncement('Não foi possível copiar para a área de transferência.');
    }
  };

  const handleConfirmInspection = (assetId, assetTag) => {
    const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    setInspectedMap(prev => ({ ...prev, [assetId]: time }));
    const msg = `Vistoria do ativo ${assetTag} confirmada com sucesso!`;
    toast.success(msg);
    setStatusAnnouncement(msg);
  };

  // Metadados do colaborador ativo
  const currentEmpData = useMemo(() => {
    return employees.find(e => isMatchingHolder(selectedEmployeeName, e.name)) || {
      name: selectedEmployeeName,
      role: 'Colaborador',
      sector: 'Geral',
      branch: 'Matriz'
    };
  }, [employees, selectedEmployeeName]);

  // Cálculos executivos
  const stats = useMemo(() => {
    const total = assets.length;
    const totalVal = assets.reduce((sum, a) => {
      return sum + parseBRL(a.valor ?? a.purchase_value ?? a.purchaseValue ?? 0);
    }, 0);

    const categories = new Set(assets.map(a => a.type || 'Geral')).size;
    const inspectedCount = Object.keys(inspectedMap).length;

    return { total, totalVal, categories, inspectedCount };
  }, [assets, inspectedMap]);

  // Filtragem reativa
  const filteredAssets = useMemo(() => {
    return assets.filter(asset => {
      const q = searchTerm.toLowerCase().trim();
      const tag = (asset.internalId || asset.internal_id || asset.id || '').toLowerCase();
      const model = (asset.model || '').toLowerCase();
      const brand = (asset.brand || '').toLowerCase();
      const serial = (asset.serialNumber || asset.serial_number || '').toLowerCase();
      const loc = (asset.location || '').toLowerCase();

      const matchSearch = !q || tag.includes(q) || model.includes(q) || brand.includes(q) || serial.includes(q) || loc.includes(q);

      const type = (asset.type || '').toLowerCase();
      let matchCat = true;
      if (categoryFilter === 'Notebooks') matchCat = type.includes('note') || type.includes('laptop');
      else if (categoryFilter === 'Smartphones') matchCat = type.includes('cel') || type.includes('phone') || type.includes('smart');
      else if (categoryFilter === 'Desktops') matchCat = type.includes('desk') || type.includes('comp') || type.includes('pc');
      else if (categoryFilter === 'Monitores') matchCat = type.includes('monit') || type.includes('tela');
      else if (categoryFilter === 'Periféricos') matchCat = type.includes('peri') || type.includes('tecl') || type.includes('mous');

      return matchSearch && matchCat;
    });
  }, [assets, searchTerm, categoryFilter]);

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto pb-24 space-y-8 min-h-screen animate-fade-in">
      <div role="status" aria-live="polite" className="sr-only">
        {statusAnnouncement}
      </div>

      {/* Barra de Modo Gestor: Seletor de Colaborador */}
      {isManager && (
        <div className="p-4 rounded-2xl bg-brand/5 dark:bg-[#111113] border border-brand/20 dark:border-zinc-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-brand text-brand-fg shadow-sm">
              <Briefcase size={18} />
            </div>
            <div>
              <span className="text-xs font-black uppercase tracking-wider text-brand-aa block">
                Painel do Gestor ITAM
              </span>
              <p className="text-xs font-bold text-slate-800 dark:text-zinc-200">
                Inspecionando os ativos sob responsabilidade de:
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label htmlFor="manager-employee-select" className="sr-only">
              Selecionar colaborador para inspecionar ativos
            </label>
            <select
              id="manager-employee-select"
              name="employee"
              value={selectedEmployeeName}
              onChange={(e) => handleSelectEmployee(e.target.value)}
              className="w-full sm:w-72 min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-[#18181b] text-xs font-bold text-slate-900 dark:text-[#fafafa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand cursor-pointer shadow-sm"
            >
              {employees.map(emp => (
                <option key={emp.id} value={emp.name}>
                  {emp.name} ({emp.role || 'Colaborador'} - {emp.sector || 'Geral'})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => {
                const myName = currentUser?.displayName || currentUser?.name || employees[0]?.name || '';
                handleSelectEmployee(myName);
              }}
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white dark:bg-[#18181b] text-slate-700 dark:text-zinc-200 hover:text-brand-aa border border-slate-300 dark:border-zinc-700 text-xs font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand shrink-0"
              title="Voltar para meu próprio perfil"
            >
              Meu Perfil
            </button>
          </div>
        </div>
      )}

      {/* Hero Header do Colaborador */}
      <header className="bg-white dark:bg-[#111113] rounded-3xl p-6 md:p-8 border border-slate-200/80 dark:border-zinc-800 shadow-sm flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative overflow-hidden">
        <div className="flex items-center gap-4 z-10">
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-3xl bg-brand text-brand-fg flex items-center justify-center font-black text-2xl md:text-3xl shadow-lg uppercase shrink-0">
            {(currentEmpData.name || '?').substring(0, 2)}
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand/10 text-brand-aa text-xs font-black uppercase tracking-wider mb-1.5">
              <Sparkles size={12} /> Meus Ativos & Termos de Custódia
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-[#fafafa] tracking-tight">
              {currentEmpData.name}
            </h1>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 flex flex-wrap items-center gap-3">
              <span className="font-bold text-slate-700 dark:text-zinc-200">{currentEmpData.role || 'Colaborador'}</span>
              <span aria-hidden="true">•</span>
              <span>{currentEmpData.sector || 'Geral'}</span>
              <span aria-hidden="true">•</span>
              <span className="flex items-center gap-1"><MapPin size={12} /> {currentEmpData.branch || 'Matriz'}</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 z-10 w-full lg:w-auto">
          <button
            type="button"
            onClick={() => navigate('/termos')}
            className="flex-1 lg:flex-initial min-h-[44px] px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-zinc-700 font-bold text-xs text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-[#18181b] flex items-center justify-center gap-2 transition-colors shadow-sm active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <FileSignature size={16} className="text-brand-aa" /> Meus Termos Assinados
          </button>

          <button
            type="button"
            onClick={() => navigate('/service-desk')}
            className="flex-1 lg:flex-initial min-h-[44px] px-5 py-2.5 rounded-2xl bg-brand hover:bg-brand-dark text-brand-fg font-bold text-xs flex items-center justify-center gap-2 transition-colors shadow-lg shadow-brand/20 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <Wrench size={16} /> Solicitar Suporte Técnico
          </button>
        </div>
      </header>

      {/* KPI Cards Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#111113] p-5 rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm flex items-center gap-4">
          <div className="p-3.5 rounded-2xl bg-brand/10 text-brand-aa shrink-0">
            <Boxes size={24} />
          </div>
          <div>
            <span className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider block">Total de Ativos</span>
            <p className="text-2xl font-black text-slate-900 dark:text-[#fafafa] mt-0.5 tabular-nums">{stats.total}</p>
            <span className="text-xs text-slate-500 dark:text-zinc-400">Em sua posse direta</span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#111113] p-5 rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm flex items-center gap-4">
          <div className="p-3.5 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
            <DollarSign size={24} />
          </div>
          <div className="min-w-0">
            <span className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider block">Patrimônio Declarado</span>
            <p className="text-xl md:text-2xl font-black text-slate-900 dark:text-[#fafafa] mt-0.5 truncate tabular-nums" title={formatBRL(stats.totalVal)}>
              {formatBRL(stats.totalVal)}
            </p>
            <span className="text-xs text-slate-500 dark:text-zinc-400">Custo de reposição</span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#111113] p-5 rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm flex items-center gap-4">
          <div className="p-3.5 rounded-2xl bg-sky-500/10 text-sky-600 dark:text-sky-400 shrink-0">
            <Laptop size={24} />
          </div>
          <div>
            <span className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider block">Categorias</span>
            <p className="text-2xl font-black text-slate-900 dark:text-[#fafafa] mt-0.5 tabular-nums">{stats.categories}</p>
            <span className="text-xs text-slate-500 dark:text-zinc-400">Notebook, celular, telas</span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#111113] p-5 rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm flex items-center gap-4">
          <div className="p-3.5 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
            <ShieldCheck size={24} />
          </div>
          <div>
            <span className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider block">Conformidade CLT</span>
            <p className="text-sm font-black text-slate-800 dark:text-zinc-200 mt-1">
              Art. 462 § 1º
            </p>
            <span className="text-xs text-emerald-700 dark:text-emerald-400 font-bold tabular-nums">
              {stats.inspectedCount > 0 ? `${stats.inspectedCount} vistoria(s) hoje` : 'Termo vigente'}
            </span>
          </div>
        </div>
      </div>

      {/* Barra de Filtros e Busca */}
      <div className="bg-white dark:bg-[#111113] p-4 rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div className="relative flex-1">
          <label htmlFor="collaborator-assets-search" className="sr-only">
            Buscar por patrimônio, marca, modelo ou número de série
          </label>
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" aria-hidden="true" />
          <input
            id="collaborator-assets-search"
            name="searchAssets"
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Buscar por patrimônio (tag), marca, modelo, número de série…"
            className="w-full min-h-[44px] pl-10 pr-11 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50/50 dark:bg-[#18181b] text-slate-900 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              aria-label="Limpar busca"
              className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-[#fafafa] transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 dark:bg-[#18181b] p-1 rounded-xl text-xs font-bold text-slate-600 dark:text-zinc-300">
          {['Todos', 'Notebooks', 'Smartphones', 'Desktops', 'Monitores'].map(cat => (
            <button
              key={cat}
              type="button"
              aria-pressed={categoryFilter === cat}
              onClick={() => setCategoryFilter(cat)}
              className={`min-h-[44px] px-3.5 py-2 rounded-lg transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                categoryFilter === cat
                  ? 'bg-white dark:bg-[#111113] text-slate-900 dark:text-[#fafafa] shadow-sm'
                  : 'hover:text-slate-900 dark:hover:text-[#fafafa]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid de Ativos em Custódia */}
      {loading ? (
        <div role="status" aria-live="polite" className="flex flex-col items-center justify-center h-64 text-slate-500 dark:text-zinc-400">
          <RefreshCcw size={32} className="animate-spin text-brand-aa mb-3" />
          <p className="text-sm font-bold">Localizando seus ativos corporativos…</p>
        </div>
      ) : loadError ? (
        <div role="alert" className="bg-white dark:bg-[#111113] rounded-3xl p-10 border border-rose-200 dark:border-rose-900/50 text-center space-y-4">
          <AlertCircle size={32} className="mx-auto text-rose-500" />
          <div className="space-y-1">
            <h2 className="text-base font-black text-slate-900 dark:text-[#fafafa]">
              Erro ao carregar ativos sob custódia
            </h2>
            <p className="text-xs text-rose-600 dark:text-rose-400 max-w-md mx-auto">
              {loadError}
            </p>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="inline-flex min-h-[44px] items-center gap-2 px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <RefreshCcw size={15} /> Tentar novamente
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAssets.map(asset => {
            const IconComp = getCategoryIcon(asset.type);
            const tag = asset.internalId || asset.internal_id || asset.id;
            const serial = asset.serialNumber || asset.serial_number || 'S/N';
            const assetVal = asset.valor ?? asset.purchase_value ?? asset.purchaseValue;
            const isInspected = inspectedMap[asset.id];

            return (
              <div
                key={asset.id}
                className="bg-white dark:bg-[#111113] rounded-3xl p-6 border border-slate-200/80 dark:border-zinc-800 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-shadow flex flex-col justify-between group relative"
              >
                <div>
                  <div className="flex justify-between items-start gap-2 mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-3.5 rounded-2xl bg-brand/10 text-brand-aa shadow-sm shrink-0">
                        <IconComp size={24} />
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400 block">
                          {asset.type || 'Equipamento'}
                        </span>
                        <h2 className="font-bold text-slate-900 dark:text-[#fafafa] text-base leading-snug group-hover:text-brand-aa transition-colors truncate">
                          {asset.model || asset.brand || 'Equipamento TI'}
                        </h2>
                      </div>
                    </div>

                    <span className="px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wide bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-900/60 shrink-0">
                      {asset.status || 'Em Uso'}
                    </span>
                  </div>

                  {/* Informações de Patrimônio & Serial */}
                  <div className="space-y-2 p-3.5 rounded-2xl bg-slate-50 dark:bg-[#18181b] border border-slate-100 dark:border-zinc-800 text-xs">
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-slate-500 dark:text-zinc-400 font-medium">Patrimônio / Tag:</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(tag, `tag-${asset.id}`)}
                        aria-label={`Copiar código patrimonial ${tag}`}
                        className="min-h-[44px] min-w-[44px] px-2 -my-2 font-mono font-bold text-slate-800 dark:text-zinc-200 hover:text-brand-aa flex items-center justify-end gap-1.5 transition-colors active:scale-[0.98] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                        title="Copiar código patrimonial"
                      >
                        <span>{tag}</span>
                        {copiedId === `tag-${asset.id}` ? <Check size={13} className="text-emerald-500" /> : <Copy size={12} className="text-slate-400 dark:text-zinc-500" />}
                      </button>
                    </div>

                    {serial !== 'S/N' && (
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-slate-500 dark:text-zinc-400 font-medium">Número de Série:</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(serial, `sn-${asset.id}`)}
                          aria-label={`Copiar número de série ${serial}`}
                          className="min-h-[44px] min-w-[44px] px-2 -my-2 font-mono text-slate-600 dark:text-zinc-300 hover:text-brand-aa flex items-center justify-end gap-1.5 transition-colors active:scale-[0.98] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                          title="Copiar serial do hardware"
                        >
                          <span>{serial}</span>
                          {copiedId === `sn-${asset.id}` ? <Check size={13} className="text-emerald-500" /> : <Copy size={12} className="text-slate-400 dark:text-zinc-500" />}
                        </button>
                      </div>
                    )}

                    {assetVal && (
                      <div className="flex justify-between items-center pt-1.5 border-t border-slate-200/60 dark:border-zinc-800">
                        <span className="text-slate-500 dark:text-zinc-400 font-medium">Valor Estimado:</span>
                        <span className="font-mono font-bold text-slate-700 dark:text-zinc-200 tabular-nums">
                          {formatBRL(assetVal)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-5 space-y-3 pt-4 border-t border-slate-100 dark:border-zinc-800">
                  {/* Status de Vistoria do Ativo */}
                  {isInspected ? (
                    <div className="min-h-[44px] flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 rounded-xl border border-emerald-200 dark:border-emerald-900/60">
                      <CheckCircle2 size={15} />
                      <span className="tabular-nums">Posse verificada hoje às {isInspected}</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleConfirmInspection(asset.id, tag)}
                      className="w-full min-h-[44px] flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border border-slate-300 dark:border-zinc-700 font-bold text-xs text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-[#18181b] transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      <CheckCircle2 size={15} className="text-brand-aa" />
                      <span>Confirmar Posse / Vistoria</span>
                    </button>
                  )}

                  {/* Ações Secundárias: Ficha Técnica e Suporte */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedAssetForModal(asset)}
                      className="min-h-[44px] py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-[#18181b] border border-transparent dark:border-zinc-800 font-bold text-xs text-slate-700 dark:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand flex items-center justify-center gap-1.5"
                    >
                      <Info size={14} />
                      <span>Ficha Técnica</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => navigate('/service-desk')}
                      className="min-h-[44px] py-2.5 px-3 rounded-xl bg-brand/10 font-bold text-xs text-brand-aa hover:bg-brand/20 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand flex items-center justify-center gap-1.5"
                      title="Abrir chamado para este ativo"
                    >
                      <Wrench size={14} />
                      <span>Pedir Suporte</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {filteredAssets.length === 0 && (
            <div className="col-span-full py-16 px-4 text-center border-2 border-dashed border-slate-200 dark:border-zinc-800 rounded-3xl bg-white/50 dark:bg-[#111113]/50 space-y-3">
              <Boxes size={48} className="mx-auto opacity-30 text-brand-aa" />
              <p className="font-bold text-slate-700 dark:text-zinc-200 text-base">
                Nenhum ativo localizado sob sua custódia
              </p>
              <p className="text-xs text-slate-500 dark:text-zinc-400 max-w-md mx-auto">
                {searchTerm || categoryFilter !== 'Todos'
                  ? 'Nenhum equipamento corresponde aos filtros aplicados.'
                  : 'Se você possui um equipamento corporativo que não consta nesta lista, solicite o vínculo à equipe de TI.'}
              </p>
              {(searchTerm || categoryFilter !== 'Todos') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setCategoryFilter('Todos');
                  }}
                  className="inline-flex min-h-[44px] items-center px-4 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-bold text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-[#18181b] transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  Limpar filtros
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modal de Ficha Técnica Completa */}
      {selectedAssetForModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            aria-hidden="true"
            className="fixed inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
            onClick={() => setSelectedAssetForModal(null)}
          />
          <div
            ref={assetModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-modal-title"
            tabIndex={-1}
            className="relative bg-white dark:bg-[#111113] rounded-3xl shadow-2xl w-full max-w-lg p-6 md:p-8 animate-zoom-in border border-slate-200 dark:border-zinc-800 max-h-[90vh] overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <div className="flex justify-between items-start mb-6 pb-4 border-b border-slate-100 dark:border-zinc-800">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-3 rounded-2xl bg-brand/10 text-brand-aa shrink-0">
                  <Laptop size={24} />
                </div>
                <div className="min-w-0">
                  <h2 id="asset-modal-title" className="text-lg font-black text-slate-900 dark:text-[#fafafa] leading-tight truncate">
                    {selectedAssetForModal.model || selectedAssetForModal.brand}
                  </h2>
                  <span className="text-xs font-mono font-bold text-slate-500 dark:text-zinc-400">
                    Tag: {selectedAssetForModal.internalId || selectedAssetForModal.id}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedAssetForModal(null)}
                aria-label="Fechar ficha técnica"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-2 rounded-xl text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-[#fafafa] hover:bg-slate-100 dark:hover:bg-[#18181b] transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-[#18181b] border border-slate-100 dark:border-zinc-800">
                <div>
                  <span className="text-xs text-slate-500 dark:text-zinc-400 font-bold uppercase block">Categoria</span>
                  <p className="font-bold text-slate-800 dark:text-[#fafafa] mt-0.5">{selectedAssetForModal.type || 'Notebook'}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500 dark:text-zinc-400 font-bold uppercase block">Marca</span>
                  <p className="font-bold text-slate-800 dark:text-[#fafafa] mt-0.5">{selectedAssetForModal.brand || 'Corporativo'}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500 dark:text-zinc-400 font-bold uppercase block">Número de Série</span>
                  <p className="font-mono text-slate-800 dark:text-zinc-200 mt-0.5">{selectedAssetForModal.serialNumber || 'S/N'}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500 dark:text-zinc-400 font-bold uppercase block">Valor Declarado</span>
                  <p className="font-mono font-bold text-slate-800 dark:text-zinc-200 mt-0.5 tabular-nums">
                    {formatBRL(selectedAssetForModal.valor ?? selectedAssetForModal.purchase_value)}
                  </p>
                </div>
              </div>

              {selectedAssetForModal.specs && Object.keys(selectedAssetForModal.specs).length > 0 && (
                <div className="p-4 rounded-2xl border border-slate-200 dark:border-zinc-800 space-y-2">
                  <h3 className="font-black text-slate-700 dark:text-zinc-200 text-xs uppercase flex items-center gap-1.5">
                    <Cpu size={14} className="text-brand-aa" /> Especificações de Hardware
                  </h3>
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-zinc-300 pt-1">
                    {selectedAssetForModal.specs.processor && (
                      <p><span className="font-bold">CPU:</span> {selectedAssetForModal.specs.processor}</p>
                    )}
                    {selectedAssetForModal.specs.ram && (
                      <p><span className="font-bold">RAM:</span> {selectedAssetForModal.specs.ram}</p>
                    )}
                    {selectedAssetForModal.specs.storage && (
                      <p><span className="font-bold">Armazenamento:</span> {selectedAssetForModal.specs.storage}</p>
                    )}
                    {selectedAssetForModal.specs.os && (
                      <p><span className="font-bold">Sistema:</span> {selectedAssetForModal.specs.os}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Cláusula Legal CLT */}
              <div className="p-4 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/40 text-xs text-amber-900 dark:text-amber-200 space-y-1.5 leading-relaxed">
                <p className="font-bold flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-amber-600 dark:text-amber-400" /> Cláusula de Custódia & Responsabilidade (CLT)
                </p>
                <p>
                  O colaborador assume a guarda e o uso estritamente profissional deste equipamento, respondendo por dolo ou culpa conforme o Art. 462, § 1º da CLT e os termos do Acordo Coletivo de Trabalho.
                </p>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedAssetForModal(null)}
                  className="w-full min-h-[44px] py-3 rounded-xl bg-slate-900 dark:bg-[#fafafa] text-white dark:text-[#09090b] font-bold text-xs hover:opacity-90 transition-opacity shadow-md active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  Fechar Ficha
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CollaboratorAssetsPage;
