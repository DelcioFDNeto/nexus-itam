// src/pages/AssetDetail.jsx
import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../services/firebase';
// Adicionado 'getDoc' para buscar as configurações
import { doc, onSnapshot, collection, query, where, orderBy, getDocs, getDoc } from 'firebase/firestore';
import { moveAsset, registerMaintenance, updateAsset, deleteAsset } from '../services/assetService'; 
import MoveAssetModal from '../components/MoveAssetModal';
import MaintenanceModal from '../components/MaintenanceModal';
import { QRCodeSVG } from 'qrcode.react'; 
import { 
  ArrowLeft, Edit, MapPin, User, Tag, Smartphone, Monitor, History, Network, 
  Building2, ArrowRightLeft, QrCode, Wrench, StickyNote, Save, 
  Gift, PackageCheck, CreditCard, BadgeCheck, AlertTriangle, 
  CheckCircle, Trash2, Link as LinkIcon, ExternalLink, Plus, Printer, FileText
} from 'lucide-react';
import AssetTimeline from '../components/AssetTimeline';
import { useReactToPrint } from 'react-to-print';
import logoShineray from '../assets/logo-shineray.png'; 

const AssetDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  
  // --- ESTADOS ---
  const [asset, setAsset] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [notes, setNotes] = useState(''); 
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  
  // Modais
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [isMaintModalOpen, setIsMaintModalOpen] = useState(false);
  
  // Links
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkName, setNewLinkName] = useState('');
  const [isAddingLink, setIsAddingLink] = useState(false);

  // --- CONFIGURAÇÕES DO SISTEMA (Para Impressão) ---
  const [config, setConfig] = useState({
    companyName: 'Shineray By Sabel',
    itManager: 'Délcio Farias',
    termTitle: 'Termo de Responsabilidade'
  });

  // Carregar Configurações ao Iniciar
  useEffect(() => {
    const loadConfig = async () => {
        try {
            const settingsRef = doc(db, 'settings', 'general');
            const snap = await getDoc(settingsRef);
            if (snap.exists()) {
                setConfig(prev => ({ ...prev, ...snap.data() }));
            }
        } catch (error) {
            console.error("Erro ao carregar configurações de impressão:", error);
        }
    };
    loadConfig();
  }, []);

  // --- CONFIGURAÇÃO DE IMPRESSÃO ---
  const termRef = useRef(null);
  const labelRef = useRef(null);

  const handlePrintTerm = useReactToPrint({ 
      contentRef: termRef, 
      documentTitle: `Termo_${id}` 
  });
  
  const handlePrintLabel = useReactToPrint({ 
      contentRef: labelRef, 
      documentTitle: `Etiqueta_${id}` 
  });

  // --- DATA FETCHING ---
  const fetchHistory = async () => {
    try {
        const q = query(collection(db, 'history'), where('assetId', '==', id), orderBy('date', 'desc'));
        const snapshot = await getDocs(q);
        setHistory(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    setLoading(true);
    const assetRef = doc(db, 'assets', id);
    const unsubscribe = onSnapshot(assetRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = { id: docSnap.id, ...docSnap.data() };
            setAsset(data);
            if (loading) setNotes(data.notes || '');
            fetchHistory();
        } else { navigate('/assets'); }
        setLoading(false);
    }, (error) => {
        console.error("Erro no realtime:", error);
        setLoading(false);
    });
    return () => unsubscribe();
  }, [id, navigate]);

  // --- HANDLERS ---
  const handleAddLink = async () => {
      if (!newLinkUrl || !newLinkName) return alert("Preencha o nome e o link!");
      setIsAddingLink(true);
      try {
          const currentLinks = asset.attachments || [];
          const newLink = { name: newLinkName, url: newLinkUrl, type: 'link', addedAt: new Date() };
          await updateAsset(id, { attachments: [...currentLinks, newLink] });
          setNewLinkUrl(''); setNewLinkName('');
      } catch (error) { alert("Erro ao salvar link."); } finally { setIsAddingLink(false); }
  };

  const handleDeleteLink = async (linkToDelete) => {
      if(!confirm("Remover este link?")) return;
      try {
          const currentLinks = asset.attachments || [];
          const newLinks = currentLinks.filter(l => l.url !== linkToDelete.url);
          await updateAsset(id, { attachments: newLinks });
      } catch (error) { alert("Erro ao remover."); }
  };

  const handleDelete = async () => {
      if (window.confirm("TEM CERTEZA que deseja excluir este ativo?")) {
          setIsDeleting(true);
          try { await deleteAsset(id); alert("Excluído."); navigate('/assets'); } 
          catch (error) { alert("Erro."); setIsDeleting(false); }
      }
  };

  if (loading) return <div className="flex h-screen items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-4 border-shineray"></div></div>;
  if (!asset) return null;

  const responsibleName = asset.assignedTo || asset.clientName || "Não atribuído";
  const derivedSector = asset.sector || "Adm/Op.";
  const isPromotional = asset.category === 'Promocional' || asset.internalId?.toUpperCase().includes('PRM');
  
  // --- LÓGICA DE EXIBIÇÃO DE CAMPOS ---
  const showImei = asset.type === 'Celular' || asset.type === 'PGT';
  const showPrinterInfo = asset.type === 'Impressora';
  const showIp = (asset.type === 'Computador' || asset.type === 'Notebook' || asset.type === 'Rede' || showPrinterInfo) && asset.specs?.ip;

  const getLifecycleStatus = () => {
      if (!asset.purchaseDate || asset.purchaseDate.length < 10) return null;
      const purchase = new Date(asset.purchaseDate);
      const today = new Date();
      const expiration = new Date(purchase);
      expiration.setFullYear(purchase.getFullYear() + 1);
      const isWarrantyExpired = today > expiration;
      
      if (isWarrantyExpired) return { status: 'warning', title: 'Monitorar (Garantia Vencida)', desc: 'Garantia expirada.', color: 'bg-orange-50 border-orange-100 text-orange-800', icon: <AlertTriangle className="text-orange-500" size={20} /> };
      return { status: 'healthy', title: 'Ativo Saudável', desc: `Garantia até ${expiration.toLocaleDateString('pt-BR')}.`, color: 'bg-green-50 border-green-100 text-green-800', icon: <CheckCircle className="text-green-600" size={20} /> };
  };
  
  const lifecycle = !isPromotional ? getLifecycleStatus() : null;

  const handleQuickStatus = async (newStatus) => { if (confirm(`Mudar status para "${newStatus}"?`)) { await updateAsset(id, { status: newStatus }); } };
  const handleMoveConfirm = async (moveData) => { await moveAsset(id, asset, moveData); };
  const handleMaintenanceConfirm = async (maintData) => { await registerMaintenance(id, maintData); };
  const handleSaveNotes = async () => { setIsSavingNotes(true); await updateAsset(id, { notes: notes }); setIsSavingNotes(false); alert("Salvo!"); };
  
  const expandLocation = (loc) => loc || "Local não definido";
  const formatDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : "N/A";
  const getBannerColor = () => { const s = asset.status.toLowerCase(); if (s === 'entregue') return 'bg-purple-600'; if (s.includes('transfer')) return 'bg-yellow-500'; if (s === 'manutenção') return 'bg-orange-600'; if (s === 'disponível') return 'bg-blue-600'; return 'bg-black'; };
  const TypeIcon = () => { switch(asset.type) { case 'Celular': return <Smartphone size={36} />; case 'PGT': return <CreditCard size={36} />; case 'Impressora': return <Printer size={36} />; default: return <Monitor size={36} />; } };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto pb-24">
      
      {/* --- ÁREA OCULTA DE IMPRESSÃO --- */}
      <div style={{ display: 'none' }}>
        
        {/* MODELO DO TERMO (Dinâmico com Configurações) */}
        <div ref={termRef} className="print-term p-10 max-w-4xl mx-auto text-black bg-white font-sans relative">
            <div className="absolute top-8 right-8 flex flex-col items-center">
                <QRCodeSVG value={asset.internalId} size={70} level="H" />
                <span className="text-[10px] font-mono font-bold mt-1">{asset.internalId}</span>
            </div>
            <div className="flex items-center justify-between border-b-2 border-black pb-4 mb-6 pr-24">
                <img src={logoShineray} alt="Shineray" className="h-12 object-contain" />
                <div className="text-right">
                    <p className="text-xs font-bold text-gray-800 uppercase tracking-widest">TI & Infraestrutura</p>
                    <p className="text-[10px] text-gray-500 uppercase">Documento Oficial</p>
                </div>
            </div>
            
            <h2 className="text-lg font-black text-center mb-8 uppercase decoration-2 underline underline-offset-4 decoration-red-600">
                {config.termTitle}
            </h2>
            
            <div className="text-justify space-y-4 text-xs leading-relaxed text-gray-800">
                <p>Eu, <strong className="uppercase text-sm">{responsibleName || "_______________________"}</strong>, declaro ter recebido da <strong>{config.companyName.toUpperCase()}</strong> o equipamento descrito abaixo, em perfeito estado de funcionamento e conservação:</p>
                
                <div className="my-6 border border-gray-800 p-4 bg-gray-50">
                    <div className="grid grid-cols-2 gap-4">
                        <div><span className="block text-[9px] font-bold text-gray-500 uppercase">Tipo/Modelo</span><span className="font-bold text-sm">{asset.type} - {asset.model}</span></div>
                        <div><span className="block text-[9px] font-bold text-gray-500 uppercase">Patrimônio</span><span className="font-bold text-sm bg-yellow-100 px-1">{asset.internalId}</span></div>
                        
                        {asset.imei1 ? (
                            <div className="col-span-2"><span className="block text-[9px] font-bold text-gray-500 uppercase">IMEI / Serial</span><span className="font-mono text-sm">{asset.imei1} {asset.serialNumber ? `/ ${asset.serialNumber}` : ''}</span></div>
                        ) : (
                            <div className="col-span-2"><span className="block text-[9px] font-bold text-gray-500 uppercase">Serial</span><span className="font-mono text-sm">{asset.serialNumber || "N/A"}</span></div>
                        )}
                        
                        {(asset.notes || asset.specs) && (
                            <div className="col-span-2 pt-2 border-t border-gray-200 mt-2">
                                <span className="block text-[9px] font-bold text-gray-500 uppercase">Observações / Acessórios</span>
                                <span className="text-xs">{asset.notes || "Carregador original incluso."}</span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="space-y-2 border-l-4 border-gray-300 pl-4">
                    <p><strong>1. RESPONSABILIDADE:</strong> Comprometo-me a zelar pela guarda e conservação do equipamento, comunicando imediatamente ao departamento de TI qualquer defeito ou irregularidade.</p>
                    <p><strong>2. USO:</strong> O equipamento destina-se exclusivamente ao desempenho das atividades profissionais.</p>
                    <p><strong>3. DEVOLUÇÃO:</strong> Comprometo-me a devolver o equipamento nas mesmas condições em que o recebi (salvo desgaste natural) em caso de rescisão contratual, férias, licença ou quando solicitado.</p>
                </div>
            </div>

            <div className="mt-16 space-y-10">
                <p className="text-right italic text-xs">Belém (PA), {new Date().toLocaleDateString('pt-BR')}.</p>
                <div className="grid grid-cols-2 gap-12 items-end">
                    <div className="text-center relative">
                        <div className="absolute -top-8 left-0 right-0 flex justify-center">
                            <span style={{ fontFamily: "'Brush Script MT', cursive" }} className="text-3xl text-blue-900 rotate-[-5deg] opacity-90">
                                {config.itManager}
                            </span>
                        </div>
                        <div className="border-t border-black w-full mb-1"></div>
                        <p className="font-bold uppercase text-[10px]">{config.companyName}</p>
                        <p className="text-[9px] text-gray-500">Departamento de TI</p>
                    </div>
                    <div className="text-center">
                        <div className="border-t border-black w-full mb-1"></div>
                        <p className="font-bold uppercase text-[10px]">{responsibleName}</p>
                        <p className="text-[9px] text-gray-500">Colaborador / Portador</p>
                    </div>
                </div>
            </div>
        </div>

        {/* MODELO DA ETIQUETA */}
        <div ref={labelRef} className="print-label" style={{ width: '10cm', height: '5cm', padding: '10px', border: '2px solid black', borderRadius: '8px', display: 'flex', flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', gap: '15px', fontFamily: 'Arial, sans-serif', boxSizing: 'border-box' }}>
            <div style={{ width: '110px', height: '110px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <QRCodeSVG value={asset.internalId} size={110} level="M" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flexGrow: 1, justifyContent: 'space-between' }}>
                <div style={{ height: '50px', display: 'flex', alignItems: 'center' }}>
                    <img src={logoShineray} alt="Shineray" style={{ height: '100%', maxHeight: '45px', width: 'auto', objectFit: 'contain', display: 'block' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '10px', textTransform: 'uppercase', color: '#666', fontWeight: 'bold' }}>Patrimônio</span>
                    <span style={{ fontSize: '28px', fontWeight: '900', color: 'black', fontFamily: 'monospace', lineHeight: '1', letterSpacing: '-1px' }}>{asset.internalId}</span>
                    <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#333', textTransform: 'uppercase', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }}>{asset.model}</span>
                </div>
                <div style={{ borderTop: '2px solid #000', paddingTop: '4px', marginTop: 'auto' }}>
                    <p style={{ margin: 0, fontSize: '10px', fontWeight: 'bold', color: '#000' }}>Suporte TI:</p>
                    <p style={{ margin: 0, fontSize: '12px', fontWeight: '900', color: '#000' }}>shiadmti@gmail.com</p>
                </div>
            </div>
        </div>

      </div>

      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <button onClick={() => navigate('/assets')} className="flex items-center gap-2 text-gray-500 hover:text-shineray font-bold uppercase tracking-wide text-sm self-start md:self-auto"><ArrowLeft size={18} /> Voltar</button>
        <div className="flex flex-wrap gap-3 w-full md:w-auto justify-end">
            {isPromotional ? (
                <>
                    <button onClick={() => handleQuickStatus('Disponível')} className="flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg font-bold text-xs uppercase"><PackageCheck size={16} /> Estoque</button>
                    <button onClick={() => setIsMoveModalOpen(true)} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><ArrowRightLeft size={18} /></button>
                </>
            ) : (
                <>
                    <button onClick={() => setIsMaintModalOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white hover:bg-orange-600 rounded-lg shadow-md font-bold uppercase text-sm border border-orange-600"><Wrench size={16} /> Manutenção</button>
                    <button onClick={() => setIsMoveModalOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg shadow-md font-bold uppercase text-sm"><ArrowRightLeft size={16} /> Transferir</button>
                </>
            )}
            <button onClick={handlePrintLabel} className="p-2 text-gray-700 hover:bg-gray-100 rounded-lg border border-gray-300" title="Imprimir Etiqueta"><QrCode size={18} /></button>
            <button onClick={handlePrintTerm} className="p-2 text-gray-700 hover:bg-gray-100 rounded-lg border border-gray-300" title="Imprimir Termo"><Printer size={18} /></button>
            <button onClick={() => navigate(`/assets/edit/${asset.id}`)} className="p-2 text-shineray bg-red-50 hover:bg-red-100 rounded-lg border border-red-100"><Edit size={18} /></button>
            <button onClick={handleDelete} disabled={isDeleting} className="p-2 text-red-500 hover:bg-red-50 rounded-lg border border-red-200 ml-2"><Trash2 size={18} /></button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className={`p-8 border-b border-gray-800 flex flex-col md:flex-row justify-between md:items-center gap-6 ${getBannerColor()}`}>
            <div className="flex items-center gap-5">
                <div className="p-4 rounded-2xl bg-white text-black shadow-lg">
                    {asset.status === 'Entregue' ? <Gift size={36} className="text-purple-600"/> : asset.status === 'Manutenção' ? <Wrench size={36} className="text-orange-600"/> : <TypeIcon />}
                </div>
                <div>
                    <h1 className="text-3xl font-black text-white uppercase tracking-tight italic">{asset.model}</h1>
                    <p className="text-gray-200 font-mono text-sm mt-1 flex items-center gap-2"><Tag size={14} /> {asset.internalId}</p>
                </div>
            </div>
            <div className="px-6 py-2 rounded-lg font-black uppercase tracking-wider text-sm bg-white text-black">{asset.status}</div>
        </div>

        <div className="p-8 grid grid-cols-1 lg:grid-cols-3 gap-10">
             <div className="lg:col-span-2 space-y-8">
                {lifecycle && (
                    <div className={`p-4 rounded-xl border flex items-center gap-4 ${lifecycle.color}`}>
                        <div className="p-2 bg-white rounded-full shadow-sm">{lifecycle.icon}</div>
                        <div><h4 className="font-bold uppercase text-xs tracking-wider">{lifecycle.title}</h4><p className="text-sm font-medium opacity-90">{lifecycle.desc}</p></div>
                    </div>
                )}

                <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 relative">
                    <h3 className="font-bold text-gray-400 uppercase tracking-widest text-xs mb-6 flex items-center gap-2 border-b border-gray-200 pb-2"><Building2 size={16} /> Administração & Posse</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-8">
                        <div><p className="text-[10px] text-gray-400 font-bold uppercase mb-1">Filial / Unidade</p><div className="flex items-start gap-2 text-gray-900 font-bold text-sm"><MapPin size={16} className="text-shineray mt-0.5" />{expandLocation(asset.location)}</div></div>
                        <div><p className="text-[10px] text-gray-400 font-bold uppercase mb-1">Setor / Campanha</p><div className="flex items-center gap-2 text-gray-900 font-bold text-sm"><Building2 size={16} className="text-gray-400" />{derivedSector}</div></div>
                        <div className="md:col-span-2 bg-white p-4 rounded-xl border border-gray-200 shadow-sm"><p className="text-[10px] text-gray-400 font-bold uppercase mb-2">{isPromotional ? "Cliente / Beneficiário" : "Responsável pelo Ativo"}</p><div className="flex items-center gap-4"><div className="bg-gray-100 p-3 rounded-full"><User size={24} className="text-gray-700" /></div><div><p className="text-xl font-black text-gray-900 leading-tight">{responsibleName}</p>{asset.clientCpf && (<p className="text-xs text-gray-400 font-mono mt-1">CPF: {asset.clientCpf}</p>)}</div></div>{isPromotional && (<div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-3"><div className="p-1.5 bg-pink-100 rounded-full text-pink-600"><BadgeCheck size={16} /></div><div><p className="text-[10px] text-pink-700 font-bold uppercase">Vendedor Responsável</p><p className="text-sm font-bold text-gray-900">{asset.vendedor || "Não informado"}</p></div></div>)}</div>
                    </div>
                </div>

                <div className="bg-white border border-gray-200 p-5 rounded-xl space-y-4">
                    <h3 className="font-bold text-gray-900 border-b border-gray-100 pb-2 flex items-center gap-2 uppercase tracking-wider text-sm"><LinkIcon size={18} className="text-shineray" /> Documentos & Links</h3>
                    <div className="space-y-2">
                        {asset.attachments?.map((link, index) => (
                            <div key={index} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border border-gray-100 hover:bg-gray-100 transition-colors group">
                                <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 overflow-hidden"><div className="p-2 bg-white rounded shadow-sm text-blue-600"><ExternalLink size={16}/></div><div className="truncate"><p className="text-xs font-bold text-gray-700 truncate max-w-[200px]">{link.name}</p><p className="text-[9px] text-gray-400">{new Date(link.addedAt?.seconds ? link.addedAt.seconds * 1000 : link.addedAt).toLocaleDateString()}</p></div></a>
                                <button onClick={() => handleDeleteLink(link)} className="text-gray-300 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button>
                            </div>
                        ))}
                    </div>
                    <div className="flex gap-2 items-end"><div className="flex-1"><label className="text-[10px] font-bold text-gray-400 uppercase">Nome</label><input value={newLinkName} onChange={(e) => setNewLinkName(e.target.value)} className="w-full p-2 border border-gray-200 rounded text-sm outline-none focus:border-black"/></div><div className="flex-[2]"><label className="text-[10px] font-bold text-gray-400 uppercase">Link</label><input value={newLinkUrl} onChange={(e) => setNewLinkUrl(e.target.value)} className="w-full p-2 border border-gray-200 rounded text-sm outline-none focus:border-black"/></div><button onClick={handleAddLink} disabled={isAddingLink} className="p-2 bg-black text-white rounded hover:bg-gray-800 disabled:opacity-50"><Plus size={20}/></button></div>
                </div>

                {!isPromotional && (
                    <div className="bg-yellow-50 border border-yellow-200 p-5 rounded-xl space-y-3">
                        <h3 className="font-bold text-yellow-700 uppercase tracking-widest text-xs mb-2 flex items-center gap-2"><StickyNote size={16} /> Notas Técnicas</h3>
                        <textarea className="w-full h-32 p-3 text-sm bg-white border border-yellow-300 rounded-lg focus:ring-2 focus:ring-yellow-500 outline-none text-gray-800" value={notes} onChange={(e) => setNotes(e.target.value)}></textarea>
                        <div className="flex justify-end"><button onClick={handleSaveNotes} disabled={isSavingNotes} className="flex items-center gap-2 px-4 py-2 bg-yellow-600 text-white font-bold rounded-lg hover:bg-yellow-700 text-xs uppercase">{isSavingNotes ? "Salvando..." : <><Save size={14} /> Salvar</>}</button></div>
                    </div>
                )}

                <div className="bg-white border border-gray-200 p-5 rounded-xl space-y-3">
                     <h3 className="font-bold text-gray-400 uppercase tracking-widest text-xs mb-4">Especificações</h3>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {isPromotional && (<div className="col-span-2 bg-purple-50 p-2 rounded border border-purple-100"><span className="block text-[10px] font-bold text-purple-700 uppercase">Item Promocional</span></div>)}
                        
                        <div><span className="block text-[10px] font-bold text-gray-400 uppercase">Serial Number</span><span className="font-mono font-bold text-gray-900 text-sm">{asset.serialNumber || "---"}</span></div>
                        
                        {/* CONDICIONAL: IMEI */}
                        {showImei && (
                            <>
                                <div><span className="block text-[10px] font-bold text-gray-400 uppercase">IMEI 1</span><span className="font-mono font-bold text-gray-900 text-sm">{asset.imei1 || "---"}</span></div>
                                {asset.imei2 && (<div><span className="block text-[10px] font-bold text-gray-400 uppercase">IMEI 2</span><span className="font-mono font-bold text-gray-900 text-sm">{asset.imei2}</span></div>)}
                            </>
                        )}

                        {/* CONDICIONAL: PÁGINAS IMPRESSAS */}
                        {showPrinterInfo && (
                            <div className="col-span-2 bg-blue-50 p-3 rounded-lg border border-blue-100">
                                <span className="block text-[10px] font-bold text-blue-600 uppercase flex items-center gap-1"><FileText size={12}/> Páginas Impressas</span>
                                <span className="font-mono font-black text-2xl text-blue-900">{asset.specs?.pageCount ? Number(asset.specs.pageCount).toLocaleString('pt-BR') : '0'}</span>
                            </div>
                        )}

                        {/* CONDICIONAL: IP */}
                        {showIp && (
                            <div><span className="block text-[10px] font-bold text-gray-400 uppercase">IP Address</span><span className="font-mono font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded text-sm w-fit">{asset.specs?.ip}</span></div>
                        )}

                        <div><span className="block text-[10px] font-bold text-gray-400 uppercase">Data Aquisição</span><span className="font-bold text-gray-900 text-sm">{formatDate(asset.purchaseDate)}</span></div>
                     </div>
                </div>
             </div>

             <div className="border-l border-gray-100 pl-0 lg:pl-8">
                <h3 className="font-bold text-gray-900 border-b border-gray-100 pb-2 flex items-center gap-2 uppercase tracking-wider text-sm mb-6"><History size={18} className="text-shineray" /> Linha do Tempo</h3>
                <div className="max-h-[500px] overflow-y-auto custom-scrollbar pr-2"><AssetTimeline history={history} /></div>
             </div>
        </div>
        
        <div className="p-6 bg-gray-50 border-t border-gray-200 flex flex-col items-center justify-center gap-2">
            <div className="bg-white p-2 rounded-lg border border-gray-200 shadow-sm"><QRCodeSVG value={asset.internalId} size={100} /></div>
            <p className="text-xs font-mono text-gray-500 font-bold tracking-widest">{asset.internalId}</p>
        </div>
      </div>

      <MoveAssetModal isOpen={isMoveModalOpen} onClose={() => setIsMoveModalOpen(false)} asset={asset} onConfirm={handleMoveConfirm} />
      <MaintenanceModal isOpen={isMaintModalOpen} onClose={() => setIsMaintModalOpen(false)} asset={asset} onConfirm={handleMaintenanceConfirm} />
    </div>
  );
};

export default AssetDetail;