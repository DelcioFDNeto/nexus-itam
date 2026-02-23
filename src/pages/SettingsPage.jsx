import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { generateFullBackup, restoreBackup } from '../services/backupService';
import { 
  Settings, Save, Database, Download, AlertTriangle, 
  UserCog, FileText, CheckCircle, Shield, UploadCloud, RefreshCcw, FileJson, Info, Code, Play 
} from 'lucide-react';
import { toast } from 'sonner';

const SettingsPage = () => {
  const [loading, setLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restoreStatus, setRestoreStatus] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [importSummary, setImportSummary] = useState(null); // { filename, stats: { assets: 10, ... } }
  const [showFormatGuide, setShowFormatGuide] = useState(false);
  
  const fileInputRef = useRef(null);
  
  // Estado das configurações
  const [config, setConfig] = useState({
    companyName: 'BySabel ITAM',
    itManager: 'Délcio Farias',
    supportEmail: 'shiadmti@gmail.com',
    termTitle: 'Termo de Responsabilidade',
    locationBranch: 'Matriz - Belém'
  });

  // 1. Carregar Configurações
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const docRef = doc(db, 'settings', 'general');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setConfig(prev => ({ ...prev, ...docSnap.data() }));
        }
      } catch (error) {
        console.error("Erro ao carregar configs:", error);
      }
    };
    loadConfig();
  }, []);

  // 2. Salvar Configurações
  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await setDoc(doc(db, 'settings', 'general'), config);
      toast.success("Configurações atualizadas com sucesso!");
    } catch (error) {
      toast.error("Erro ao salvar.");
    } finally {
      setLoading(false);
    }
  };

  // 3. Gerar Backup
  const handleFullBackup = async () => {
    setBackupLoading(true);
    try {
      const backupData = await generateFullBackup();
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", `BACKUP_SHINERAY_${new Date().toISOString().slice(0,10)}.json`);
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    } catch (error) {
      console.error(error);
      toast.error("Erro ao gerar backup. Verifique o console.");
    } finally {
      setBackupLoading(false);
    }
  };

  // 4. Download Template
  const handleDownloadTemplate = () => {
     const template = {
       meta: { version: "2.0", type: "full_backup", date: new Date().toISOString() },
       data: {
         assets: [ { internalId: "TAG-001", model: "Exemplo", type: "Notebook", status: "Disponível" } ],
         employees: [], history: [], projects: [], tasks: [], sectors: []
       }
     };
     const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(template, null, 2));
     const a = document.createElement('a');
     a.href = dataStr;
     a.download = "TEMPLATE_IMPORTACAO.json";
     document.body.appendChild(a);
     a.click();
     a.remove();
  };

  // 5. Manipulação de Arquivo
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
  };

  const handleFile = (file) => {
    if (file.type !== "application/json" && !file.name.endsWith('.json')) {
        toast.error("Arquivo inválido. Por favor, envie um JSON.");
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const json = JSON.parse(e.target.result);
            // Validação preliminar da estrutura
            if (!json.meta || !json.data) {
                toast.error("Estrutura do arquivo inválida. Falta 'meta' ou 'data'. Consulte o guia.");
                return;
            }
            
            // Análise do conteúdo
            const summary = {
                filename: file.name,
                version: json.meta.version || 'Desconhecida',
                date: json.meta.date ? new Date(json.meta.date).toLocaleString() : 'N/A',
                counts: Object.keys(json.data).reduce((acc, key) => {
                    if(Array.isArray(json.data[key])) acc[key] = json.data[key].length;
                    return acc;
                }, {}),
                rawData: json
            };
            
            setImportSummary(summary);
            
        } catch (err) {
            toast.error("Erro ao ler o arquivo JSON: " + err.message);
        }
    };
    reader.readAsText(file);
  };

  const confirmRestore = async () => {
      if (!importSummary) return;
      
      setImportSummary(null); // Fecha modal de resumo
      setRestoreLoading(true);
      setRestoreProgress(0);
      setRestoreStatus("Inicializando...");
      
      try {
          const stats = await restoreBackup(importSummary.rawData, (progress, message) => {
              setRestoreProgress(progress);
              setRestoreStatus(message);
          });
          
          toast.success(`Sucesso! Importação finalizada.\n\nColeções: ${stats.collectionsUpdated.join(', ')}\nErros: ${stats.errors.length}`);
          window.location.reload(); 
      } catch (error) {
          console.error(error);
          toast.error("Falha na restauração: " + error.message);
      } finally {
          setRestoreLoading(false);
          setRestoreStatus("");
      }
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto pb-24">
      
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 bg-gray-900 text-white rounded-xl">
            <Settings size={28} />
        </div>
        <div>
            <h1 className="text-2xl font-black text-gray-900">Configurações Avançadas</h1>
            <p className="text-sm text-gray-500">Backup, Restauração e Parâmetros do Sistema</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* ESQUERDA: PARÂMETROS */}
        <div className="lg:col-span-1 space-y-6">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden sticky top-8">
                <div className="bg-gray-50 p-4 border-b border-gray-100 flex items-center gap-2">
                    <FileText className="text-brand" size={18}/>
                    <h2 className="font-bold text-gray-800 text-sm uppercase">Documentos (PDF)</h2>
                </div>
                <form onSubmit={handleSave} className="p-5 space-y-4">
                     {/* Campos simplificados para não ocupar muito espaço no código da resposta, mas mantendo a lógica */}
                     {['companyName', 'itManager', 'supportEmail', 'termTitle'].map(field => (
                        <div key={field}>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">{field}</label>
                            <input value={config[field]} onChange={e => setConfig({...config, [field]: e.target.value})} className="w-full p-2 border rounded-lg font-bold text-sm text-gray-800 focus:outline-none focus:border-black"/>
                        </div>
                     ))}
                    <button type="submit" disabled={loading} className="w-full bg-black text-white py-3 rounded-lg font-bold hover:bg-gray-800 flex items-center justify-center gap-2 text-sm shadow-md transition-all active:scale-95">
                        {loading ? 'Salvando...' : <><Save size={16}/> Salvar Configurações</>}
                    </button>
                </form>
            </div>
        </div>

        {/* CENTRO/DIREITA: BACKUP E RESTORE */}
        <div className="lg:col-span-2 space-y-6">
            
            {/* 1. EXPORTAÇÃO */}
            <div className="bg-white rounded-2xl border border-blue-100 shadow-sm overflow-hidden relative group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><Database size={100} className="text-blue-500"/></div>
                <div className="p-6 relative z-10">
                    <h2 className="text-lg font-black text-blue-900 mb-2 flex items-center gap-2"><Download className="text-blue-600"/> Backup do Sistema</h2>
                    <p className="text-sm text-blue-700/80 mb-6 max-w-md">Gera um arquivo JSON completo contendo todos os dados. Ideal para migração ou segurança.</p>
                    <button onClick={handleFullBackup} disabled={backupLoading} className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-700 flex items-center gap-2 shadow-lg shadow-blue-200 transition-all hover:scale-105 active:scale-95">
                        {backupLoading ? <RefreshCcw className="animate-spin" size={20}/> : <FileJson size={20}/>}
                        {backupLoading ? 'Gerando Arquivo...' : 'Baixar Backup Completo'}
                    </button>
                </div>
            </div>

            {/* 2. IMPORTAÇÃO AVANÇADA */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-black text-gray-900 mb-1 flex items-center gap-2"><UploadCloud className="text-orange-500"/> Restauração de Dados</h2>
                        <p className="text-sm text-gray-500">Importe um arquivo JSON para restaurar ou atualizar dados.</p>
                    </div>
                    <button onClick={() => setShowFormatGuide(!showFormatGuide)} className="text-xs font-bold text-gray-500 hover:text-black flex items-center gap-1 bg-gray-100 px-3 py-1.5 rounded-lg border border-gray-200">
                        <Code size={14}/> {showFormatGuide ? 'Ocultar Guia' : 'Guia de Formato'}
                    </button>
                </div>
                
                {/* GUIA DE FORMATO (COLLAPSIBLE) */}
                {showFormatGuide && (
                    <div className="bg-gray-50 p-6 border-b border-gray-200 text-sm">
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="font-bold text-gray-800 flex items-center gap-2"><Info size={16} className="text-blue-500"/> Estrutura JSON Esperada</h3>
                            <button onClick={handleDownloadTemplate} className="text-xs bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-100 font-bold text-gray-700">Baixar Modelo Vazio</button>
                        </div>
                        <p className="text-gray-600 mb-3">O arquivo deve conter um objeto raiz com as chaves <code>meta</code> e <code>data</code>. Os dados são agrupados por coleção.</p>
                        <pre className="bg-gray-900 text-gray-100 p-4 rounded-xl overflow-x-auto font-mono text-xs shadow-inner border border-gray-700">
{`{
  "meta": {
    "version": "2.0",
    "type": "full_backup",
    "date": "2024-05-20T10:00:00.000Z"
  },
  "data": {
    "assets": [
      {
        "internalId": "NB-001",
        "model": "Dell Latitude 3420",
        "type": "Notebook",
        "status": "Em Uso"
        ...
      }
    ],
    "employees": [ ... ],
    "history": [ ... ]
  }
}`}
                        </pre>
                        <div className="mt-3 flex items-start gap-2 text-xs text-orange-700 bg-orange-100 p-3 rounded-lg">
                            <AlertTriangle size={14} className="shrink-0 mt-0.5"/>
                            <p><strong>Importante:</strong> Se um registro já existir (baseado no ID ou InternalId), ele será <strong>atualizado</strong>. Se não existir, será <strong>criado</strong>.</p>
                        </div>
                    </div>
                )}

                <div className="p-6">
                    {/* MODAL / VISUAL DE CONFIRMAÇÃO DO ARQUIVO */}
                    {importSummary ? (
                        <div className="animate-in fade-in zoom-in duration-200 bg-blue-50 border border-blue-100 rounded-xl p-5">
                            <h3 className="font-bold text-blue-900 text-lg mb-4 flex items-center gap-2"><FileJson className="text-blue-600"/> Arquivo Analisado</h3>
                            
                            <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                                <div><p className="text-gray-500 text-xs uppercase font-bold">Nome</p><p className="font-mono font-bold text-gray-800 truncate">{importSummary.filename}</p></div>
                                <div><p className="text-gray-500 text-xs uppercase font-bold">Data (Meta)</p><p className="font-bold text-gray-800">{importSummary.date}</p></div>
                            </div>

                            <div className="bg-white rounded-lg border border-blue-100 p-4 mb-6">
                                <p className="text-xs font-bold text-gray-400 uppercase mb-2">Conteúdo Encontrado</p>
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                    {Object.entries(importSummary.counts).map(([key, count]) => (
                                        <div key={key} className="bg-gray-50 p-2 rounded text-center border border-gray-100">
                                            <span className="block text-lg font-black text-gray-800">{count}</span>
                                            <span className="text-[10px] text-gray-500 uppercase font-bold">{key}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex gap-3">
                                <button onClick={() => setImportSummary(null)} className="flex-1 py-3 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50">Cancelar</button>
                                <button onClick={confirmRestore} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 shadow-lg shadow-blue-200 flex items-center justify-center gap-2">
                                    <Play size={18}/> Confirmar Importação
                                </button>
                            </div>
                        </div>
                    ) : restoreLoading ? (
                        // LOADING STATE
                        <div className="text-center py-8">
                            <div className="w-16 h-16 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin mx-auto mb-4"></div>
                            <h3 className="font-bold text-xl text-gray-800">{restoreProgress}%</h3>
                            <p className="text-gray-500 font-medium">{restoreStatus}</p>
                            <div className="w-full bg-gray-100 rounded-full h-2 mt-4 overflow-hidden">
                                <div className="bg-orange-500 h-2 transition-all duration-300" style={{ width: `${restoreProgress}%` }}></div>
                            </div>
                        </div>
                    ) : (
                        // DRAG & DROP AREA
                        <div 
                            className={`border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer group ${dragActive ? 'border-orange-500 bg-orange-50 scale-[1.02]' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'}`}
                            onDragEnter={handleDrag}
                            onDragLeave={handleDrag}
                            onDragOver={handleDrag}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current.click()}
                        >
                            <input ref={fileInputRef} type="file" className="hidden" accept=".json" onChange={handleFileChange} />
                            <div className="w-16 h-16 bg-gray-100 group-hover:bg-white rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400 group-hover:text-orange-500 transition-colors shadow-sm">
                                <UploadCloud size={32}/>
                            </div>
                            <h3 className="font-bold text-gray-700 group-hover:text-gray-900">Clique ou Arraste seu JSON aqui</h3>
                            <p className="text-sm text-gray-400 mt-1 max-w-xs mx-auto">Suporta backups completos ou parciais. O sistema validará o arquivo antes de importar.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* ZONA DE PERIGO VISUAL */}
            <div className="border border-red-100 rounded-xl p-4 bg-red-50/30 flex items-center justify-between opacity-60 hover:opacity-100 transition-opacity">
                <div className="flex items-center gap-3">
                    <Shield className="text-red-400" size={20}/>
                    <div>
                        <h4 className="font-bold text-red-900 text-sm">Hard Reset</h4>
                        <p className="text-[10px] text-red-700">Apenas desenvolvedores</p>
                    </div>
                </div>
                <div className="text-xs font-mono text-red-400 bg-white px-2 py-1 rounded border border-red-100">Action Blocked</div>
            </div>

        </div>
      </div>
    </div>
  );
};

export default SettingsPage;