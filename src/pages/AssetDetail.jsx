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
  ArrowLeft, MapPin, User, Tag, Monitor, History, 
  Building2, ArrowRightLeft, Wrench, StickyNote, Save, 
  Plus, Printer, FileText, Trash2, Link as LinkIcon, X, Edit3, Plug, Clock, Copy
} from 'lucide-react';
import { useReactToPrint } from 'react-to-print';
import AssetIcon from '../components/AssetIcon'; 

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
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [isMaintModalOpen, setIsMaintModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('details'); // 'details' | 'history' (Mobile)
  
  // Links
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkName, setNewLinkName] = useState('');
  const [isAddingLink, setIsAddingLink] = useState(false);

  // Periféricos
  const [newPeripheral, setNewPeripheral] = useState('');
  const [isAddingPeripheral, setIsAddingPeripheral] = useState(false);
  const [peripheralToPrint, setPeripheralToPrint] = useState(null);

  // --- CONFIGURAÇÕES ---
  const [config, setConfig] = useState({
    companyName: 'Shineray By Sabel',
    cnpj: '00.000.000/0001-00', // Placeholder
    itManager: 'SISTEMA ITAM',
    termTitle: 'TERMO DE ENTREGA E RESPONSABILIDADE'
  });

  useEffect(() => {
    const loadConfig = async () => {
        try {
            const settingsRef = doc(db, 'settings', 'general');
            const snap = await getDoc(settingsRef);
            if (snap.exists()) setConfig(prev => ({ ...prev, ...snap.data(), companyName: 'Shineray By Sabel' }));
        } catch (error) { console.error(error); }
    };
    loadConfig();
  }, []);

  // --- IMPRESSÃO ---
  const termRef = useRef(null);
  const labelRef = useRef(null);
  const peripheralLabelRef = useRef(null);

  const handlePrintTerm = useReactToPrint({ contentRef: termRef, documentTitle: `Termo_${id}` });
  const handlePrintLabel = useReactToPrint({ contentRef: labelRef, documentTitle: `Etiqueta_${id}` });
  const triggerPeripheralPrint = useReactToPrint({ contentRef: peripheralLabelRef, documentTitle: `Acessorio_${id}` });

  useEffect(() => {
    if (peripheralToPrint) {
        triggerPeripheralPrint();
        setTimeout(() => setPeripheralToPrint(null), 1000);
    }
  }, [peripheralToPrint]);

  // --- DATA ---
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

  // --- HANDLERS ---
  
  const handleMoveConfirm = async (moveData) => { 
      await moveAsset(id, asset, moveData); 
  };
  
  const handleMaintenanceConfirm = async (maintData) => { 
      await registerMaintenance(id, maintData); 
  };
  
  const handleSaveNotes = async () => { 
      setIsSavingNotes(true); 
      await updateAsset(id, { notes: notes }, {
          action: 'Nota Técnica',
          details: 'Observações técnicas atualizadas.',
          type: 'update'
      }); 
      setIsSavingNotes(false); 
      alert("Notas salvas!"); 
  };

  const handleAddLink = async () => {
      if (!newLinkUrl || !newLinkName) return alert("Preencha o nome e o link!");
      setIsAddingLink(true);
      try {
          const currentLinks = asset.attachments || [];
          const newLink = { name: newLinkName, url: newLinkUrl, type: 'link', addedAt: new Date() };
          await updateAsset(id, { attachments: [...currentLinks, newLink] }, {
              action: 'Novo Anexo',
              details: `Adicionado link/documento: ${newLinkName}`
          });
          setNewLinkUrl(''); setNewLinkName('');
      } catch (error) { alert("Erro ao salvar link."); } finally { setIsAddingLink(false); }
  };

  const handleDeleteLink = async (linkToDelete) => {
      if(!confirm("Remover este link?")) return;
      try {
          const currentLinks = asset.attachments || [];
          const newLinks = currentLinks.filter(l => l.url !== linkToDelete.url);
          await updateAsset(id, { attachments: newLinks }, {
              action: 'Anexo Removido',
              details: `Removido link/documento: ${linkToDelete.name}`
          });
      } catch (error) { alert("Erro ao remover."); }
  };

  const handleAddPeripheral = async () => {
      if (!newPeripheral) return alert("Digite o nome do periférico (ex: Carregador)");
      setIsAddingPeripheral(true);
      try {
          const currentPeripherals = asset.peripherals || [];
          const newItem = { name: newPeripheral, addedAt: new Date() };
          await updateAsset(id, { peripherals: [...currentPeripherals, newItem] }, {
              action: 'Periférico Vinculado',
              details: `Acessório adicionado: ${newPeripheral}`
          });
          setNewPeripheral('');
      } catch (error) { alert("Erro ao salvar periférico."); } finally { setIsAddingPeripheral(false); }
  };

  const handleDeletePeripheral = async (itemToDelete) => {
      if(!confirm(`Remover ${itemToDelete.name}?`)) return;
      try {
          const currentPeripherals = asset.peripherals || [];
          const newPeripherals = currentPeripherals.filter(p => p.name !== itemToDelete.name);
          await updateAsset(id, { peripherals: newPeripherals }, {
              action: 'Periférico Removido',
              details: `Acessório desvinculado: ${itemToDelete.name}`
          });
      } catch (error) { alert("Erro ao remover."); }
  };

  const handleDelete = async () => {
      if (window.confirm(" TEM CERTEZA? A exclusão é irreversível.")) {
          setIsDeleting(true);
          try { await deleteAsset(id); alert("Excluído."); navigate('/assets'); } 
          catch (error) { alert("Erro."); setIsDeleting(false); }
      }
  };

  // --- RENDER ---
  if (loading) return <div className="flex h-screen items-center justify-center bg-[#F4F4F5]"><div className="animate-spin rounded-full h-12 w-12 border-b-4 border-black"></div></div>;
  if (!asset) return null;

  const responsibleName = asset.assignedTo || asset.clientName || "__________________________";
  const derivedSector = asset.sector || "Adm/Op.";
  const showImei = asset.type === 'Celular' || asset.type === 'PGT';
  const showPrinterInfo = asset.type === 'Impressora';
  const showIp = (asset.type === 'Computador' || asset.type === 'Notebook' || asset.type === 'Rede' || showPrinterInfo) && asset.specs?.ip;
  const expandLocation = (loc) => loc || "Local não definido";
  const formatDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : "N/A";
  const getBannerColor = () => { const s = asset.status.toLowerCase(); if (s === 'entregue') return 'bg-purple-600'; if (s.includes('transfer')) return 'bg-yellow-500'; if (s === 'manutenção') return 'bg-orange-600'; if (s === 'disponível') return 'bg-blue-600'; return 'bg-black'; };

  return (
    <div className="max-w-[1920px] mx-auto pb-24 animate-fade-in relative min-h-screen">
      
      {/* ======================================================================= */}
      {/* ÁREA DE IMPRESSÃO OCULTA                                                 */}
      {/* ======================================================================= */}
      <div style={{ display: 'none' }}>
        
        {/* 1. TERMO JURÍDICO OFICIAL (A4) - REVISADO (CLT/CIVIL) */}
        <div ref={termRef}>
            <style>{`
                @media print {
                    @page { size: A4; margin: 15mm; }
                    body { font-family: 'Times New Roman', Times, serif; color: #000; line-height: 1.5; }
                    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 20px; }
                    .header-left { display: flex; align-items: center; gap: 15px; }
                    .logo-img { height: 45px; object-fit: contain; }
                    .title { text-align: center; font-weight: bold; font-size: 16px; text-transform: uppercase; margin: 20px 0; }
                    .content { font-size: 11px; text-align: justify; margin-bottom: 10px; }
                    .box { border: 1px solid #000; padding: 10px; margin: 15px 0; background-color: #f9f9f9; }
                    .box-title { font-weight: bold; font-size: 12px; margin-bottom: 5px; text-decoration: underline; }
                    .grid-info { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px; }
                    .label { font-weight: bold; text-transform: uppercase; font-size: 9px; color: #333; }
                    .value { font-weight: bold; font-size: 11px; margin-left: 4px; }
                    .clauses { padding-left: 15px; }
                    .clause-item { margin-bottom: 8px; font-size: 11px; }
                    .signatures { display: flex; justify-content: space-between; margin-top: 50px; text-align: center; }
                    .line { border-top: 1px solid #000; width: 220px; margin-bottom: 5px; }
                    .footer { margin-top: 30px; font-size: 9px; text-align: center; border-top: 1px solid #ccc; padding-top: 5px; }
                }
            `}</style>
            <div className="header">
                <div className="header-left">
                    <img src="/logo.png" alt="Shineray" className="logo-img" />
                    <div>
                        <h1 style={{fontSize: '20px', margin: 0, fontWeight: '900'}}>{config.companyName.toUpperCase()}</h1>
                        <p style={{margin:0, fontSize:'10px'}}>Departamento de Tecnologia da Informação</p>
                    </div>
                </div>
                <div style={{textAlign: 'right'}}><p style={{margin:0, fontSize:'10px'}}>Emitido em: {new Date().toLocaleDateString()}</p></div>
            </div>
            
            <h2 className="title">{config.termTitle}</h2>
            
            <p className="content">
                Pelo presente instrumento particular, de um lado a empregadora <strong>{config.companyName}</strong>, e de outro lado o(a) colaborador(a) abaixo qualificado(a), 
                celebram o presente termo de responsabilidade, regido pelas cláusulas e condições seguintes, em conformidade com o Art. 462 da CLT e legislação civil pertinente.
            </p>

            <div className="box">
                <div className="box-title">1. DADOS DO COLABORADOR(A) / RESPONSÁVEL</div>
                <div className="grid-info">
                    <div><span className="label">Nome:</span> <span className="value">{responsibleName.toUpperCase()}</span></div>
                    <div><span className="label">Departamento/Setor:</span> <span className="value">{derivedSector.toUpperCase()}</span></div>
                    {asset.cpf && <div><span className="label">CPF:</span> <span className="value">{asset.cpf}</span></div>}
                    <div><span className="label">Local de Trabalho:</span> <span className="value">{expandLocation(asset.location).toUpperCase()}</span></div>
                </div>
            </div>

            <div className="box">
                <div className="box-title">2. OBJETO (EQUIPAMENTO EM COMODATO)</div>
                <div style={{fontSize: '11px', marginBottom: '8px'}}>A empresa cede ao colaborador, a título de comodato gratuito, para uso EXCLUSIVO no desempenho de suas funções laborais, o(s) seguinte(s) bem(ns):</div>
                <div className="grid-info">
                    <div><span className="label">Equipamento:</span> <span className="value">{asset.model}</span></div>
                    <div><span className="label">Tipo:</span> <span className="value">{asset.type.toUpperCase()}</span></div>
                    <div><span className="label">Patrimônio (ID):</span> <span className="value">{asset.internalId}</span></div>
                    <div><span className="label">Número de Série:</span> <span className="value">{asset.serialNumber || 'N/A'}</span></div>
                    {asset.accessories && <div><span className="label">Acessórios/Periféricos:</span> <span className="value">{Array.isArray(asset.accessories) ? asset.accessories.join(', ') : asset.accessories}</span></div>}
                    {asset.peripherals && asset.peripherals.length > 0 && <div><span className="label">Itens Adicionais:</span> <span className="value">{asset.peripherals.map(p => p.name).join(', ')}</span></div>}
                </div>
            </div>

            <div className="content">
                <p style={{fontWeight: 'bold', marginBottom:'5px'}}>CLÁUSULAS CONTRATUAIS:</p>
                <ol className="clauses">
                    <li className="clause-item"><strong>DO USO E FINALIDADE:</strong> O Colaborador declara ter recebido o equipamento acima descrito em perfeito estado de conservação e funcionamento. Compromete-se a utilizá-lo estrita e exclusivamente para fins profissionais, sendo vedado o uso para fins pessoais, empréstimo a terceiros ou instalação de softwares não autorizados pela TI.</li>
                    
                    <li className="clause-item"><strong>DA GUARDA E CONSERVAÇÃO:</strong> É responsabilidade do Colaborador zelar pela guarda, segurança e conservação do equipamento. O mau uso, negligência, imprudência ou imperícia que resultar em danos ao equipamento sujeitará o Colaborador às sanções disciplinares previstas em lei.</li>
                    
                    <li className="clause-item"><strong>DA RESTITUIÇÃO:</strong> O equipamento deverá ser devolvido imediatamente à Empresa, em perfeito estado (salvo desgaste natural), nas seguintes hipóteses: a) Rescisão do contrato de trabalho; b) Mudança de cargo ou função; c) Solicitação expressa da Empresa a qualquer tempo.</li>
                    
                    <li className="clause-item"><strong>DO EXTRAVIO, DANO OU FURTO (ART. 462, §1º CLT):</strong> Em conformidade com o Art. 462, §1º da CLT e Art. 186 do Código Civil, o Colaborador <strong>AUTORIZA EXPRESSAMENTE</strong> o desconto em sua folha de pagamento ou verbas rescisórias dos valores correspondentes ao reparo ou reposição do equipamento, caso seja comprovado que os danos ou o extravio decorreram de <strong>DOLO</strong> (intenção), <strong>NEGLIGÊNCIA</strong> (falta de cuidado) ou uso em desconformidade com as normas da empresa (mau uso).</li>
                    
                    <li className="clause-item"><strong>DA SEGURANÇA DA INFORMAÇÃO:</strong> O Colaborador está ciente de que o equipamento é monitorado e que não deve armazenar dados pessoais sensíveis, responsabilizando-se pelo sigilo de suas senhas e cumprimento das normas de LGPD da empresa.</li>
                </ol>
            </div>

            <div style={{marginTop: '30px', fontSize: '11px'}}>
                <p>Li, compreendi e aceito integralmente os termos acima descritos.</p>
                <p>_______________________, _____ de _______________________ de _________.</p>
            </div>

            <div className="signatures">
                <div><div className="line"></div><span>{responsibleName}</span><br/><small>COLABORADOR(A)</small></div>
                <div><div className="line"></div><span>{config.itManager}</span><br/><small>GESTOR DE TI</small></div>
            </div>
            
            <div className="footer">
                Documento gerado eletronicamente pelo sistema BySabel ITAM Asset Management. ID: {id}
            </div>
        </div>

        {/* 2. ETIQUETA QR PEQUENA (Térmica) */}
        <div ref={labelRef} style={{ width: '7cm', height: '3.5cm', padding: '4px', border: '2px solid black', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'white', fontFamily: 'Arial, sans-serif', boxSizing: 'border-box', overflow: 'hidden' }}>
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
                    <span style={{ fontSize: '8px', fontWeight: 'bold', color: '#333', textTransform: 'uppercase', marginTop: '2px', whiteSpace: 'nowrap', maxWidth: '125px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{asset.model}</span>
                </div>
                <div style={{ borderTop: '1.5px solid #000', paddingTop: '1px', marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '6px', fontWeight: 'bold', color: '#444' }}>SUPORTE TI</span>
                    <span style={{ fontSize: '8px', fontWeight: '900', color: '#000' }}>shiadmti@gmail.com</span>
                </div>
            </div>
        </div>
        
        {/* 3. ETIQUETA PERIFÉRICO */}
        <div ref={peripheralLabelRef} style={{ width: '5cm', height: '2.5cm', padding: '2px', border: '1px solid black', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '3px', fontFamily: 'Arial, sans-serif', boxSizing: 'border-box', pageBreakInside: 'avoid', overflow: 'hidden' }}>
             <div style={{ width: '45px', height: '45px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><QRCodeSVG value={asset.internalId} size={42} level="M" /></div>
             <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flexGrow: 1, justifyContent: 'space-between' }}>
                <div style={{ height: '22px', borderBottom: '0.5px solid #ccc', marginBottom: '1px', display: 'flex', justifyContent:'center' }}><img src="/logo.png" style={{ height: '100%' }} alt="Logo"/></div>
                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 0.9 }}>
                    <span style={{ fontSize: '10px', fontWeight: '900', fontFamily: 'monospace' }}>{asset.internalId}</span>
                    <span style={{ fontSize: '6px', fontWeight: 'bold', textTransform: 'uppercase', maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{peripheralToPrint?.name || 'Acessório'}</span>
                </div>
                <div style={{ borderTop: '0.5px solid #000', paddingTop: '1px', marginTop: 'auto' }}><p style={{ margin: 0, fontSize: '5px', fontWeight: '900', textAlign: 'right' }}>TI BYSABEL</p></div>
             </div>
        </div>

      </div>

      {/* ======================================================================= */}
      {/* HEADER / NAVIGATION                                                     */}
      {/* ======================================================================= */}
      <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <button onClick={() => navigate('/assets')} className="group flex items-center text-gray-500 hover:text-black transition-colors font-bold text-sm">
              <div className="p-2 rounded-full group-hover:bg-gray-100 transition-all mr-2"><ArrowLeft size={20} /></div>
              Voltar para Lista
          </button>
          
          <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 scrollbar-hide">
             <button onClick={() => navigate(`/assets/edit/${id}`)} className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl font-bold text-sm shadow-lg hover:bg-gray-800 transition-all hover:scale-105 active:scale-95 whitespace-nowrap">
                 <Edit3 size={16} /> <span className="hidden sm:inline">Editar Ativo</span>
             </button>
             <button onClick={() => setIsMoveModalOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-50 transition-all hover:scale-105 active:scale-95 whitespace-nowrap">
                 <ArrowRightLeft size={16} /> <span className="hidden sm:inline">Movimentar</span>
             </button>
             <button onClick={() => setIsMaintModalOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-50 transition-all whitespace-nowrap">
                 <Wrench size={16} /> <span className="hidden sm:inline">Manutenção</span>
             </button>
             <button onClick={handlePrintTerm} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-50 transition-all whitespace-nowrap">
                 <FileText size={16} /> <span className="hidden sm:inline">Termo</span>
             </button>
             <button onClick={handlePrintLabel} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-50 transition-all whitespace-nowrap">
                 <Printer size={16} /> <span className="hidden sm:inline">Etiqueta</span>
             </button>
              <button onClick={handleDelete} className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl font-bold text-sm hover:bg-red-100 transition-all ml-auto hover:scale-105">
                 <Trash2 size={16} />
             </button>
          </div>
      </div>

      {/* ======================================================================= */}
      {/* HERO SECTION                                                            */}
      {/* ======================================================================= */}
      <div className="bg-white rounded-[2rem] p-6 md:p-10 shadow-sm border border-gray-100 relative overflow-hidden mb-8 group">
          <div className={`absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-gray-50 to-gray-100 rounded-bl-full -mr-16 -mt-16 opacity-50 pointer-events-none transition-all duration-700 group-hover:scale-110`}></div>
          
          <div className="flex flex-col md:flex-row gap-8 relative z-10">
              <div className="flex-shrink-0">
                  <div className="w-24 h-24 md:w-32 md:h-32 bg-gray-50 rounded-3xl flex items-center justify-center text-gray-900 shadow-inner border border-gray-100">
                      <AssetIcon type={asset.type} category={asset.category} model={asset.model} internalId={asset.internalId} size={48} />
                  </div>
              </div>
              
              <div className="flex-grow pt-2">
                  <div className="flex flex-col md:flex-row md:items-center gap-4 mb-2">
                      <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider ${getBannerColor()} text-white shadow-md`}>
                        {asset.status}
                      </div>
                      <span className="text-sm font-mono text-gray-400 font-bold">{asset.category}</span>
                  </div>
                  
                  <h1 className="text-3xl md:text-5xl font-black text-gray-900 tracking-tight mb-2 leading-tight">{asset.model}</h1>
                  
                  <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 text-sm font-medium text-gray-500">
                      <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100">
                          <Tag size={16} className="text-black" /> 
                          <span className="font-mono font-bold text-gray-900">{asset.internalId}</span>
                      </div>
                      {asset.serialNumber && (
                        <div className="flex items-center gap-2 px-2 py-1.5">
                            <BarcodeIcon className="text-gray-400" />
                            <span className="font-mono">SN: {asset.serialNumber}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 px-2 py-1.5">
                           <Clock size={16} className="text-gray-400" />
                           <span>Atualizado: {formatDate(asset.updatedAt)}</span>
                      </div>
                  </div>
              </div>
          </div>
      </div>

      {/* ======================================================================= */}
      {/* MOBILE TABS                                                             */}
      {/* ======================================================================= */}
      <div className="md:hidden flex mb-6 bg-gray-100 p-1 rounded-xl">
          <button onClick={() => setActiveTab('details')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'details' ? 'bg-white shadow-sm text-black' : 'text-gray-500'}`}>Detalhes</button>
          <button onClick={() => setActiveTab('history')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'history' ? 'bg-white shadow-sm text-black' : 'text-gray-500'}`}>Histórico</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* ======================== LEFT COLUMN (DETAILS) ======================== */}
          <div className={`lg:col-span-2 space-y-8 ${activeTab === 'history' ? 'hidden lg:block' : ''}`}>
              
              {/* CARD: RESPONSABILIDADE */}
              <div className="bg-white rounded-3xl p-6 md:p-8 border border-gray-100 shadow-sm relative overflow-hidden">
                   <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2"><User size={20}/> Responsabilidade e Localização</h3>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                       <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100">
                           <p className="text-xs font-bold text-gray-400 uppercase mb-1">Responsável Atual</p>
                           <p className="font-bold text-gray-900 text-lg">{responsibleName}</p>
                           <div className="flex items-center gap-2 mt-2 text-xs font-medium text-gray-500">
                               <Building2 size={12}/> {derivedSector}
                           </div>
                       </div>
                       <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100">
                           <p className="text-xs font-bold text-gray-400 uppercase mb-1">Localização Física</p>
                           <p className="font-bold text-gray-900 text-lg">{expandLocation(asset.location)}</p>
                           <div className="flex items-center gap-2 mt-2 text-xs font-medium text-gray-500">
                               <MapPin size={12}/> {asset.locationDetails || 'Sem detalhes de sala/mesa'}
                           </div>
                       </div>
                   </div>
              </div>

              {/* CARD: ESPECIFICAÇÕES TÉCNICAS */}
              <div className="bg-white rounded-3xl p-6 md:p-8 border border-gray-100 shadow-sm">
                  <div className="flex justify-between items-center mb-6">
                      <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Monitor size={20}/> Especificações</h3>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-y-6 gap-x-4">
                      <SpecItem label="Tipo" value={asset.type} />
                      <SpecItem label="Marca" value={asset.brand || 'Genérico'} />
                      <SpecItem label="Modelo" value={asset.model} />
                      
                      {asset.specs?.processor && <SpecItem label="Processador" value={asset.specs.processor} />}
                      {asset.specs?.ram && <SpecItem label="Memória RAM" value={asset.specs.ram} />}
                      {asset.specs?.storage && <SpecItem label="Armazenamento" value={asset.specs.storage} />}
                      
                      {showImei && (
                          <>
                            <SpecItem label="IMEI 1" value={asset.imei1 || '-'} copyable />
                            <SpecItem label="IMEI 2" value={asset.imei2 || '-'} copyable />
                          </>
                      )}
                      
                      {showIp && <SpecItem label="Endereço IP" value={asset.specs.ip} fontMono copyable />}
                      {asset.macAddress && <SpecItem label="MAC Address" value={asset.macAddress} fontMono copyable />}
                      
                      <SpecItem label="Data de Aquisição" value={formatDate(asset.acquisitionDate)} />
                      <SpecItem label="Valor Estimado" value={asset.value ? `R$ ${parseFloat(asset.value).toFixed(2)}` : '-'} />
                      {asset.invoiceNumber && <SpecItem label="Nota Fiscal" value={asset.invoiceNumber} />}
                  </div>
              </div>

              {/* CARD: PERIFÉRICOS & ACESSÓRIOS */}
              <div className="bg-white rounded-3xl p-6 md:p-8 border border-gray-100 shadow-sm">
                  <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2"><Plug size={20}/> Periféricos & Acessórios</h3>
                  
                  <div className="flex flex-wrap gap-2 mb-6">
                       {asset.peripherals && asset.peripherals.length > 0 ? (
                           asset.peripherals.map((item, idx) => (
                               <div key={idx} className="group flex items-center gap-2 bg-gray-50 border border-gray-100 pl-3 pr-2 py-2 rounded-xl transition-all hover:border-gray-300 hover:bg-white hover:shadow-sm">
                                   <span className="text-sm font-medium text-gray-700">{item.name}</span>
                                   <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                                       <button onClick={() => setPeripheralToPrint(item)} className="p-1 hover:bg-blue-50 text-blue-600 rounded"><Printer size={12}/></button>
                                       <button onClick={() => handleDeletePeripheral(item)} className="p-1 hover:bg-red-50 text-red-600 rounded"><X size={12}/></button>
                                   </div>
                               </div>
                           ))
                       ) : (
                           <span className="text-sm text-gray-400 italic">Nenhum periférico vinculado.</span>
                       )}
                  </div>

                  <div className="bg-gray-50 rounded-2xl p-2 flex gap-2">
                      <input 
                          type="text" 
                          placeholder="Adicionar (ex: Mouse Logitech, Base Dell...)" 
                          className="flex-1 bg-transparent px-4 text-sm font-medium outline-none"
                          value={newPeripheral}
                          onChange={(e) => setNewPeripheral(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddPeripheral()}
                      />
                      <button onClick={handleAddPeripheral} disabled={isAddingPeripheral} className="bg-black text-white p-2 rounded-xl hover:bg-gray-800 disabled:opacity-50">
                          <Plus size={18}/>
                      </button>
                  </div>
              </div>
              
              {/* CARD: NOTES & LINKS */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Notes */}
                  <div className="bg-white rounded-3xl p-6 md:p-8 border border-gray-100 shadow-sm flex flex-col">
                      <div className="flex justify-between items-center mb-4">
                          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2"><StickyNote size={20}/> Notas</h3>
                          <button onClick={handleSaveNotes} disabled={isSavingNotes} className="text-xs font-bold bg-green-50 text-green-700 hover:bg-green-100 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
                              {isSavingNotes ? 'Salvando...' : <><Save size={12}/> Salvar</>}
                          </button>
                      </div>
                      <textarea 
                          className="w-full flex-1 bg-yellow-50/50 border border-yellow-100 rounded-xl p-4 text-sm text-gray-700 leading-relaxed focus:bg-white focus:border-yellow-300 focus:ring-4 focus:ring-yellow-50 outline-none transition-all resize-none min-h-[150px]"
                          placeholder="Digite observações importantes sobre o ativo..."
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                      ></textarea>
                  </div>

                  {/* Links */}
                  <div className="bg-white rounded-3xl p-6 md:p-8 border border-gray-100 shadow-sm flex flex-col">
                      <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2"><LinkIcon size={20}/> Anexos & Links</h3>
                      
                      <div className="flex-1 space-y-2 mb-4 overflow-y-auto max-h-[150px] custom-scrollbar">
                          {asset.attachments?.map((link, i) => (
                              <div key={i} className="flex justify-between items-center p-3 rounded-xl bg-gray-50 border border-gray-100 hover:border-blue-200 transition-colors group">
                                  <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm font-medium text-blue-600 hover:underline truncate">
                                      <FileText size={14} className="text-gray-400"/> {link.name}
                                  </a>
                                  <button onClick={() => handleDeleteLink(link)} className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all ml-2"><Trash2 size={14}/></button>
                              </div>
                          ))}
                          {(!asset.attachments || asset.attachments.length === 0) && <p className="text-sm text-gray-400 italic text-center py-4">Nenhum link adicionado.</p>}
                      </div>

                      <div className="flex flex-col gap-2 bg-gray-50 p-3 rounded-2xl">
                          <input type="text" placeholder="Nome (ex: Manual PDF)" className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-black" value={newLinkName} onChange={(e) => setNewLinkName(e.target.value)} />
                          <div className="flex gap-2">
                              <input type="url" placeholder="https://..." className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-black" value={newLinkUrl} onChange={(e) => setNewLinkUrl(e.target.value)} />
                              <button onClick={handleAddLink} disabled={isAddingLink} className="bg-black text-white p-2 rounded-lg hover:bg-gray-800 disabled:opacity-50"><Plus size={16}/></button>
                          </div>
                      </div>
                  </div>
              </div>

          </div>

          {/* ======================== RIGHT COLUMN (HISTORY) ======================== */}
          <div className={`lg:col-span-1 space-y-6 ${activeTab === 'details' ? 'hidden lg:block' : ''}`}>
              <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm h-full flex flex-col">
                  <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2"><History size={20}/> Linha do Tempo</h3>
                  
                  <div className="relative border-l-2 border-gray-100 ml-3 space-y-8 pb-8">
                       {history.length === 0 && <p className="text-sm text-gray-400 pl-6 italic">Sem histórico registrado.</p>}
                       {history.map((item, index) => (
                           <div key={item.id || index} className="relative pl-6 group">
                               <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white shadow-sm ${item.action?.includes('Manutenção') ? 'bg-orange-500' : item.action?.includes('Entrega') ? 'bg-green-500' : 'bg-gray-400'} group-hover:scale-125 transition-transform`}></div>
                               <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5 block">{formatDate(item.date)}</span>
                               <h4 className="text-sm font-bold text-gray-900">{item.action}</h4>
                               {item.details && <p className="text-xs text-gray-500 mt-1 leading-relaxed bg-gray-50 p-2 rounded-lg">{item.details}</p>}
                               <p className="text-[10px] text-gray-400 mt-1 font-medium">{item.user || 'Sistema'}</p>
                           </div>
                       ))}
                  </div>
              </div>
          </div>
      
      </div>

      {/* MODALS */}
      {isMoveModalOpen && <MoveAssetModal isOpen={isMoveModalOpen} onClose={() => setIsMoveModalOpen(false)} onConfirm={handleMoveConfirm} currentAsset={{...asset, responsibleName, location: asset.location}} />}
      {isMaintModalOpen && <MaintenanceModal isOpen={isMaintModalOpen} onClose={() => setIsMaintModalOpen(false)} onConfirm={handleMaintenanceConfirm} currentAsset={asset} />}

    </div>
  );
};

// UI Helpers
const SpecItem = ({ label, value, fontMono, copyable }) => (
    <div className="flex flex-col">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
        <div className="flex items-center gap-2">
            <span className={`text-sm font-medium text-gray-800 ${fontMono ? 'font-mono' : ''} truncate max-w-full`} title={value}>{value || '---'}</span>
            {copyable && value && <button onClick={() => {navigator.clipboard.writeText(value); alert("Copiado!")}} className="text-gray-300 hover:text-black transition-colors"><CopyIcon size={12}/></button>}
        </div>
    </div>
);

const CopyIcon = ({size}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2-2v1"></path></svg>;
const BarcodeIcon = ({className}) => <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5v14"/><path d="M8 5v14"/><path d="M12 5v14"/><path d="M17 5v14"/><path d="M21 5v14"/></svg>;

export default AssetDetail;