// src/pages/AssetList.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../services/firebase';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { updateAsset } from '../services/assetService';
import { Link, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx'; 
import { QRCodeSVG } from 'qrcode.react'; 
import { toast } from 'sonner';
import AssetListSkeleton from '../components/assets/AssetListSkeleton';
import AssetIcon from '../components/AssetIcon';
import AssetMetrics from '../components/assets/AssetMetrics';
import { 
  Search, Plus, Filter, LayoutGrid, 
  Smartphone, Monitor, Printer, Network, 
  MapPin, User, FileText, Laptop, Megaphone, CreditCard,
  Download, CheckSquare, Square, 
  Printer as PrinterIcon, RefreshCcw, X, Check, ArrowDownAZ, ArrowUpAZ,
  AlertCircle, ChevronRight, Plug, MoreVertical, SlidersHorizontal, Package
} from 'lucide-react';

const AssetList = () => {
  const navigate = useNavigate();
  
  // --- ESTADO LOCAL ---
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filtros e Ordenação
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('Todos');
  const [filterStatus, setFilterStatus] = useState('Todos');
  const [sortOrder, setSortOrder] = useState('asc'); 
  const [sortBy, setSortBy] = useState('internalId');
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false); // Mobile filter menu
   
  // Seleção e Ações em Massa
  const [selectedIds, setSelectedIds] = useState([]);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false); 
  const [bulkProcessing, setBulkProcessing] = useState(false); 

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

  // --- Lógica de Filtragem e Ordenação Otimizada ---
  const processedAssets = useMemo(() => {
    const safeLower = (val) => (val || '').toString().toLowerCase();

    // 1. Filtragem
    let result = assets.filter(asset => {
        const isPromo = asset.category === 'Promocional' || asset.internalId?.includes('PRM');
        
        // Filtro de Texto
        const term = safeLower(searchTerm);
        const matchesSearch = 
            safeLower(asset.model).includes(term) ||
            safeLower(asset.internalId).includes(term) ||
            safeLower(asset.serialNumber).includes(term) ||
            safeLower(asset.assignedTo).includes(term) ||
            safeLower(asset.clientName).includes(term) ||
            safeLower(asset.vendedor).includes(term);

        if (!matchesSearch) return false;

        // Filtro de Status
        if (filterStatus !== 'Todos' && asset.status !== filterStatus) return false;

        // Filtro de Tipo (Abas)
        if (filterType === 'Todos') return true;
        if (filterType === 'Promocionais') return isPromo;
        if (isPromo) return false;

        if (filterType === 'Notebook') return asset.type === 'Notebook' || safeLower(asset.model).includes('notebook');
        if (filterType === 'Computador') return asset.type === 'Computador' && !safeLower(asset.model).includes('notebook');
        
        return asset.type === filterType;
    });

    // 2. Ordenação
    return result.sort((a, b) => {
        const valA = safeLower(a[sortBy]);
        const valB = safeLower(b[sortBy]);
        return sortOrder === 'asc' 
            ? valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' })
            : valB.localeCompare(valA, undefined, { numeric: true, sensitivity: 'base' });
    });

  }, [assets, searchTerm, filterType, filterStatus, sortBy, sortOrder]);

  const toggleSelectAll = () => {
      if (selectedIds.length === processedAssets.length) setSelectedIds([]);
      else setSelectedIds(processedAssets.map(a => a.id));
  };

  const toggleSelectOne = (id) => {
      if (selectedIds.includes(id)) setSelectedIds(prev => prev.filter(itemId => itemId !== id));
      else setSelectedIds(prev => [...prev, id]);
  };

  const selectedAssetsData = useMemo(() => {
      return assets.filter(a => selectedIds.includes(a.id));
  }, [assets, selectedIds]);

  const selectedPeripheralsData = useMemo(() => {
      return selectedAssetsData.flatMap(asset => {
          const peripherals = asset.peripherals || [];
          return peripherals.map(p => ({
              ...p,
              parentId: asset.internalId, 
              parentModel: asset.model
          }));
      });
  }, [selectedAssetsData]);

  // --- Refs de Impressão ---
  const bulkPrintRef = useRef();
  const handleBulkPrint = useReactToPrint({ contentRef: bulkPrintRef, documentTitle: 'Etiquetas_Ativos_BySabel' });
  const bulkPeripheralPrintRef = useRef();
  const handleBulkPeripheralPrint = useReactToPrint({ contentRef: bulkPeripheralPrintRef, documentTitle: 'Etiquetas_Perifericos_BySabel' });

  // --- Ações ---
  const handleBulkStatusChange = async (newStatus) => {
      if (!confirm(`Mudar status de ${selectedIds.length} ativos para "${newStatus}"?`)) return;
      setBulkProcessing(true);
      try {
          const updates = selectedIds.map(id => updateAsset(id, { status: newStatus }, {
              action: 'Alteração em Massa',
              details: `Status alterado em lote para: ${newStatus}`,
              user: 'Admin TI'
          }));
          await Promise.all(updates);
          toast.success(`Status de ${selectedIds.length} ativos atualizados!`);
          setSelectedIds([]); 
          setIsStatusModalOpen(false); 
      } catch (error) { toast.error("Erro ao atualizar ativos em lote."); } finally { setBulkProcessing(false); }
  };

  const handleExportExcel = () => {
    const dataToExport = processedAssets.map(asset => ({
        'Patrimônio': asset.internalId,
        'Modelo': asset.model,
        'Tipo': asset.type,
        'Serial': asset.serialNumber || '',
        'Responsável': asset.assignedTo || asset.clientName || '',
        'Setor/Local': asset.location,
        'Status': asset.status,
    }));
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ativos");
    XLSX.writeFile(workbook, `Inventario_BySabel_${new Date().toLocaleDateString()}.xlsx`);
  };

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

  if (loading) return <AssetListSkeleton />;

  return (
    <div className="max-w-[1920px] mx-auto pb-24 animate-fade-in relative min-h-screen">
      
      
      {/* IMPRESSÃO (Oculta) */}
      <div style={{ display: 'none' }}>
        <div ref={bulkPrintRef} className="print-grid">
            <style>{`
                @media print { 
                    @page { size: A4; margin: 5mm; } 
                    body { -webkit-print-color-adjust: exact; } 
                    .print-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5mm; justify-items: center; width: 100%; } 
                    .bulk-label { width: 7cm; height: 3.5cm; padding: 4px; border: 2px solid black; border-radius: 6px; display: flex; align-items: center; gap: 6px; background-color: white; font-family: Arial, sans-serif; box-sizing: border-box; page-break-inside: avoid; overflow: hidden; } 
                }
            `}</style>
            {selectedAssetsData.map(asset => (
                <div key={asset.id} className="bulk-label">
                    <div style={{ width: '68px', height: '68px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <QRCodeSVG value={asset.internalId} size={68} level="M" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flexGrow: 1, justifyContent: 'space-between', overflow: 'hidden' }}>
                        <div style={{ height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', borderBottom: '1px solid #eee', paddingBottom: '2px' }}>
                            <img src="/logo.png" alt="BySabel" style={{ height: '100%', maxHeight: '28px' }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                            <span style={{ fontSize: '7px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase', lineHeight: '1' }}>Patrimônio</span>
                            <span style={{ fontSize: '18px', fontWeight: '900', color: 'black', fontFamily: 'monospace', lineHeight: '1.1', letterSpacing: '-0.5px' }}>{asset.internalId}</span>
                            <span style={{ fontSize: '8px', fontWeight: 'bold', color: '#333', textTransform: 'uppercase', marginTop: '2px', whiteSpace: 'nowrap', truncate: true, maxWidth: '125px' }}>{asset.model}</span>
                        </div>
                        <div style={{ borderTop: '1.5px solid #000', paddingTop: '1px', marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '6px', fontWeight: 'bold', color: '#444' }}>SUPORTE TI</span>
                            <span style={{ fontSize: '8px', fontWeight: '900', color: '#000' }}>shiadmti@gmail.com</span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
        <div ref={bulkPeripheralPrintRef} className="print-grid-peri">
           <style>{`@media print { @page { size: A4; margin: 5mm; } .print-grid-peri { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; justify-items: center; width: 100%; } .peri-label { width: 5cm; height: 2.5cm; padding: 2px; border: 1px solid black; border-radius: 4px; display: flex; align-items: center; gap: 3px; font-family: Arial, sans-serif; box-sizing: border-box; page-break-inside: avoid; overflow: hidden; } }`}</style>
           {selectedPeripheralsData.map((peri, i) => (
                <div key={i} className="peri-label">
                     <div style={{ width: '45px', height: '45px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><QRCodeSVG value={peri.parentId} size={42} level="M" /></div>
                     <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flexGrow: 1, justifyContent: 'space-between' }}>
                        <div style={{ height: '22px', borderBottom: '0.5px solid #ccc', marginBottom: '1px', display: 'flex', justifyContent:'center' }}><img src="/logo.png" style={{ height: '100%' }} /></div>
                        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 0.9 }}><span style={{ fontSize: '10px', fontWeight: '900', fontFamily: 'monospace' }}>{peri.parentId}</span><span style={{ fontSize: '6px', fontWeight: 'bold', textTransform: 'uppercase', truncate: true, maxWidth: '80px' }}>{peri.name}</span></div>
                        <div style={{ borderTop: '0.5px solid #000', paddingTop: '1px', marginTop: 'auto' }}><p style={{ margin: 0, fontSize: '5px', fontWeight: '900', textAlign: 'right' }}>TI BYSABEL</p></div>
                     </div>
                </div>
           ))}
        </div>
      </div>
      
      {/* 1. MINI DASHBOARD (UI 2.0) - Reusable Component */}
      <AssetMetrics assets={assets} />

      {/* 2. HEADER & FILTERS BAR */}
      <div className="px-4 md:px-8 pb-6 bg-[#F4F4F5] sticky top-0 md:static z-20">
          <div className="bg-white p-4 rounded-3xl shadow-sm border border-gray-100 flex flex-col md:flex-row gap-4 items-center">
              
              {/* SEARCH */}
              <div className="relative w-full md:flex-1">
                  <Search className="absolute left-4 top-3.5 text-gray-400" size={20} />
                  <input 
                      type="text" 
                      placeholder="Buscar por tag, modelo, serial ou responsável..." 
                      className="w-full pl-12 pr-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-black rounded-2xl outline-none font-bold text-sm transition-all" 
                      value={searchTerm} 
                      onChange={(e) => setSearchTerm(e.target.value)}
                  />
              </div>

              {/* FILTER BUTTONS (DESKTOP) */}
              <div className="hidden md:flex gap-2 items-center">
                   <div className="flex gap-1 bg-gray-50 p-1.5 rounded-2xl border border-gray-100">
                      {statusOptions.slice(0,3).map(st => (
                          <button 
                              key={st}
                              onClick={() => setFilterStatus(filterStatus === st ? 'Todos' : st)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${filterStatus === st ? 'bg-black text-white shadow-md' : 'text-gray-500 hover:bg-gray-200'}`}
                          >
                              {st}
                          </button>
                      ))}
                      <div className="w-[1px] h-6 bg-gray-200 mx-1 self-center"></div>
                      <select 
                          value={filterStatus} 
                          onChange={(e) => setFilterStatus(e.target.value)}
                          className="bg-transparent text-xs font-bold text-gray-500 outline-none cursor-pointer hover:text-black"
                      >
                          <option value="Todos">Mais Filtros</option>
                          {statusOptions.slice(3).map(st => <option key={st} value={st}>{st}</option>)}
                      </select>
                   </div>
                   
                   <button onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')} className="p-3 bg-gray-50 hover:bg-gray-100 rounded-2xl border border-gray-100 text-gray-600 transition-colors">
                      {sortOrder === 'asc' ? <ArrowDownAZ size={20} /> : <ArrowUpAZ size={20} />}
                   </button>
              </div>

              {/* IMPORT/EXPORT ACTIONS */}
              <div className="hidden md:flex gap-2 border-l border-gray-100 pl-4">
                  <button onClick={handleExportExcel} className="p-3 bg-green-50 text-green-700 hover:bg-green-100 rounded-2xl transition-colors" title="Exportar Excel"><Download size={20}/></button>
                  <Link to="/import" className="p-3 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-2xl transition-colors" title="Importar"><FileText size={20}/></Link>
              </div>
          </div>

          {/* Quick Categories Pills */}
          <div className="flex gap-3 overflow-x-auto py-4 scrollbar-hide">
              {filters.map(f => (
                  <button 
                      key={f.value} 
                      onClick={() => setFilterType(f.value)} 
                      className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold whitespace-nowrap transition-all border ${filterType === f.value ? 'bg-black text-white border-black shadow-lg scale-105' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
                  >
                      {f.icon} {f.label}
                  </button>
              ))}
          </div>
      </div>

      {/* 3. ASSET GRID/LIST */}
      <div className="px-4 md:px-8">
          {processedAssets.length === 0 ? (
              <div className="p-20 text-center text-gray-400 flex flex-col items-center bg-white rounded-3xl border border-gray-200 border-dashed animate-fade-in"><AlertCircle size={48} className="mb-4 opacity-20"/><p className="font-medium">Nenhum ativo encontrado com esses filtros.</p></div>
          ) : (
              <>
                {/* VIEW MOBILE: TRADING CARDS */}
                <div className="grid grid-cols-1 gap-4 md:hidden pb-20">
                    {processedAssets.map(asset => (
                        <div key={asset.id} onClick={() => navigate(`/assets/${asset.id}`)} className={`bg-white p-5 rounded-3xl border border-gray-100 shadow-[0_4px_20px_-12px_rgba(0,0,0,0.1)] active:scale-[0.98] transition-all relative overflow-hidden group ${selectedIds.includes(asset.id) ? 'ring-2 ring-black bg-gray-50' : ''}`}>
                            
                            {/* Card Decoration */}
                            <div className="absolute top-0 right-0 w-32 h-32 bg-gray-50 rounded-full -mr-10 -mt-10 opacity-50 pointer-events-none"></div>

                            <div className="flex justify-between items-start mb-4 relative z-10">
                                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wide ${asset.status === 'Em Uso' ? 'bg-green-100 text-green-700' : asset.status === 'Disponível' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                                    {asset.status}
                                </span>
                                <button onClick={(e) => { e.stopPropagation(); toggleSelectOne(asset.id); }} className="text-gray-300 active:scale-125 transition-transform p-1">
                                    {selectedIds.includes(asset.id) ? <CheckSquare size={24} className="text-black"/> : <Square size={24}/>}
                                </button>
                            </div>

                            <div className="flex items-center gap-5 relative z-10">
                                <div className="w-16 h-16 bg-white border border-gray-100 rounded-2xl flex items-center justify-center shadow-sm text-gray-700 shrink-0">
                                    <AssetIcon type={asset.type} category={asset.category} model={asset.model} internalId={asset.internalId} size={32} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h3 className="font-black text-gray-900 leading-tight truncate text-lg">{asset.model}</h3>
                                    <p className="text-xs text-gray-400 font-mono font-bold mt-1 tracking-wider">{asset.internalId}</p>
                                </div>
                            </div>

                            <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between text-xs font-medium text-gray-500 relative z-10">
                                <div className="flex items-center gap-2 truncate max-w-[60%]">
                                    <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center"><User size={12}/></div>
                                    <span className="truncate">{asset.assignedTo || asset.clientName || 'N/A'}</span>
                                </div>
                                <div className="flex items-center gap-1 opacity-75">
                                    <MapPin size={12}/> {asset.location?.substring(0,10) || 'N/A'}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* VIEW DESKTOP: PREMIUM TABLE */}
                <div className="hidden md:block bg-white rounded-[2rem] shadow-sm border border-gray-100 overflow-hidden">
                    <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full text-left border-collapse min-w-[1000px]">
                            <thead className="bg-[#FAFAFA] border-b border-gray-100 sticky top-0 z-10 backdrop-blur-sm">
                                <tr className="text-xs uppercase text-gray-400 font-black tracking-widest">
                                    <th className="p-6 w-16 text-center">
                                        <button onClick={toggleSelectAll} className="hover:text-black transition-colors">
                                            {selectedIds.length > 0 && selectedIds.length === processedAssets.length ? <CheckSquare size={20} className="text-black"/> : <Square size={20}/>}
                                        </button>
                                    </th>
                                    <th className="p-6">Ativo</th>
                                    <th className="p-6">Identificação</th>
                                    <th className="p-6">Responsável</th>
                                    <th className="p-6">Localização</th>
                                    <th className="p-6">Status</th>
                                    <th className="p-6 text-center">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {processedAssets.map((asset) => {
                                    const responsibleName = asset.assignedTo || asset.clientName || '---';
                                    return (
                                        <tr key={asset.id} className={`hover:bg-gray-50/80 transition-all group cursor-pointer ${selectedIds.includes(asset.id) ? 'bg-gray-50' : ''}`} onClick={() => navigate(`/assets/${asset.id}`)}>
                                            <td className="p-6 text-center" onClick={(e) => e.stopPropagation()}>
                                                <button onClick={() => toggleSelectOne(asset.id)} className="text-gray-300 hover:text-black transition-colors">
                                                    {selectedIds.includes(asset.id) ? <CheckSquare size={20} className="text-black"/> : <Square size={20}/>}
                                                </button>
                                            </td>
                                            <td className="p-6">
                                                <div className="flex items-center gap-5">
                                                    <div className="w-12 h-12 bg-white border border-gray-100 rounded-xl flex items-center justify-center shadow-sm text-gray-600 group-hover:scale-110 transition-transform shrink-0">
                                                        <AssetIcon type={asset.type} category={asset.category} model={asset.model} internalId={asset.internalId} size={20} />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-bold text-gray-900 text-sm truncate max-w-[200px]" title={asset.model}>{asset.model}</p>
                                                        <span className="text-[10px] font-bold uppercase text-gray-400 mt-1 block">{asset.type}</span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-6">
                                                <div className="bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200 w-fit group-hover:bg-white transition-colors">
                                                    <p className="font-mono font-bold text-xs text-gray-900">{asset.internalId}</p>
                                                </div>
                                                {asset.serialNumber && <p className="text-[10px] text-gray-400 mt-1 font-mono truncate max-w-[100px]">{asset.serialNumber}</p>}
                                            </td>
                                            <td className="p-6">
                                                <div className="flex items-center gap-3">
                                                    {responsibleName !== '---' && <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-[10px] font-black text-gray-600 uppercase border border-white shadow-sm shrink-0">{responsibleName.substring(0,2)}</div>}
                                                    <p className="text-sm font-bold text-gray-700 truncate max-w-[150px]">{responsibleName}</p>
                                                </div>
                                            </td>
                                            <td className="p-6">
                                                 <div className="flex items-center gap-2 text-gray-500 text-sm">
                                                    <MapPin size={14} className="text-gray-400"/>
                                                    <span className="truncate max-w-[150px] font-medium">{asset.location || "---"}</span>
                                                 </div>
                                            </td>
                                            <td className="p-6">
                                                <span className={`inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wide whitespace-nowrap shadow-sm border ${asset.status === 'Em Uso' ? 'bg-green-50 text-green-700 border-green-100' : asset.status === 'Disponível' ? 'bg-blue-50 text-blue-700 border-blue-100' : asset.status === 'Entregue' ? 'bg-purple-50 text-purple-700 border-purple-100' : 'bg-gray-50 text-gray-600 border-gray-100'}`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full mr-2 shrink-0 animate-pulse ${asset.status === 'Em Uso' ? 'bg-green-500' : asset.status === 'Disponível' ? 'bg-blue-500' : 'bg-gray-400'}`}></span>
                                                    {asset.status}
                                                </span>
                                            </td>
                                            <td className="p-6 text-center">
                                                <div className="p-2 text-gray-300 group-hover:text-black hover:bg-gray-100 rounded-xl transition-all inline-flex"><ChevronRight size={20} /></div>
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
      </div>

      <div className="mt-8 text-center text-[10px] text-gray-300 font-bold uppercase tracking-widest pb-8">Exibindo {processedAssets.length} de {assets.length} ativos</div>

      {/* FLOATING ACTION BAR FOR BULK ACTIONS */}
      {selectedIds.length > 0 && (
            <div className={`fixed ${window.innerWidth < 768 ? 'bottom-[90px]' : 'bottom-8'} left-1/2 -translate-x-1/2 bg-[#18181B] text-white p-2 pl-6 pr-2 rounded-full shadow-2xl z-50 flex items-center gap-6 animate-in slide-in-from-bottom-10 border border-white/10 w-[90%] md:w-auto max-w-2xl`}>
                <div className="flex items-center gap-3">
                    <div className="bg-white text-black w-6 h-6 rounded-full flex items-center justify-center font-black text-xs">{selectedIds.length}</div>
                    <span className="text-sm font-bold whitespace-nowrap hidden sm:inline">Selecionados</span>
                </div>
                <div className="h-6 w-[1px] bg-white/20"></div>
                <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                    <button onClick={() => setIsStatusModalOpen(true)} className="flex items-center gap-2 hover:bg-white/20 px-4 py-2 rounded-full text-xs font-bold uppercase transition-colors whitespace-nowrap">
                        <RefreshCcw size={14} /> Status
                    </button>
                    <button onClick={handleBulkPrint} className="flex items-center gap-2 hover:bg-white/20 px-4 py-2 rounded-full text-xs font-bold uppercase transition-colors whitespace-nowrap">
                        <PrinterIcon size={14} /> Etiquetas
                    </button>
                    {selectedPeripheralsData.length > 0 && (
                        <button onClick={handleBulkPeripheralPrint} className="flex items-center gap-2 hover:bg-white/20 px-4 py-2 rounded-full text-xs font-bold uppercase transition-colors whitespace-nowrap">
                            <Plug size={14} /> Acessórios
                        </button>
                    )}
                </div>
                <button onClick={() => setSelectedIds([])} className="p-2 hover:bg-red-600 rounded-full transition-colors ml-auto"><X size={18} /></button>
            </div>
      )}

      {/* MODAL DE STATUS */}
      {isStatusModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-in fade-in">
              <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 p-2">
                  <div className="bg-gray-50 p-5 rounded-[1.5rem] mb-2 flex justify-between items-center">
                      <h3 className="font-black text-lg flex items-center gap-2"><RefreshCcw size={20} className="text-black" /> Novo Status</h3>
                      <button onClick={() => setIsStatusModalOpen(false)} className="hover:bg-gray-200 p-2 rounded-full transition-colors"><X size={20}/></button>
                  </div>
                  <div className="p-4">
                      <p className="text-sm text-gray-500 mb-6 font-medium px-2">Alterar status de <strong>{selectedIds.length}</strong> itens selecionados:</p>
                      <div className="space-y-2">
                          {statusOptions.map(status => (
                              <button key={status} onClick={() => handleBulkStatusChange(status)} disabled={bulkProcessing} className="w-full py-3 px-5 rounded-2xl border border-gray-100 bg-white hover:bg-black hover:text-white hover:border-black transition-all font-bold text-sm text-left flex items-center justify-between group active:scale-95 shadow-sm">
                                  {status} <span className="opacity-0 group-hover:opacity-100 transition-opacity"><Check size={16}/></span>
                              </button>
                          ))}
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default AssetList;
