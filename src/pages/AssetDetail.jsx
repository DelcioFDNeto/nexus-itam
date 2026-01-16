// src/pages/AssetDetail.jsx
import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../services/firebase';
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
  
  const [asset, setAsset] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [notes, setNotes] = useState(''); 
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [isMaintModalOpen, setIsMaintModalOpen] = useState(false);
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkName, setNewLinkName] = useState('');
  const [isAddingLink, setIsAddingLink] = useState(false);

  // --- CONFIGURAÇÕES DO SISTEMA ---
  const [config, setConfig] = useState({
    companyName: 'Shineray By Sabel',
    itManager: 'Délcio Farias',
    termTitle: 'Termo de Responsabilidade'
  });

  useEffect(() => {
    const loadConfig = async () => {
        try {
            const settingsRef = doc(db, 'settings', 'general');
            const snap = await getDoc(settingsRef);
            if (snap.exists()) setConfig(prev => ({ ...prev, ...snap.data() }));
        } catch (error) { console.error(error); }
    };
    loadConfig();
  }, []);

  // --- CONFIGURAÇÃO DE IMPRESSÃO ---
  const termRef = useRef(null);
  const labelRef = useRef(null);

  const handlePrintTerm = useReactToPrint({ contentRef: termRef, documentTitle: `Termo_${id}` });
  const handlePrintLabel = useReactToPrint({ contentRef: labelRef, documentTitle: `Etiqueta_${id}` });

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
    }, (error) => { setLoading(false); });
    return () => unsubscribe();
  }, [id, navigate]);

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
      
