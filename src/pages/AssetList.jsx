// src/pages/AssetList.jsx
import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/firebase';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { updateAsset } from '../services/assetService';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx'; 
import { useReactToPrint } from 'react-to-print'; 
import { QRCodeSVG } from 'qrcode.react'; 
import logoShineray from '../assets/logo-shineray.png'; 
import { 
  Search, Plus, Filter, MoreHorizontal, 
  Smartphone, Monitor, Printer, Network, 
  MapPin, User, FileText, Laptop, Megaphone, CreditCard,
  Download, CheckSquare, Square, 
  Printer as PrinterIcon, RefreshCcw, X, Check, ArrowDownAZ, ArrowUpAZ,
  LayoutGrid, PackageCheck, Wrench, AlertCircle
} from 'lucide-react';

const AssetList = () => {
  // --- ESTADO LOCAL ---
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);

  // Estados de Filtro e Busca
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('Todos');
  
  // Estados de Ordenação
  const [sortOrder, setSortOrder] = useState('asc'); 
  const [sortBy, setSortBy] = useState('internalId');
   
  // Estados de Ação em Massa
  const [selectedIds, setSelectedIds] = useState([]);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false); 
  const [bulkProcessing, setBulkProcessing] = useState(false); 

  // --- 1. Sincronização em Tempo Real ---
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, 'assets'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const assetData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setAssets(assetData);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao sincronizar ativos:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // --- 2. Configuração de Impressão ---
  const bulkPrintRef = useRef();
  const handleBulkPrint = useReactToPrint({
    contentRef: bulkPrintRef,
    documentTitle: 'Etiquetas_Lote_Shineray',
  });

  // --- 3. Lógica de Filtros ---
  const filteredAssets = assets.filter(asset => {
    const officialName = asset.assignedTo || asset.clientName || '';
    const isPromo = asset.category === 'Promocional' || asset.internalId?.includes('PRM');

    const matchesSearch = 
      asset.model?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      asset.internalId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      officialName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      asset.vendedor?.toLowerCase().includes(searchTerm.toLowerCase());

    let matchesType = true;
    if (filterType === 'Todos') matchesType = true; 
    else if (filterType === 'Promocionais') matchesType = isPromo;
    else if (filterType === 'Notebook') {
        const isNotebookType = asset.type === 'Notebook';
        const isNotebookModel = asset.model?.toLowerCase().includes('notebook');
        matchesType = (isNotebookType || isNotebookModel) && !isPromo;
    } 
    else {
        if (filterType === 'Computador') {
            const isNotebookModel = asset.model?.toLowerCase().includes('notebook');
            matchesType = asset.type === 'Computador' && !isNotebookModel && !isPromo;
        } else {
            matchesType = asset.type === filterType && !isPromo;
        }
    }
    
    return matchesSearch && matchesType;
  });

  // --- 4. Ordenação ---
  const sortedAssets = [...filteredAssets].sort((a, b) => {
      const valA = (a[sortBy] || '').toString().toLowerCase();
      const valB = (b[sortBy] || '').toString().toLowerCase();
      if (sortOrder === 'asc') return valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
      else return valB.localeCompare(valA, undefined, { numeric: true, sensitivity: 'base' });
  });

  // --- 5. Ações de Seleção ---
  const toggleSelectAll = () => {
      if (selectedIds.length === sortedAssets.length) setSelectedIds([]);
      else setSelectedIds(sortedAssets.map(a => a.id));
  };

  const toggleSelectOne = (id) => {
      if (selectedIds.includes(id)) setSelectedIds(selectedIds.filter(itemId => itemId !== id));
      else setSelectedIds([...selectedIds, id]);
  };

  const selectedAssetsData = assets.filter(a => selectedIds.includes(a.id));

  // --- 6. Ação em Massa ---
  const handleBulkStatusChange = async (newStatus) => {
      if (!confirm(`Tem certeza que deseja mudar o status de ${selectedIds.length} ativos para "${newStatus}"?`)) return;
      setBulkProcessing(true);
      try {
          const updates = selectedIds.map(id => updateAsset(id, { status: newStatus }));
          await Promise.all(updates);
          alert("Status atualizados com sucesso!");
          setSelectedIds([]); 
          setIsStatusModalOpen(false); 
      } catch (error) { alert("Erro ao atualizar alguns itens."); } finally { setBulkProcessing(false); }
  };

  const handleExportExcel = () => {
    const dataToExport = sortedAssets.map(asset => ({
        'Patrimônio': asset.internalId,
        'Modelo': asset.model,
        'Tipo': asset.type,
        'Categoria': asset.category,
        'Status': asset.status,
        'Responsável': asset.assignedTo || asset.clientName || '---',
        'Localização': asset.location,
        'Serial': asset.serialNumber || '',
    }));
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ativos");
    XLSX.writeFile(workbook, `Inventario_Shineray.xlsx`);
  };

  // --- HELPERS VISUAIS ---
  const getTypeIcon = (asset) => {
    if (asset.category === 'Promocional' || asset.internalId?.includes('PRM')) return <Megaphone size={20} className="text-pink-500" />;
    if (asset.model?.toLowerCase().includes('notebook')) return <Laptop size={20} className="text-blue-600" />;
    switch (asset.type) {
      case 'Celular': return <Smartphone size={20} className="text-blue-500" />;
      case 'Impressora': return <Printer size={20} className="text-orange-500" />;
      case 'PGT': return <CreditCard size={20} className="text-yellow-600" />;
      case 'Computador': return <Monitor size={20} className="text-purple-500" />;
      default: return <Network size={20} className="text-gray-500" />;
    }
  };

  const toggleSortDirection = () => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');

  const filters = [
    { label: 'Todos', value: 'Todos', icon: <LayoutGrid size={16}/> },
    { label: 'Notebooks', value: 'Notebook', icon: <Laptop size={16}/> },
    { label: 'Computadores', value: 'Computador', icon: <Monitor size={16}/> },
    { label: 'Celulares', value: 'Celular', icon: <Smartphone size={16}/> },
    { label: 'Maquininhas', value: 'PGT', icon: <CreditCard size={16}/> },
    { label: 'Impressoras', value: 'Impressora', icon: <Printer size={16}/> },
    { label: 'Promocionais', value: 'Promocionais', icon: <Megaphone size={16}/> }
  ];

  const statusOptions = ["Em Uso", "Disponível", "Em Transferência", "Manutenção", "Entregue", "Defeito", "Em Trânsito"];

  // KPI STATS (Calculados em tempo real)
  const stats = {
      total: assets.length,
      inUse: assets.filter(a => a.status === 'Em Uso' || a.status === 'Entregue').length,
      available: assets.filter(a => a.status === 'Disponível').length,
      maintenance: assets.filter(a => a.status === 'Manutenção' || a.status === 'Defeito').length
  };

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto relative pb-24">
      
      {/* IMPRESSÃO OCULTA */}
      <div style={{ display: 'none' }}>
        <div ref={bulkPrintRef} className="print-grid">
            <style>{`@media print { @page { size: A4; margin: 10mm; } body { -webkit-print-color-adjust: exact; } .print-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; width: 100%; } .bulk-label { border: 2px solid black; border-radius: 8px; padding: 10px; height: 5cm; display: flex; align-items: center; gap: 15px; page-break-inside: avoid; } }`}</style>
            {selectedAssetsData.map(asset => (
                <div key={asset.id} className="bulk-label">
                    <div style={{ width: '100px', height: '100px', flexShrink: 0 }}><QRCodeSVG value={asset.internalId} size={100} level="M" /></div>
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flexGrow: 1, justifyContent: 'space-between', overflow: 'hidden' }}>
                        <div style={{ height: '40px' }}><img src={logoShineray} alt="Shineray" style={{ height: '100%', maxHeight: '35px', objectFit: 'contain' }} /></div>
                        <div>
                            <span style={{ fontSize: '9px', textTransform: 'uppercase', color: '#666', fontWeight: 'bold' }}>Patrimônio</span>
                            <span style={{ fontSize: '24px', fontWeight: '900', color: 'black', fontFamily: 'monospace', lineHeight: '1', display: 'block' }}>{asset.internalId}</span>
                            <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#333', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{asset.model?.substring(0, 25)}</span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
      </div>

      {/* --- DASHBOARD KPIs ---  */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
              <div><p className="text-xs font-bold text-gray-400 uppercase">Total Ativos</p><p className="text-3xl font-black text-gray-900">{stats.total}</p></div>
              <div className="p-3 bg-gray-100 rounded-xl text-gray-600"><LayoutGrid size={24}/></div>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
              <div><p className="text-xs font-bold text-green-600 uppercase">Em Uso / Entregue</p><p className="text-3xl font-black text-gray-900">{stats.inUse}</p></div>
              <div className="p-3 bg-green-50 rounded-xl text-green-600"><Check size={24}/></div>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
              <div><p className="text-xs font-bold text-blue-600 uppercase">Disponível</p><p className="text-3xl font-black text-gray-900">{stats.available}</p></div>
              <div className="p-3 bg-blue-50 rounded-xl text-blue-600"><PackageCheck size={24}/></div>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
              <div><p className="text-xs font-bold text-orange-600 uppercase">Manutenção</p><p className="text-3xl font-black text-gray-900">{stats.maintenance}</p></div>
              <div className="p-3 bg-orange-50 rounded-xl text-orange-600"><Wrench size={24}/></div>
          </div>
      </div>

      {/* HEADER E AÇÕES */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        {selectedIds.length > 0 ? (
            <div className="flex items-center gap-3 bg-black text-white px-6 py-3 rounded-xl animate-in slide-in-from-top-2 shadow-xl z-20 w-full md:w-auto">
                <span className="text-sm font-bold whitespace-nowrap">{selectedIds.length} selecionados</span>
                <div className="h-4 w-px bg-gray-600 mx-2"></div>
                <button onClick={() => setIsStatusModalOpen(true)} className="flex items-center gap-2 hover:text-shineray transition-colors text-sm font-bold uppercase"><RefreshCcw size={18} /> Status</button>
                <button onClick={handleBulkPrint} className="flex items-center gap-2 hover:text-shineray transition-colors text-sm font-bold uppercase ml-4"><PrinterIcon size={18} /> Etiquetas</button>
                <button onClick={() => setSelectedIds([])} className="ml-4 text-xs text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
        ) : (
            <div className="flex-1 w-full flex flex-col md:flex-row gap-4 justify-between items-center">
                {/* FILTROS (ABAS) */}
                <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0 w-full md:w-auto scrollbar-hide">
                    {filters.map(f => (
                        <button key={f.value} onClick={() => setFilterType(f.value)} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all border ${filterType === f.value ? 'bg-black text-white border-black shadow-md' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}>
                            {f.icon} {f.label}
                        </button>
                    ))}
                </div>
                
                {/* BOTÕES AÇÃO */}
                <div className="flex gap-2 shrink-0">
                    <button onClick={handleExportExcel} className="p-3 bg-white border border-gray-200 rounded-xl text-green-600 hover:bg-green-50 shadow-sm" title="Exportar Excel"><Download size={20}/></button>
                    <Link to="/import" className="p-3 bg-white border border-gray-200 rounded-xl text-blue-600 hover:bg-blue-50 shadow-sm" title="Importar"><FileText size={20}/></Link>
                    <Link to="/assets/new" className="px-5 py-3 bg-black text-white rounded-xl font-bold hover:bg-gray-800 flex items-center gap-2 shadow-lg hover:scale-105 transition-transform"><Plus size={20} /> Novo Ativo</Link>
                </div>
            </div>
        )}
      </div>

      {/* BARRA DE BUSCA E ORDENAÇÃO */}
      <div className="bg-white p-2 pl-4 rounded-xl shadow-sm border border-gray-200 mb-6 flex items-center gap-4">
        <Search className="text-gray-400" size={20} />
        <input type="text" placeholder="Buscar por modelo, patrimônio, usuário..." className="flex-1 py-2 bg-transparent outline-none font-medium text-gray-700 placeholder-gray-400" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}/>
        
        <div className="h-8 w-px bg-gray-200"></div>
        
        <div className="flex items-center gap-2 pr-2">
            <span className="text-xs font-bold text-gray-400 uppercase hidden md:inline">Ordenar:</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="bg-transparent text-sm font-bold text-gray-700 outline-none cursor-pointer">
                <option value="internalId">Patrimônio</option>
                <option value="model">Modelo</option>
                <option value="status">Status</option>
            </select>
            <button onClick={toggleSortDirection} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">{sortOrder === 'asc' ? <ArrowDownAZ size={18} /> : <ArrowUpAZ size={18} />}</button>
        </div>
      </div>

      {/* TABELA MODERNA */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
            <div className="p-20 text-center text-gray-400 animate-pulse flex flex-col items-center"><div className="w-12 h-12 border-4 border-gray-200 border-t-black rounded-full animate-spin mb-4"></div>Carregando inventário...</div>
        ) : sortedAssets.length === 0 ? (
            <div className="p-20 text-center text-gray-400 flex flex-col items-center"><AlertCircle size={48} className="mb-4 opacity-20"/><p>Nenhum ativo encontrado com este filtro.</p></div>
        ) : (
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-50 border-b border-gray-100 text-xs uppercase text-gray-400 font-bold tracking-wider">
                            <th className="p-5 w-14 text-center">
                                <button onClick={toggleSelectAll} className="hover:text-black transition-colors">
                                    {selectedIds.length > 0 && selectedIds.length === sortedAssets.length ? <CheckSquare size={20} className="text-black"/> : <Square size={20}/>}
                                </button>
                            </th>
                            <th className="p-5">Ativo / Detalhes</th>
                            <th className="p-5">Identificação</th>
                            <th className="p-5">Responsável / Local</th>
                            <th className="p-5">Status</th>
                            <th className="p-5 text-center">Ações</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {sortedAssets.map((asset) => {
                            const responsibleName = asset.assignedTo || asset.clientName || '---';
                            return (
                                <tr key={asset.id} className={`hover:bg-gray-50/80 transition-colors group ${selectedIds.includes(asset.id) ? 'bg-blue-50/30' : ''}`}>
                                    <td className="p-5 text-center">
                                        <button onClick={() => toggleSelectOne(asset.id)} className="text-gray-300 hover:text-black">
                                            {selectedIds.includes(asset.id) ? <CheckSquare size={20} className="text-blue-600"/> : <Square size={20}/>}
                                        </button>
                                    </td>
                                    <td className="p-5">
                                        <div className="flex items-center gap-4">
                                            <div className="p-3 bg-gray-100 rounded-xl text-gray-600 group-hover:bg-white group-hover:shadow-md transition-all">{getTypeIcon(asset)}</div>
                                            <div>
                                                <p className="font-bold text-gray-900 text-sm">{asset.model}</p>
                                                <div className="flex gap-2 mt-1">
                                                    <span className="text-[10px] font-bold uppercase bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{asset.type}</span>
                                                    {(asset.category === 'Promocional' || asset.internalId?.includes('PRM')) && <span className="text-[10px] font-bold uppercase bg-pink-100 text-pink-600 px-2 py-0.5 rounded">Promo</span>}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-5">
                                        <p className="font-mono font-bold text-sm text-gray-700 bg-gray-50 px-2 py-1 rounded w-fit border border-gray-200">{asset.internalId}</p>
                                        <p className="text-xs text-gray-400 mt-1 font-mono">{asset.serialNumber || 'SN: ---'}</p>
                                    </td>
                                    <td className="p-5">
                                        <div className="flex items-center gap-3">
                                            {responsibleName !== '---' && (
                                                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600 uppercase border border-white shadow-sm">
                                                    {responsibleName.substring(0,2)}
                                                </div>
                                            )}
                                            <div>
                                                <p className="text-sm font-bold text-gray-800">{responsibleName}</p>
                                                <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><MapPin size={10}/> {asset.location || "Local n/d"}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-5">
                                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
                                            asset.status === 'Em Uso' ? 'bg-green-100 text-green-700' :
                                            asset.status === 'Disponível' ? 'bg-blue-100 text-blue-700' :
                                            asset.status === 'Entregue' ? 'bg-purple-100 text-purple-700' : 
                                            asset.status === 'Manutenção' ? 'bg-orange-100 text-orange-700' :
                                            'bg-gray-100 text-gray-600'
                                        }`}>
                                            <span className={`w-1.5 h-1.5 rounded-full mr-2 ${
                                                asset.status === 'Em Uso' ? 'bg-green-500' :
                                                asset.status === 'Disponível' ? 'bg-blue-500' :
                                                asset.status === 'Entregue' ? 'bg-purple-500' : 
                                                asset.status === 'Manutenção' ? 'bg-orange-500' :
                                                'bg-gray-500'
                                            }`}></span>
                                            {asset.status}
                                        </span>
                                    </td>
                                    <td className="p-5 text-center">
                                        <Link to={`/assets/${asset.id}`} className="p-2 text-gray-400 hover:text-black hover:bg-gray-100 rounded-lg transition-all inline-flex">
                                            <MoreHorizontal size={20} />
                                        </Link>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        )}
      </div>
      <div className="mt-4 text-center text-xs text-gray-400 font-medium">Exibindo {sortedAssets.length} de {assets.length} ativos cadastrados</div>

      {/* MODAL DE STATUS EM MASSA */}
      {isStatusModalOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
                  <div className="bg-black p-5 text-white flex justify-between items-center">
                      <h3 className="font-bold flex items-center gap-2"><RefreshCcw size={18} /> Novo Status</h3>
                      <button onClick={() => setIsStatusModalOpen(false)} className="hover:bg-gray-700 p-1 rounded transition-colors"><X size={18}/></button>
                  </div>
                  <div className="p-6">
                      <p className="text-sm text-gray-600 mb-4 font-medium">Aplicar status para <strong>{selectedIds.length}</strong> itens:</p>
                      <div className="flex flex-col gap-2">
                          {statusOptions.map(status => (
                              <button key={status} onClick={() => handleBulkStatusChange(status)} disabled={bulkProcessing} className="w-full py-3 px-4 rounded-xl border border-gray-100 bg-gray-50 hover:bg-black hover:text-white transition-all font-bold text-sm text-left flex items-center justify-between group">
                                  {status} <span className="opacity-0 group-hover:opacity-100 transition-opacity"><Check size={16}/></span>
                              </button>
                          ))}
                      </div>
                      {bulkProcessing && <p className="text-center text-xs text-gray-500 mt-4 animate-pulse font-bold">Processando...</p>}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default AssetList;