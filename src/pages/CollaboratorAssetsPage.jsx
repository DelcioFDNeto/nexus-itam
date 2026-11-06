// src/pages/CollaboratorAssetsPage.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getEmployees } from '../services/employeeService';
import { getAssets } from '../services/assetService';
import { isRetired } from '../utils/assetStatus';
import { can } from '../utils/permissions';
import { 
  Laptop, Smartphone, Monitor, HardDrive, ShieldCheck, 
  CheckCircle2, AlertCircle, Copy, Check, ExternalLink, 
  Search, RefreshCcw, User, MapPin, DollarSign, Calendar, 
  Cpu, Wrench, FileSignature, ArrowUpRight, Sparkles, X,
  Briefcase, Boxes, Info, FileText
} from 'lucide-react';
import { toast } from 'sonner';
import { parseBRL, formatBRL } from '../utils/currency';
import { isMatchingHolder } from '../utils/employeeMatching';

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
  const isManager = can(currentUser, 'employees:write');

  const [employees, setEmployees] = useState([]);
  const [selectedEmployeeName, setSelectedEmployeeName] = useState('');
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Todos');
  const [copiedId, setCopiedId] = useState(null);

  // Modal de Ficha Técnica
  const [selectedAssetForModal, setSelectedAssetForModal] = useState(null);

  // Vistorias confirmadas nesta sessão (id -> timestamp)
  const [inspectedMap, setInspectedMap] = useState({});

  // 1. Carrega colaboradores do tenant e determina o colaborador ativo
  const loadData = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [empList, allAssets] = await Promise.all([
        getEmployees(tenantId),
        getAssets(tenantId)
      ]);
      setEmployees(empList || []);

      // Determinar colaborador alvo
      const paramEmp = searchParams.get('employee');
      let targetName = '';

      if (paramEmp) {
        targetName = paramEmp;
      } else {
        // Tenta achar pelo nome ou email do usuário logado
        const userEmail = (currentUser?.email || '').toLowerCase();
        const userName = (currentUser?.displayName || currentUser?.name || '').toLowerCase();
        const found = (empList || []).find(e => 
          (e.email && e.email.toLowerCase() === userEmail) ||
          (e.name && e.name.toLowerCase() === userName) ||
          (e.login && userEmail.includes(e.login.toLowerCase()))
        );
        targetName = found ? found.name : (empList[0]?.name || currentUser?.displayName || 'Colaborador');
      }

      setSelectedEmployeeName(targetName);

      // Filtra os ativos atribuídos a este colaborador com suporte a nomes compostos
      const activeAssets = (allAssets || []).filter(a => 
        isMatchingHolder(targetName, a.assignedTo) &&
        !isRetired(a.status) && !a.transit
      );
      setAssets(activeAssets);
    } catch (err) {
      console.error('Erro ao carregar dados do colaborador:', err);
      toast.error('Não foi possível carregar os ativos sob custódia.');
    } finally {
      setLoading(false);
    }
  }, [tenantId, searchParams, currentUser]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Atualizar quando o gestor troca o colaborador no dropdown
  const handleSelectEmployee = async (empName) => {
    setSelectedEmployeeName(empName);
    setSearchParams(empName ? { employee: empName } : {});
    setLoading(true);
    try {
      const allAssets = await getAssets(tenantId);
      const activeAssets = (allAssets || []).filter(a => 
        isMatchingHolder(empName, a.assignedTo) &&
        !isRetired(a.status) && !a.transit
      );
      setAssets(activeAssets);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text, id) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success(`Copiado: ${text}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleConfirmInspection = (assetId, assetTag) => {
    const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    setInspectedMap(prev => ({ ...prev, [assetId]: time }));
    toast.success(`Vistoria do ativo ${assetTag} confirmada com sucesso!`);
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
      
      {/* Barra de Modo Gestor: Seletor de Colaborador */}
      {isManager && (
        <div className="p-4 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-brand text-white shadow-sm">
              <Briefcase size={18} />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-brand block">
                Painel do Gestor ITAM
              </span>
              <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Inspecionando os ativos sob responsabilidade de:
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={selectedEmployeeName}
              onChange={(e) => handleSelectEmployee(e.target.value)}
              className="w-full sm:w-72 p-2.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white outline-none focus:border-brand cursor-pointer shadow-sm"
            >
              {employees.map(emp => (
                <option key={emp.id} value={emp.name}>
                  {emp.name} ({emp.role || 'Colaborador'} - {emp.sector || 'Geral'})
                </option>
              ))}
            </select>

            <button
              onClick={() => {
                const myName = currentUser?.displayName || currentUser?.name || employees[0]?.name || '';
                handleSelectEmployee(myName);
              }}
              className="px-3 py-2.5 rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:text-brand border border-indigo-200 dark:border-indigo-800 text-xs font-bold transition-all shrink-0"
              title="Voltar para meu próprio perfil"
            >
              Meu Perfil
            </button>
          </div>
        </div>
      )}

      {/* Hero Header do Colaborador */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 md:p-8 border border-slate-200/80 dark:border-slate-700 shadow-sm flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative overflow-hidden">
        <div className="flex items-center gap-4 z-10">
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-3xl bg-gradient-to-br from-brand via-purple-600 to-indigo-600 text-white flex items-center justify-center font-black text-2xl md:text-3xl shadow-lg uppercase shrink-0">
            {(currentEmpData.name || '?').substring(0, 2)}
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-brand/10 text-brand text-[10px] font-black uppercase tracking-wider mb-1.5">
              <Sparkles size={12} /> Meus Ativos & Termos de Custódia
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
              {currentEmpData.name}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-3">
              <span className="font-bold text-slate-700 dark:text-slate-200">{currentEmpData.role || 'Colaborador'}</span>
              <span>•</span>
              <span>{currentEmpData.sector || 'Geral'}</span>
              <span>•</span>
              <span className="flex items-center gap-1"><MapPin size={12} /> {currentEmpData.branch || 'Matriz'}</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 z-10 w-full lg:w-auto">
          <button 
            onClick={() => navigate('/termos')}
            className="flex-1 lg:flex-initial px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 font-bold text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center justify-center gap-2 transition-all shadow-sm"
          >
            <FileSignature size={16} className="text-brand" /> Meus Termos Assinados
          </button>

          <button 
            onClick={() => navigate('/service-desk')}
            className="flex-1 lg:flex-initial px-5 py-2.5 rounded-2xl bg-brand text-white font-bold text-xs hover:opacity-90 flex items-center justify-center gap-2 transition-all shadow-lg shadow-brand/20 active:scale-95"
          >
            <Wrench size={16} /> Solicitar Suporte Técnico
          </button>
        </div>
      </div>

      {/* KPI Cards Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="p-3.5 rounded-2xl bg-brand/10 text-brand">
            <Boxes size={24} />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Total de Ativos</span>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-0.5">{stats.total}</p>
            <span className="text-[10px] text-slate-400">Em sua posse direta</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="p-3.5 rounded-2xl bg-emerald-500/10 text-emerald-600">
            <DollarSign size={24} />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Patrimônio Declarado</span>
            <p className="text-xl md:text-2xl font-black text-slate-900 dark:text-white mt-0.5 truncate" title={formatBRL(stats.totalVal)}>
              {formatBRL(stats.totalVal)}
            </p>
            <span className="text-[10px] text-slate-400">Custo de reposição</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="p-3.5 rounded-2xl bg-indigo-500/10 text-indigo-600">
            <Laptop size={24} />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Categorias</span>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-0.5">{stats.categories}</p>
            <span className="text-[10px] text-slate-400">Notebook, celular, telas</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="p-3.5 rounded-2xl bg-blue-500/10 text-blue-600">
            <ShieldCheck size={24} />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Conformidade CLT</span>
            <p className="text-sm font-black text-slate-800 dark:text-slate-200 mt-1">
              Art. 462 § 1º
            </p>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">
              {stats.inspectedCount > 0 ? `${stats.inspectedCount} vistoria(s) hoje` : 'Termo vigente'}
            </span>
          </div>
        </div>
      </div>

      {/* Barra de Filtros e Busca */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Buscar por patrimônio (tag), marca, modelo, número de série..."
            className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 text-sm outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
          />
          {searchTerm && (
            <button 
              onClick={() => setSearchTerm('')} 
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X size={16}/>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 dark:bg-slate-900 p-1 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300">
          {['Todos', 'Notebooks', 'Smartphones', 'Desktops', 'Monitores'].map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                categoryFilter === cat 
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' 
                  : 'hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid de Ativos em Custódia */}
      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 text-slate-400">
          <RefreshCcw size={32} className="animate-spin text-brand mb-3" />
          <p className="text-sm font-bold">Localizando seus ativos corporativos...</p>
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
                className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-700 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all flex flex-col justify-between group relative"
              >
                <div>
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-3.5 rounded-2xl bg-brand/10 text-brand shadow-sm">
                        <IconComp size={24} />
                      </div>
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                          {asset.type || 'Equipamento'}
                        </span>
                        <h3 className="font-bold text-slate-900 dark:text-white text-base leading-snug group-hover:text-brand transition-colors">
                          {asset.model || asset.brand || 'Equipamento TI'}
                        </h3>
                      </div>
                    </div>

                    <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-900/60 shrink-0">
                      {asset.status || 'Em Uso'}
                    </span>
                  </div>

                  {/* Informações de Patrimônio & Serial */}
                  <div className="space-y-2 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 font-medium">Patrimônio / Tag:</span>
                      <button
                        onClick={() => copyToClipboard(tag, `tag-${asset.id}`)}
                        className="font-mono font-bold text-slate-800 dark:text-slate-200 hover:text-brand flex items-center gap-1.5 transition-colors"
                        title="Copiar código patrimonial"
                      >
                        <span>{tag}</span>
                        {copiedId === `tag-${asset.id}` ? <Check size={12} className="text-emerald-500" /> : <Copy size={11} className="text-slate-400" />}
                      </button>
                    </div>

                    {serial !== 'S/N' && (
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 font-medium">Número de Série:</span>
                        <button
                          onClick={() => copyToClipboard(serial, `sn-${asset.id}`)}
                          className="font-mono text-slate-600 dark:text-slate-400 hover:text-brand flex items-center gap-1.5 transition-colors"
                          title="Copiar serial do hardware"
                        >
                          <span>{serial}</span>
                          {copiedId === `sn-${asset.id}` ? <Check size={12} className="text-emerald-500" /> : <Copy size={10} className="text-slate-400" />}
                        </button>
                      </div>
                    )}

                    {assetVal && (
                      <div className="flex justify-between items-center pt-1 border-t border-slate-200/60 dark:border-slate-800">
                        <span className="text-slate-400 font-medium">Valor Estimado:</span>
                        <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                          {formatBRL(assetVal)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-5 space-y-3 pt-4 border-t border-slate-100 dark:border-slate-700/80">
                  {/* Status de Vistoria do Ativo */}
                  {isInspected ? (
                    <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-900/60">
                      <CheckCircle2 size={15} />
                      <span>Posse verificada hoje às {isInspected}</span>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleConfirmInspection(asset.id, tag)}
                      className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-slate-300 dark:border-slate-600 font-bold text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      <CheckCircle2 size={15} className="text-brand" />
                      <span>Confirmar Posse / Vistoria</span>
                    </button>
                  )}

                  {/* Ações Secundárias: Ficha Técnica e Suporte */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setSelectedAssetForModal(asset)}
                      className="py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-700/60 font-bold text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Info size={13} />
                      <span>Ficha Técnica</span>
                    </button>

                    <button
                      onClick={() => navigate('/service-desk')}
                      className="py-2 px-3 rounded-xl bg-brand/10 font-bold text-xs text-brand hover:bg-brand/20 transition-colors flex items-center justify-center gap-1.5"
                      title="Abrir chamado para este ativo"
                    >
                      <Wrench size={13} />
                      <span>Pedir Suporte</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {filteredAssets.length === 0 && (
            <div className="col-span-full py-16 px-4 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-3xl bg-white/50 dark:bg-slate-800/50">
              <Boxes size={48} className="mx-auto mb-3 opacity-30 text-brand" />
              <p className="font-bold text-slate-700 dark:text-slate-300 text-base">
                Nenhum ativo localizado sob sua custódia
              </p>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                {searchTerm || categoryFilter !== 'Todos'
                  ? 'Nenhum equipamento corresponde aos filtros aplicados.'
                  : 'Se você possui um equipamento corporativo que não consta nesta lista, solicite o vínculo à equipe de TI.'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Modal de Ficha Técnica Completa */}
      {selectedAssetForModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-lg p-6 md:p-8 animate-in zoom-in-95 border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-6 pb-4 border-b border-slate-100 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-brand/10 text-brand">
                  <Laptop size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white leading-tight">
                    {selectedAssetForModal.model || selectedAssetForModal.brand}
                  </h3>
                  <span className="text-xs font-mono font-bold text-slate-400">
                    Tag: {selectedAssetForModal.internalId || selectedAssetForModal.id}
                  </span>
                </div>
              </div>

              <button 
                onClick={() => setSelectedAssetForModal(null)}
                className="p-1 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-900">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Categoria</span>
                  <p className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">{selectedAssetForModal.type || 'Notebook'}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Marca</span>
                  <p className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">{selectedAssetForModal.brand || 'Corporativo'}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Número de Série</span>
                  <p className="font-mono text-slate-800 dark:text-slate-200 mt-0.5">{selectedAssetForModal.serialNumber || 'S/N'}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Valor Declarado</span>
                  <p className="font-mono font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                    {formatBRL(selectedAssetForModal.valor ?? selectedAssetForModal.purchase_value)}
                  </p>
                </div>
              </div>

              {selectedAssetForModal.specs && Object.keys(selectedAssetForModal.specs).length > 0 && (
                <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
                  <h4 className="font-black text-slate-700 dark:text-slate-300 text-xs uppercase flex items-center gap-1.5">
                    <Cpu size={14} className="text-brand" /> Especificações de Hardware
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-400 pt-1">
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
              <div className="p-4 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/40 text-[11px] text-amber-900 dark:text-amber-200 space-y-1.5 leading-relaxed">
                <p className="font-bold flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-amber-600" /> Cláusula de Custódia & Responsabilidade (CLT)
                </p>
                <p>
                  O colaborador assume a guarda e o uso estritamente profissional deste equipamento, respondendo por dolo ou culpa conforme o Art. 462, § 1º da CLT e os termos do Acordo Coletivo de Trabalho.
                </p>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  onClick={() => setSelectedAssetForModal(null)}
                  className="w-full py-3 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-xs hover:opacity-90 transition-all shadow-md"
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
