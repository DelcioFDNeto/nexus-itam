// src/pages/AssetList.jsx
import React, { useState, useEffect, useRef } from 'react';
// REMOVIDO: import { useAssets } from '../hooks/useAssets';
// ADICIONADO:
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
  Download, ArrowUpDown, CheckSquare, Square, 
  Printer as PrinterIcon, RefreshCcw, X, Check
} from 'lucide-react';

const AssetList = () => {
  // --- ESTADO LOCAL (Agora gerenciado pelo onSnapshot) ---
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('Todos');
  const [sortOrder, setSortOrder] = useState('asc');
   
  // --- ESTADOS DE AÇÃO EM MASSA ---
  const [selectedIds, setSelectedIds] = useState([]);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false); 
  const [bulkProcessing, setBulkProcessing] = useState(false); 

  // --- MUDANÇA PRINCIPAL: LISTA EM TEMPO REAL ---
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

  // --- CONFIGURAÇÃO DE IMPRESSÃO EM MASSA ---
  const bulkPrintRef = useRef();
  const handleBulkPrint = useReactToPrint({
    contentRef: bulkPrintRef,
    documentTitle: 'Etiquetas_Lote_Shineray',
  });

  // --- HELPER DE GARANTIA ---
  const getWarrantyStatus = (dateStr) => {
    if (!dateStr || dateStr.length < 10) return null;
    const purchase = new Date(dateStr);
    const today = new Date();
    const expiration = new Date(purchase);
    expiration.setFullYear(purchase.getFullYear() + 1);
    const thirtyDays = new Date();
    thirtyDays.setDate(today.getDate() + 30);

    if (today > expiration) return <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 ml-2 shadow-sm" title="Garantia Vencida"></span>;
    if (expiration < thirtyDays) return <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-500 ml-2 shadow-sm" title="Vence em breve"></span>;
    return <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 ml-2 shadow-sm" title="Garantia Vigente"></span>;
  };

  // --- FILTRAGEM ---
  const filteredAssets = assets.filter(asset => {
    const matchesSearch = 
      asset.model?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      asset.internalId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      asset.clientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      asset.assignedTo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      asset.vendedor?.toLowerCase().includes(searchTerm.toLowerCase());

    let matchesType = true;
    if (filterType === 'Todos') matchesType = true;
    else if (filterType === 'Promocionais') matchesType = asset.category === 'Promocional' || asset.internalId?.includes('PRM');
    else if (filterType === 'Notebook') {
        const isNotebookType = asset.type === 'Notebook';
        const isNotebookModel = asset.model?.toLowerCase().includes('notebook');
        const isNotPromo = asset.category !== 'Promocional';
        matchesType = (isNotebookType || isNotebookModel) && isNotPromo;
    } else {
        if (filterType === 'Computador') {
            const isNotebookModel = asset.model?.toLowerCase().includes('notebook');
            matchesType = asset.type === 'Computador' && !isNotebookModel;
        } else {
            matchesType = asset.type === filterType;
        }
    }
    return matchesSearch && matchesType;
  });

  // --- ORDENAÇÃO ---
  const sortedAssets = [...filteredAssets].sort((a, b) => {
      const valA = a.model?.toLowerCase() || '';
      const valB = b.model?.toLowerCase() || '';
      return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
  });

  // --- LÓGICA DE SELEÇÃO ---
  const toggleSelectAll = () => {
      if (selectedIds.length === sortedAssets.length) {
          setSelectedIds([]);
      } else {
          setSelectedIds(sortedAssets.map(a => a.id));
      }
  };

  const toggleSelectOne = (id) => {
      if (selectedIds.includes(id)) {
          setSelectedIds(selectedIds.filter(itemId => itemId !== id));
      } else {
          setSelectedIds([...selectedIds, id]);
      }
  };

  const selectedAssetsData = assets.filter(a => selectedIds.includes(a.id));

  // --- LÓGICA DE ATUALIZAÇÃO EM MASSA (STATUS) ---
  const handleBulkStatusChange = async (newStatus) => {
      if (!confirm(`Tem certeza que deseja mudar o status de ${selectedIds.length} ativos para "${newStatus}"?`)) return;
      
      setBulkProcessing(true);
      try {
          const updates = selectedIds.map(id => updateAsset(id, { status: newStatus }));
          await Promise.all(updates);
          
          alert("Status atualizados com sucesso!");
          setSelectedIds([]); 
          setIsStatusModalOpen(false); 
          // O refreshAssets() foi removido pois o onSnapshot atualizará a tela sozinho
      } catch (error) {
          console.error("Erro na atualização em massa:", error);
          alert("Erro ao atualizar alguns itens.");
      } finally {
          setBulkProcessing(false);
      }
  };

  // --- EXPORTAÇÃO EXCEL ---
  const handleExportExcel = () => {
    const dataToExport = sortedAssets.map(asset => ({
        'Patrimônio': asset.internalId,
        'Modelo': asset.model,
        'Tipo': asset.type,
        'Categoria': asset.category,
        'Status': asset.status,
        'Responsável': asset.clientName || asset.assignedTo || '---',
        'Vendedor': asset.vendedor || '',
        'Localização': asset.location,
        'Serial': asset.serialNumber || '',
        'IMEI 1': asset.imei1 || '',
        'Valor': asset.valor || '',
        'Data Aquisição': asset.purchaseDate ? new Date(asset.purchaseDate).toLocaleDateString('pt-BR') : ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ativos");
    XLSX.writeFile(workbook, `Inventario_Shineray_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.xlsx`);
  };

  // --- HELPERS VISUAIS ---
  const getResponsiblePerson = (asset) => {
    if (asset.category === 'Promocional' || asset.internalId?.includes('PRM')) {
        return (
            <div className="flex flex-col">
                <span className="text-purple-700 font-bold text-xs">{asset.clientName || asset.assignedTo || "Cliente Final"}</span>
                {asset.vendedor && <span className="text-[10px] text-gray-400">Vend: {asset.vendedor}</span>}
            </div>
        );
    } 
    const name = asset.clientName || asset.assignedTo;
    return (!name || name === 'Não definido') ? <span className="text-gray-400 italic">---</span> : <span className="text-gray-900 font-medium capitalize">{name.toLowerCase()}</span>;
  };

  const getTypeIcon = (asset) => {
    if (asset.category === 'Promocional' || asset.internalId?.includes('PRM')) return <Megaphone size={18} className="text-pink-500" />;
    if (asset.model?.toLowerCase().includes('notebook')) return <Laptop size={18} className="text-blue-600" />;
    switch (asset.type) {
      case 'Celular': return <Smartphone size={18} className="text-blue-500" />;
      case 'Impressora': return <Printer size={18} className="text-orange-500" />;
      case 'PGT': return <CreditCard size={18} className="text-yellow-600" />;
      case 'Computador': return <Monitor size={18} className="text-purple-500" />;
      default: return <Network size={18} className="text-gray-500" />;
    }
  };

  const toggleSort = () => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');

  const filters = [
    { label: 'Todos', value: 'Todos' },
    { label: 'Notebooks', value: 'Notebook' },
    { label: 'Computadores', value: 'Computador' },
    { label: 'Celulares', value: 'Celular' },
    { label: 'Maquininhas', value: 'PGT' },
    { label: 'Impressoras', value: 'Impressora' },
    { label: 'Promocionais', value: 'Promocionais' }
  ];

  const statusOptions = [
      "Em Uso", "Disponível", "Em Transferência", "Manutenção", "Entregue", "Defeito", "Em Trânsito"
  ];

  return (
    <div className="p-8 max-w-[1600px] mx-auto relative">
      
      {/* --- ÁREA DE IMPRESSÃO EM MASSA (OCULTA) --- */}
      <div style={{ display: 'none' }}>
        <div ref={bulkPrintRef} className="print-grid">
            <style>{`
                @media print {
                    @page { size: A4; margin: 10mm; }
                    body { -webkit-print-color-adjust: exact; }
                    .print-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; width: 100%; }
                    .bulk-label { border: 2px solid black; border-radius: 8px; padding: 10px; height: 5cm; display: flex; align-items: center; gap: 15px; page-break-inside: avoid; }
                }
            `}</style>
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
                        <div style={{ borderTop: '2px solid #000', paddingTop: '2px', marginTop: 'auto' }}>
                            <p style={{ margin: 0, fontSize: '9px', fontWeight: 'bold' }}>Suporte TI:</p>
                            <p style={{ margin: 0, fontSize: '11px', fontWeight: '900' }}>shiadmti@gmail.com</p>
                        </div>
                    </div>
                </div>
            ))}
        </div>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventário de Ativos</h1>
          <p className="text-gray-500 text-sm">Gerencie todos os equipamentos da Shineray</p>
        </div>
        
        {/* BARRA DE AÇÕES EM MASSA */}
        {selectedIds.length > 0 ? (
            <div className="flex items-center gap-3 bg-black text-white px-4 py-2 rounded-lg animate-in slide-in-from-top-2 shadow-xl z-20">
                <span className="text-sm font-bold whitespace-nowrap">{selectedIds.length} selecionados</span>
                <div className="h-4 w-px bg-gray-600 mx-2"></div>
                
                {/* BOTÃO MUDAR STATUS */}
                <button 
                    onClick={() => setIsStatusModalOpen(true)}
                    className="flex items-center gap-2 hover:text-shineray transition-colors text-sm font-bold uppercase"
                >
                    <RefreshCcw size={18} /> Alterar Status
                </button>

                {/* BOTÃO IMPRIMIR */}
                <button 
                    onClick={handleBulkPrint}
                    className="flex items-center gap-2 hover:text-shineray transition-colors text-sm font-bold uppercase ml-4"
                >
                    <PrinterIcon size={18} /> Etiquetas
                </button>

                <button onClick={() => setSelectedIds([])} className="ml-4 text-xs text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
        ) : (
            <div className="flex gap-3 w-full md:w-auto">
                <button onClick={handleExportExcel} className="px-4 py-2 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 flex items-center gap-2 shadow-sm border border-green-700"><Download size={18} /> Excel</button>
                <Link to="/import" className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 font-bold hover:bg-gray-50 flex items-center gap-2"><FileText size={18} /> Importar</Link>
                <Link to="/assets/new" className="px-4 py-2 bg-black text-white rounded-lg font-bold hover:bg-gray-800 flex items-center gap-2"><Plus size={18} /> Novo Ativo</Link>
            </div>
        )}
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6 flex flex-col md:flex-row gap-4 items-center">
        <div className="relative flex-1 w-full flex gap-2">
            <div className="relative flex-1">
                <Search className="absolute left-3 top-3 text-gray-400" size={20} />
                <input type="text" placeholder="Buscar..." className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-black" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}/>
            </div>
            <button onClick={toggleSort} className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 flex items-center gap-2 font-bold text-sm min-w-[140px] justify-center">
                <ArrowUpDown size={16} /> {sortOrder === 'asc' ? 'A-Z (Nome)' : 'Z-A (Nome)'}
            </button>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 scrollbar-hide">
            <Filter size={20} className="text-gray-400 shrink-0" />
            {filters.map(f => (
                <button key={f.value} onClick={() => setFilterType(f.value)} className={`px-3 py-1.5 rounded-full text-sm font-bold whitespace-nowrap transition-colors ${filterType === f.value ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {f.label}
                </button>
            ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
            <div className="p-10 text-center text-gray-500 flex flex-col items-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black mb-2"></div>Carregando...</div>
        ) : sortedAssets.length === 0 ? (
            <div className="p-10 text-center text-gray-500">Nenhum ativo encontrado.</div>
        ) : (
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500 font-bold tracking-wider">
                            <th className="p-4 w-10">
                                <button onClick={toggleSelectAll} className="text-gray-500 hover:text-black">
                                    {selectedIds.length > 0 && selectedIds.length === sortedAssets.length ? <CheckSquare size={20}/> : <Square size={20}/>}
                                </button>
                            </th>
                            <th className="p-4">Ativo / Modelo</th>
                            <th className="p-4">Patrimônio</th>
                            <th className="p-4">Localização</th>
                            <th className="p-4"><div className="flex items-center gap-1"><User size={14} /> Usuário / Cliente</div></th>
                            <th className="p-4">Aquisição</th>
                            <th className="p-4">Status</th>
                            <th className="p-4 text-center">Ações</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-sm">
                        {sortedAssets.map((asset) => (
                            <tr key={asset.id} className={`hover:bg-gray-50 transition-colors group ${selectedIds.includes(asset.id) ? 'bg-gray-50' : ''}`}>
                                <td className="p-4">
                                    <button onClick={() => toggleSelectOne(asset.id)} className="text-gray-400 hover:text-shineray">
                                        {selectedIds.includes(asset.id) ? <CheckSquare size={20} className="text-black"/> : <Square size={20}/>}
                                    </button>
                                </td>
                                <td className="p-4">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-gray-100 rounded-lg text-gray-600 shadow-sm">{getTypeIcon(asset)}</div>
                                        <div>
                                            <p className="font-bold text-gray-900">{asset.model}</p>
                                            <p className="text-xs text-gray-500 flex gap-1 items-center">
                                                {(asset.category === 'Promocional' || asset.internalId?.includes('PRM')) ? <span className="text-pink-600 font-bold bg-pink-50 px-1 rounded">PROMOCIONAL</span> : asset.type}
                                            </p>
                                        </div>
                                    </div>
                                </td>
                                <td className="p-4 font-mono font-medium text-gray-600">{asset.internalId}</td>
                                <td className="p-4 text-gray-600"><div className="flex items-center gap-2"><MapPin size={14} className="text-gray-400" />{asset.location || "Não def."}</div></td>
                                <td className="p-4">{getResponsiblePerson(asset)}</td>
                                <td className="p-4 text-gray-600 font-mono text-xs">{asset.purchaseDate ? (<div className="flex items-center">{new Date(asset.purchaseDate).toLocaleDateString('pt-BR')}{asset.category !== 'Promocional' && !asset.internalId?.includes('PRM') && getWarrantyStatus(asset.purchaseDate)}</div>) : '-'}</td>
                                <td className="p-4">
                                    <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${
                                        asset.status === 'Em Uso' ? 'bg-green-100 text-green-700' :
                                        asset.status === 'Disponível' ? 'bg-blue-100 text-blue-700' :
                                        asset.status === 'Entregue' ? 'bg-purple-100 text-purple-700' : 
                                        asset.status === 'Manutenção' ? 'bg-orange-100 text-orange-700' :
                                        asset.status?.includes('Transfer') ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'
                                    }`}>{asset.status}</span>
                                </td>
                                <td className="p-4 text-center">
                                    <Link to={`/assets/${asset.id}`} className="inline-flex p-2 text-gray-400 hover:text-black hover:bg-gray-200 rounded-full transition-colors"><MoreHorizontal size={20} /></Link>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
      </div>
      <div className="mt-4 text-center text-xs text-gray-400">Exibindo {sortedAssets.length} de {assets.length} ativos</div>

      {/* --- MODAL DE ALTERAÇÃO DE STATUS EM MASSA --- */}
      {isStatusModalOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
                  <div className="bg-black p-4 text-white flex justify-between items-center">
                      <h3 className="font-bold flex items-center gap-2"><RefreshCcw size={18} /> Novo Status</h3>
                      <button onClick={() => setIsStatusModalOpen(false)} className="hover:bg-gray-700 p-1 rounded"><X size={18}/></button>
                  </div>
                  <div className="p-6">
                      <p className="text-sm text-gray-600 mb-4">Selecione o novo status para os <strong>{selectedIds.length}</strong> itens selecionados:</p>
                      <div className="grid grid-cols-1 gap-2">
                          {statusOptions.map(status => (
                              <button 
                                key={status}
                                onClick={() => handleBulkStatusChange(status)}
                                disabled={bulkProcessing}
                                className="w-full py-2 px-4 rounded border border-gray-200 hover:bg-black hover:text-white transition-colors font-medium text-sm text-left flex items-center justify-between group"
                              >
                                  {status}
                                  <span className="opacity-0 group-hover:opacity-100"><Check size={16}/></span>
                              </button>
                          ))}
                      </div>
                      {bulkProcessing && <p className="text-center text-xs text-gray-500 mt-4 animate-pulse">Atualizando...</p>}
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};

export default AssetList;