{/* MODELO DA ETIQUETA (DEFINITIVA - LOGO GRANDE) */}
        <div style={{ display: 'none' }}>
            <div ref={labelRef} style={{ width: '100%', height: '100vh', position: 'relative' }}>
                <style>{`
                    @media print {
                        @page { size: auto; margin: 0mm; }
                        body { margin: 0; }
                    }
                `}</style>
                <div className="print-label" style={{ 
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '7cm', 
                    height: '3.5cm', 
                    padding: '4px', 
                    border: '2px solid black', 
                    borderRadius: '6px', 
                    display: 'flex', 
                    flexDirection: 'row', 
                    alignItems: 'center', 
                    backgroundColor: 'white', 
                    gap: '6px', 
                    fontFamily: 'Arial, sans-serif', 
                    boxSizing: 'border-box',
                    overflow: 'hidden'
                }}>
                    {/* ESQUERDA: QR CODE */}
                    <div style={{ width: '68px', height: '68px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <QRCodeSVG value={asset.internalId} size={68} level="M" />
                    </div>

                    {/* DIREITA: INFO */}
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flexGrow: 1, justifyContent: 'space-between', overflow: 'hidden' }}>
                        
                        {/* 1. LOGO DESTAQUE */}
                        <div style={{ height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', borderBottom: '1px solid #eee', paddingBottom: '2px' }}>
                            <img 
                                src={logoShineray} 
                                alt="Shineray" 
                                style={{ height: '100%', maxHeight: '28px', width: 'auto', objectFit: 'contain' }} 
                            />
                        </div>

                        {/* 2. DADOS PRINCIPAIS */}
                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                            <span style={{ fontSize: '7px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase', lineHeight: '1' }}>Patrimônio</span>
                            <span style={{ fontSize: '18px', fontWeight: '900', color: 'black', fontFamily: 'monospace', lineHeight: '1.1', letterSpacing: '-0.5px' }}>
                                {asset.internalId}
                            </span>
                            <span style={{ fontSize: '8px', fontWeight: 'bold', color: '#333', textTransform: 'uppercase', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '125px' }}>
                                {asset.model}
                            </span>
                        </div>

                        {/* 3. RODAPÉ SUPORTE */}
                        <div style={{ borderTop: '1.5px solid #000', paddingTop: '1px', marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '6px', fontWeight: 'bold', color: '#444', textTransform: 'uppercase' }}>SUPORTE TI</span>
                            <span style={{ fontSize: '8px', fontWeight: '900', color: '#000' }}>shiadmti@gmail.com</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        {/* --- ÁREA DE IMPRESSÃO (OCULTA NA TELA, VISÍVEL NA IMPRESSORA) --- */}
      <div style={{ display: 'none' }}>
        
        {/* 1. TERMO DE RESPONSABILIDADE */}
        <div ref={termRef}>
            <style>{`
                @media print {
                    @page { size: A4; margin: 15mm; }
                    body { font-family: 'Times New Roman', Times, serif; color: #000; line-height: 1.4; }
                    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
                    .title { text-align: center; font-weight: bold; font-size: 16px; text-transform: uppercase; margin: 20px 0; text-decoration: underline; }
                    .content { font-size: 12px; text-align: justify; }
                    .box { border: 1px solid #000; padding: 10px; margin: 15px 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px; }
                    .label { font-weight: bold; text-transform: uppercase; font-size: 9px; color: #333; display: block; }
                    .value { font-weight: bold; font-size: 12px; }
                    .clause { margin-bottom: 10px; }
                    .signatures { display: flex; justify-content: space-between; margin-top: 60px; text-align: center; }
                    .sign-line { border-top: 1px solid #000; width: 220px; margin: 5px auto; }
                    .footer-text { font-size: 10px; font-style: italic; text-align: center; margin-top: 30px; }
                }
            `}</style>
            
            <div className="header">
                <img src={logoShineray} alt="Shineray" style={{ height: '45px', objectFit: 'contain' }} />
                <div style={{ textAlign: 'right' }}>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: 'bold' }}>{config.companyName}</p>
                    <p style={{ margin: 0, fontSize: '10px' }}>Departamento de Tecnologia da Informação</p>
                    <p style={{ margin: 0, fontSize: '10px' }}>Controle de Ativos: {new Date().getFullYear()}/{id.slice(0,4)}</p>
                </div>
            </div>

            <div className="title">{config.termTitle}</div>

            <div className="content">
                <p>
                    Pelo presente instrumento, a empresa <strong>{config.companyName.toUpperCase()}</strong>, cede ao colaborador(a) identificado(a) abaixo, a título de empréstimo para uso exclusivo profissional, o equipamento descrito a seguir:
                </p>

                <div className="box">
                    <div><span className="label">Colaborador / Responsável</span><span className="value">{responsibleName}</span></div>
                    <div><span className="label">Departamento / Local</span><span className="value">{asset.location}</span></div>
                    
                    <div style={{ gridColumn: 'span 2', borderTop: '1px dashed #ccc', margin: '5px 0' }}></div>

                    <div><span className="label">Tipo de Equipamento</span><span className="value">{asset.type}</span></div>
                    <div><span className="label">Marca / Modelo</span><span className="value">{asset.model}</span></div>
                    <div><span className="label">Patrimônio (ID)</span><span className="value">{asset.internalId}</span></div>
                    <div><span className="label">Nº de Série / Service Tag</span><span className="value">{asset.serialNumber || 'N/A'}</span></div>
                    
                    {asset.imei1 && (
                         <div style={{ gridColumn: 'span 2' }}>
                            <span className="label">Identificação Móvel (IMEI)</span>
                            <span className="value">IMEI 1: {asset.imei1} {asset.imei2 ? `| IMEI 2: ${asset.imei2}` : ''}</span>
                         </div>
                    )}
                    
                    {(asset.notes || asset.specs) && (
                        <div style={{ gridColumn: 'span 2' }}>
                            <span className="label">Observações / Acessórios Inclusos</span>
                            <span className="value" style={{ fontWeight: 'normal' }}>{asset.notes || "Equipamento entregue formatado e com acessórios padrão (carregador/mouse)."}</span>
                        </div>
                    )}
                </div>

                <p style={{ fontWeight: 'bold', marginBottom: '5px' }}>CLÁUSULAS E CONDIÇÕES DE USO:</p>
                
                <ol style={{ paddingLeft: '15px' }}>
                    <li className="clause"><strong>Responsabilidade:</strong> O(A) colaborador(a) declara receber o equipamento em perfeito estado de funcionamento e assume total responsabilidade pela sua guarda e conservação.</li>
                    <li className="clause"><strong>Uso Profissional:</strong> O equipamento destina-se estritamente às atividades profissionais da empresa, sendo vedada a instalação de softwares não autorizados ou uso para fins pessoais que violem a política de segurança da informação.</li>
                    <li className="clause"><strong>Danos e Extravio:</strong> Em caso de dano, roubo, furto ou extravio por negligência, imprudência ou imperícia, a empresa poderá realizar o desconto do valor correspondente ao reparo ou reposição, conforme previsto no Art. 462, §1º da CLT.</li>
                    <li className="clause"><strong>Segurança:</strong> O usuário compromete-se a não compartilhar senhas de acesso e a reportar imediatamente ao departamento de TI qualquer incidente de segurança ou mau funcionamento.</li>
                    <li className="clause"><strong>Devolução:</strong> O equipamento deverá ser devolvido imediatamente quando solicitado pela empresa ou no ato de desligamento do colaborador, nas mesmas condições em que foi recebido, ressalvado o desgaste natural pelo uso.</li>
                </ol>

                <p style={{ marginTop: '20px' }}>
                    E por estar de acordo com os termos acima descritos, assino o presente em duas vias de igual teor.
                </p>

                <p style={{ textAlign: 'right', marginTop: '30px' }}>
                    Belém (PA), {new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}.
                </p>

                <div className="signatures">
                    <div>
                        {/* Se quiser usar assinatura digital do gestor: */}
                        <div style={{ height: '30px', fontFamily: "'Brush Script MT', cursive", fontSize: '20px', color: '#003366' }}>{config.itManager}</div> 
                        <div className="sign-line"></div>
                        <strong>{config.companyName}</strong><br/>
                        Gestão de Ativos de TI
                    </div>
                    <div>
                        <div style={{ height: '30px' }}></div>
                        <div className="sign-line"></div>
                        <strong>{responsibleName}</strong><br/>
                        Colaborador / Portador
                    </div>
                </div>

                <div className="footer-text">
                    Documento gerado eletronicamente pelo sistema Shineray ITAM.
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
                        {showImei && (<><div><span className="block text-[10px] font-bold text-gray-400 uppercase">IMEI 1</span><span className="font-mono font-bold text-gray-900 text-sm">{asset.imei1 || "---"}</span></div>{asset.imei2 && (<div><span className="block text-[10px] font-bold text-gray-400 uppercase">IMEI 2</span><span className="font-mono font-bold text-gray-900 text-sm">{asset.imei2}</span></div>)}</>)}
                        {showIp && (<div><span className="block text-[10px] font-bold text-gray-400 uppercase">IP Address</span><span className="font-mono font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded text-sm w-fit">{asset.specs?.ip}</span></div>)}
                        {showPrinterInfo && (<div className="col-span-2 bg-blue-50 p-3 rounded-lg border border-blue-100"><span className="block text-[10px] font-bold text-blue-600 uppercase flex items-center gap-1"><FileText size={12}/> Páginas Impressas</span><span className="font-mono font-black text-2xl text-blue-900">{asset.specs?.pageCount ? Number(asset.specs.pageCount).toLocaleString('pt-BR') : '0'}</span></div>)}
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