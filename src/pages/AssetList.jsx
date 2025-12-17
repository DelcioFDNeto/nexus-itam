// src/pages/AssetList.jsx
import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/firebase';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { updateAsset } from '../services/assetService';
import { Link, useNavigate } from 'react-router-dom';
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
  LayoutGrid, PackageCheck, Wrench, AlertCircle, ChevronRight
} from 'lucide-react';

const AssetList = () => {
  const navigate = useNavigate();
  
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

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto relative pb-24">
      
     {/* IMPRESSÃO OCULTA (PADRÃO COMPACTO 7x3.5cm) */}
      <div style={{ display: 'none' }}>
        <div ref={bulkPrintRef} className="print-grid">
            <style>{`
                @media print { 
                    @page { 
                        size: A4; 
                        margin: 5mm; 
                    } 
                    body { 
                        -webkit-print-color-adjust: exact; 
                    } 
                    .print-grid { 
                        display: grid; 
                        grid-template-columns: repeat(3, 1fr); /* 3 Etiquetas por linha para economizar folha */
                        gap: 5mm; 
                        justify-items: center; 
                        width: 100%;
                    } 
                    .bulk-label { 
                        width: 7cm; 
                        height: 3.5cm; 
                        padding: 5px; 
                        border: 1.5px solid black; 
                        border-radius: 4px; 
                        display: flex; 
                        flex-direction: row;
                        align-items: center; 
                        gap: 8px; 
                        background-color: white;
                        font-family: Arial, sans-serif;
                        box-sizing: border-box;
                        page-break-inside: avoid; 
                        overflow: hidden;
                    } 
                }
            `}</style>
            
            {selectedAssetsData.map(asset => (
                <div key={asset.id} className="bulk-label">
                    
                    {/* ESQUERDA: QR CODE */}
                    <div style={{ width: '65px', height: '65px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <QRCodeSVG value={asset.internalId} size={65} level="M" />
                    </div>

                    {/* DIREITA: DADOS */}
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flexGrow: 1, justifyContent: 'space-between', overflow: 'hidden' }}>
                        
                        {/* Logo */}
                        <div style={{ height: '20px', display: 'flex', alignItems: 'center' }}>
                            <img src={logoShineray} alt="Shineray" style={{ height: '100%', maxHeight: '18px', width: 'auto', objectFit: 'contain' }} />
                        </div>

                        {/* Patrimônio e Modelo */}
                        <div style={{ display: 'flex', flexDirection: 'column', marginTop: '-2px' }}>
                            <span style={{ fontSize: '18px', fontWeight: '900', color: 'black', fontFamily: 'monospace', lineHeight: '1', letterSpacing: '-0.5px' }}>
                                {asset.internalId}
                            </span>
                            <span style={{ fontSize: '8px', fontWeight: 'bold', color: '#444', textTransform: 'uppercase', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>
                                {asset.model}
                            </span>
                        </div>

                        {/* Rodapé Suporte */}
                        <div style={{ borderTop: '1px solid #000', paddingTop: '2px', marginTop: 'auto' }}>
                            <p style={{ margin: 0, fontSize: '6px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase' }}>Suporte TI:</p>
                            <p style={{ margin: 0, fontSize: '8px', fontWeight: '900', color: '#000' }}>shiadmti@gmail.com</p>
                        </div>
                    </div>
                </div>
            ))}
        </div>
      </div>
      
      {/* HEADER E AÇÕES */}
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex justify-between items-end">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Inventário</h1>
                <p className="text-gray-500 text-sm">Base de ativos TI</p>
            </div>
            
            <div className="hidden md:flex gap-3">
                <button onClick={handleExportExcel} className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-green-700 font-bold hover:bg-green-50 shadow-sm flex items-center gap-2 transition-all hover:scale-105 active:scale-95"><Download size={18} /> Excel</button>
                <Link to="/import" className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-blue-700 font-bold hover:bg-blue-50 flex items-center gap-2 transition-all hover:scale-105 active:scale-95"><FileText size={18} /> Importar</Link>
                <Link to="/assets/new" className="px-4 py-2 bg-black text-white rounded-lg font-bold hover:bg-gray-800 flex items-center gap-2 shadow-lg transition-all hover:scale-105 active:scale-95"><Plus size={18} /> Novo</Link>
            </div>
        </div>

        {/* BARRA FLUTUANTE DE AÇÃO EM MASSA */}
        {selectedIds.length > 0 && (
            <div className="fixed bottom-20 md:bottom-8 left-4 right-4 md:left-auto md:right-8 bg-black/90 backdrop-blur-md text-white p-4 rounded-2xl shadow-2xl z-50 flex items-center justify-between animate-in slide-in-from-bottom-4 border border-white/10">
                <div className="flex items-center gap-3">
                    <div className="bg-white/20 px-3 py-1 rounded-lg font-bold text-sm">{selectedIds.length}</div>
                    <span className="text-sm font-bold hidden md:inline">Itens selecionados</span>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setIsStatusModalOpen(true)} className="flex items-center gap-2 bg-white/10 hover:bg-white/20 px-3 py-2 rounded-lg text-sm font-bold transition-colors"><RefreshCcw size={16} /> <span className="hidden md:inline">Status</span></button>
                    <button onClick={handleBulkPrint} className="flex items-center gap-2 bg-white/10 hover:bg-white/20 px-3 py-2 rounded-lg text-sm font-bold transition-colors"><PrinterIcon size={16} /> <span className="hidden md:inline">Etiquetas</span></button>
                    <button onClick={() => setSelectedIds([])} className="p-2 bg-white/10 hover:bg-red-600 hover:text-white rounded-lg transition-colors ml-2"><X size={18} /></button>
                </div>
            </div>
        )}

        {/* CONTROLES DE BUSCA E FILTRO */}
        <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
                <Search className="absolute left-3 top-3 text-gray-400" size={20} />
                <input type="text" placeholder="Buscar ativo, patrimônio, modelo..." className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-black font-medium text-sm shadow-sm transition-shadow hover:shadow-md" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}/>
            </div>

            <div className="hidden md:flex gap-1 border border-gray-200 rounded-xl p-1 bg-white items-center shadow-sm">
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="pl-3 pr-8 py-2 text-sm bg-transparent outline-none font-bold text-gray-700 cursor-pointer">
                    <option value="internalId">Patrimônio</option>
                    <option value="model">Modelo</option>
                    <option value="status">Status</option>
                </select>
                <button onClick={toggleSortDirection} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 border-l border-gray-100">{sortOrder === 'asc' ? <ArrowDownAZ size={18} /> : <ArrowUpAZ size={18} />}</button>
            </div>
        </div>

        {/* FILTROS SCROLLÁVEIS */}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
            {filters.map(f => (
                <button key={f.value} onClick={() => setFilterType(f.value)} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all border ${filterType === f.value ? 'bg-black text-white border-black shadow-md scale-105' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}>
                    {f.icon} {f.label}
                </button>
            ))}
        </div>
      </div>

      {/* --- MODO LISTA (DESKTOP: TABLE / MOBILE: CARDS) --- */}
      {loading ? (
          <div className="p-20 text-center text-gray-400 animate-pulse flex flex-col items-center"><div className="w-10 h-10 border-4 border-gray-200 border-t-black rounded-full animate-spin mb-4"></div>Carregando inventário...</div>
      ) : sortedAssets.length === 0 ? (
          <div className="p-20 text-center text-gray-400 flex flex-col items-center bg-white rounded-2xl border border-gray-200 border-dashed"><AlertCircle size={48} className="mb-4 opacity-20"/><p>Nenhum ativo encontrado.</p></div>
      ) : (
          <>
            {/* VIEW MOBILE: CARDS */}
            <div className="grid grid-cols-1 gap-3 md:hidden">
                {sortedAssets.map(asset => (
                    <div key={asset.id} onClick={() => navigate(`/assets/${asset.id}`)} className={`bg-white p-4 rounded-xl border border-gray-200 shadow-sm active:scale-[0.98] transition-all relative overflow-hidden ${selectedIds.includes(asset.id) ? 'ring-2 ring-black border-transparent bg-gray-50' : ''}`}>
                        
                        <div className="absolute top-4 right-4 z-10" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => toggleSelectOne(asset.id)} className="text-gray-300 active:scale-125 transition-transform">
                                {selectedIds.includes(asset.id) ? <CheckSquare size={24} className="text-black"/> : <Square size={24}/>}
                            </button>
                        </div>

                        <div className="flex items-start gap-4 pr-10">
                            <div className="p-3 bg-gray-50 rounded-xl text-gray-600 shrink-0">{getTypeIcon(asset)}</div>
                            <div className="min-w-0">
                                <h3 className="font-bold text-gray-900 leading-tight truncate">{asset.model}</h3>
                                <p className="text-xs text-gray-500 font-mono mt-0.5 font-bold tracking-wide">{asset.internalId}</p>
                                <span className={`inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                    asset.status === 'Em Uso' ? 'bg-green-100 text-green-700' :
                                    asset.status === 'Disponível' ? 'bg-blue-100 text-blue-700' :
                                    'bg-gray-100 text-gray-600'
                                }`}>{asset.status}</span>
                            </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-gray-50 flex items-center justify-between text-xs text-gray-500">
                            <div className="flex items-center gap-1.5 truncate max-w-[60%]">
                                <User size={14} className="text-gray-400 shrink-0"/> 
                                <span className="font-medium truncate">{asset.assignedTo || asset.clientName || 'Sem dono'}</span>
                            </div>
                            <div className="flex items-center gap-1 truncate max-w-[40%] justify-end">
                                <MapPin size={14} className="text-gray-400 shrink-0"/> 
                                <span className="truncate">{asset.location?.split('-')[0] || 'N/D'}</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* VIEW DESKTOP: TABLE (Responsive Scroll) */}
            <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto custom-scrollbar">
                    {/* min-w-[1000px] garante que a tabela não esprema em telas médias */}
                    <table className="w-full text-left border-collapse min-w-[1000px]">
                        <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
                            <tr className="text-xs uppercase text-gray-400 font-bold tracking-wider">
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
                                    <tr key={asset.id} className={`hover:bg-gray-50/80 transition-colors group cursor-pointer ${selectedIds.includes(asset.id) ? 'bg-blue-50/30' : ''}`} onClick={() => navigate(`/assets/${asset.id}`)}>
                                        <td className="p-5 text-center" onClick={(e) => e.stopPropagation()}>
                                            <button onClick={() => toggleSelectOne(asset.id)} className="text-gray-300 hover:text-black transition-colors">
                                                {selectedIds.includes(asset.id) ? <CheckSquare size={20} className="text-blue-600"/> : <Square size={20}/>}
                                            </button>
                                        </td>
                                        <td className="p-5">
                                            <div className="flex items-center gap-4">
                                                <div className="p-3 bg-gray-100 rounded-xl text-gray-600 group-hover:bg-white group-hover:shadow-md transition-all shrink-0">{getTypeIcon(asset)}</div>
                                                <div className="min-w-0">
                                                    <p className="font-bold text-gray-900 text-sm truncate max-w-[200px]" title={asset.model}>{asset.model}</p>
                                                    <div className="flex gap-2 mt-1">
                                                        <span className="text-[10px] font-bold uppercase bg-gray-100 text-gray-500 px-2 py-0.5 rounded whitespace-nowrap">{asset.type}</span>
                                                        {(asset.category === 'Promocional' || asset.internalId?.includes('PRM')) && <span className="text-[10px] font-bold uppercase bg-pink-100 text-pink-600 px-2 py-0.5 rounded whitespace-nowrap">Promo</span>}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-5">
                                            <p className="font-mono font-bold text-sm text-gray-700 bg-gray-50 px-2 py-1 rounded w-fit border border-gray-200">{asset.internalId}</p>
                                            <p className="text-xs text-gray-400 mt-1 font-mono truncate max-w-[120px]" title={asset.serialNumber}>{asset.serialNumber || 'SN: ---'}</p>
                                        </td>
                                        <td className="p-5">
                                            <div className="flex items-center gap-3">
                                                {responsibleName !== '---' && (
                                                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600 uppercase border border-white shadow-sm shrink-0">
                                                        {responsibleName.substring(0,2)}
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <p className="text-sm font-bold text-gray-800 truncate max-w-[150px]" title={responsibleName}>{responsibleName}</p>
                                                    <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5 truncate max-w-[150px]" title={asset.location}><MapPin size={10} className="shrink-0"/> {asset.location || "Local n/d"}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-5">
                                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide whitespace-nowrap ${
                                                asset.status === 'Em Uso' ? 'bg-green-100 text-green-700' :
                                                asset.status === 'Disponível' ? 'bg-blue-100 text-blue-700' :
                                                asset.status === 'Entregue' ? 'bg-purple-100 text-purple-700' : 
                                                asset.status === 'Manutenção' ? 'bg-orange-100 text-orange-700' :
                                                'bg-gray-100 text-gray-600'
                                            }`}>
                                                <span className={`w-1.5 h-1.5 rounded-full mr-2 shrink-0 ${
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
                                            <div className="p-2 text-gray-400 hover:text-black hover:bg-gray-100 rounded-lg transition-all inline-flex group-hover:bg-white group-hover:shadow-sm">
                                                <ChevronRight size={20} />
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
          </>
      )}
      
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