import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { generateFullBackup, restoreBackup } from '../services/backupService';
import { 
  Settings, Save, Database, Download, AlertTriangle, 
  UserCog, FileText, CheckCircle, Shield, UploadCloud, RefreshCcw, FileJson, Info, Code, Play, Tag, Plus, Trash2
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNavigate } from 'react-router-dom';

const CONFIG_FIELDS = [
  { key: 'companyName', label: 'Nome da empresa', placeholder: 'Ex: Shineray do Brasil' },
  { key: 'cnpj', label: 'CNPJ', placeholder: '00.000.000/0001-00' },
  { key: 'itManager', label: 'Gestor de TI', placeholder: 'Nome do responsável' },
  { key: 'supportEmail', label: 'Email de suporte', placeholder: 'suporte@empresa.com' },
  { key: 'termTitle', label: 'Título do termo', placeholder: 'Termo de Responsabilidade' },
  { key: 'logoUrl', label: 'URL do Logotipo', placeholder: 'https://...', type: 'text' },
  { key: 'primaryColor', label: 'Cor Principal (HEX)', placeholder: '#000000', type: 'color' },
];

const getCompanyLabel = (companyName) =>
  (companyName || 'Nexus ITAM').trim() || 'Nexus ITAM';

const getSupportEmail = (supportEmail) =>
  (supportEmail || 'shiadmti@gmail.com').trim() || 'shiadmti@gmail.com';

const SettingsPage = () => {
  const { currentUser } = useAuth();
  const { theme, setTheme, accentColor, setAccentColor } = useTheme();
  const navigate = useNavigate();
  const tenantId = currentUser?.tenantId;
  const [loading, setLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restoreStatus, setRestoreStatus] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [importSummary, setImportSummary] = useState(null); // { filename, stats: { assets: 10, ... } }
  const [showFormatGuide, setShowFormatGuide] = useState(false);
  
  const fileInputRef = useRef(null);
  
  // Guarda na memória as variáveis globais da empresa, laços e termos de uso
  const [config, setConfig] = useState({
    companyName: 'Nexus ITAM',
    cnpj: '',
    itManager: 'Délcio Farias',
    supportEmail: 'shiadmti@gmail.com',
    termTitle: 'Termo de Responsabilidade',
    termClauses: '1. DO USO E FINALIDADE: O(a) Responsável declara ter recebido o equipamento em perfeito estado de conservação e funcionamento. Compromete-se a utilizá-lo estrita e exclusivamente para fins profissionais.\n2. DA GUARDA E CONSERVAÇÃO: É responsabilidade do(a) Responsável zelar pela guarda, segurança e conservação do equipamento.\n3. DA RESTITUIÇÃO: O equipamento deverá ser devolvido imediatamente à Empresa, em perfeito estado, em caso de rescisão, mudança de cargo ou solicitação expressa.',
    locationBranch: 'Matriz - Belém',
    logoUrl: '',
    primaryColor: '#000000',
    customFields: []
  });

  // Busca a identidade visual e dados cadastrais no banco logo na largada da tela
  useEffect(() => {
    if (currentUser?.role !== 'owner' && currentUser?.role !== 'superadmin') {
      toast.error('Acesso negado. Apenas o Líder da TI (Owner) pode acessar as configurações.');
      navigate('/dashboard');
      return;
    }
    
    if (!tenantId) return;
    const loadConfig = async () => {
      try {
        const docRef = doc(db, 'settings', tenantId || 'general');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setConfig(prev => ({ ...prev, ...docSnap.data() }));
        }
      } catch (error) {
        console.error("Erro ao carregar configs:", error);
      }
    };
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const addCustomField = () => {
    setConfig(prev => ({
      ...prev,
      customFields: [...(prev.customFields || []), { id: `cf_${Date.now()}`, label: '', type: 'text' }]
    }));
  };

  const updateCustomField = (index, key, value) => {
    const newFields = [...(config.customFields || [])];
    newFields[index][key] = value;
    setConfig({ ...config, customFields: newFields });
  };

  const removeCustomField = (index) => {
    const newFields = [...(config.customFields || [])];
    newFields.splice(index, 1);
    setConfig({ ...config, customFields: newFields });
  };

  // Carimba e documenta (Salva) todo o formulário global alterado
  const handleSave = async (e) => {
    e.preventDefault();
    if (!tenantId) {
      toast.error("Sem contexto de tenant.");
      return;
    }
    setLoading(true);
    try {
      await setDoc(doc(db, 'settings', tenantId || 'general'), config);
      toast.success("Configurações atualizadas com sucesso!");
    } catch (error) {
      console.error(error);
      toast.error("Erro ao salvar.");
    } finally {
      setLoading(false);
    }
  };

  // Varredura sistêmica completa, envelopando o ecossistema em um JSON gordo
  const handleFullBackup = async () => {
    setBackupLoading(true);
    try {
      const backupData = await generateFullBackup();
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", `BACKUP_NEXUS_${new Date().toISOString().slice(0,10)}.json`);
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

  // Fornece um arquivo em branco com o DNA da aplicação pra evitar importações frustradas
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

  // Orquestração mágica para transformar "arrastas" e "soltas" em ações reais
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
            // Batida de olho técnica: O arquivo tem cabeça (meta) e corpo (data)?
            if (!json.meta || !json.data) {
                toast.error("Estrutura do arquivo inválida. Falta 'meta' ou 'data'. Consulte o guia.");
                return;
            }
            
            // Dissecar o organismo do arquivo: Quantos braços (ativos), pernas (histórico) ele tem
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
          }, tenantId);
          
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
      
      {/* Painel topo da central de controle do sistema */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 bg-gray-900 dark:bg-slate-800 text-white rounded-xl">
            <Settings size={28} />
        </div>
        <div>
            <h1 className="text-2xl font-black text-gray-900 dark:text-white">Configurações Avançadas</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Backup, Restauração e Parâmetros do Sistema</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* COLUNA 1: Textos burocráticos e variáveis que pipocam nos PDFs do sistema */}
        <div className="lg:col-span-1 space-y-6">
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-600 shadow-sm overflow-hidden sticky top-8">
                <div className="bg-gray-50 dark:bg-slate-900 p-4 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2">
                    <FileText className="text-brand" size={18}/>
                    <h2 className="font-bold text-gray-800 dark:text-white text-sm uppercase">Documentos e Etiquetas</h2>
                </div>
                <form onSubmit={handleSave} className="p-5 space-y-4">
{/* Montagem inteligente de loops mapeando todos os inputs das configurações */}
                      {CONFIG_FIELDS.map(field => (
                         <div key={field.key}>
                             <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">{field.label}</label>
                             <input 
                               type={field.type || "text"}
                               value={config[field.key] || ''} 
                               onChange={e => setConfig({...config, [field.key]: e.target.value})} 
                               className={`w-full border dark:border-slate-700 dark:bg-slate-900 rounded-lg font-bold text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:border-brand dark:focus:border-brand ${field.type === 'color' ? 'h-10 p-1 cursor-pointer' : 'p-2'}`}
                               placeholder={field.placeholder}
                             />
                         </div>
                      ))}
                      <div className="col-span-1 md:col-span-2">
                           <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 block">Cláusulas do Termo de Responsabilidade</label>
                           <textarea
                             value={config.termClauses || ''}
                             onChange={e => setConfig({...config, termClauses: e.target.value})}
                             className="w-full border dark:border-slate-700 dark:bg-slate-900 rounded-lg font-bold text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:border-brand dark:focus:border-brand p-2 h-32 resize-none"
                             placeholder="Digite as cláusulas do contrato, uma por linha..."
                           />
                       </div>
                      
                    {/* Sessão: Campos Customizados para Ativos */}
                    <div className="rounded-xl border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-900 p-4 space-y-3">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <Database size={16} className="text-brand" />
                                <h3 className="text-xs font-black text-gray-700 dark:text-gray-200 uppercase">Campos Customizados</h3>
                            </div>
                            <button type="button" onClick={addCustomField} className="text-[10px] flex items-center gap-1 bg-brand text-white px-2 py-1 rounded font-bold hover:bg-brand/80 transition-colors">
                                <Plus size={12}/> Adicionar Campo
                            </button>
                        </div>
                        {(config.customFields || []).map((cf, idx) => (
                            <div key={cf.id} className="flex items-center gap-2 bg-white dark:bg-slate-800 p-2 border border-gray-200 dark:border-slate-600 rounded-lg shadow-sm">
                                <input 
                                    value={cf.label} 
                                    onChange={e => updateCustomField(idx, 'label', e.target.value)}
                                    placeholder="Nome do Campo"
                                    className="flex-1 p-1.5 border dark:border-slate-700 dark:bg-slate-900 rounded text-xs font-bold text-gray-800 dark:text-gray-100 focus:border-brand focus:outline-none"
                                />
                                <select 
                                    value={cf.type} 
                                    onChange={e => updateCustomField(idx, 'type', e.target.value)}
                                    className="p-1.5 border dark:border-slate-700 dark:bg-slate-900 rounded text-xs font-bold text-gray-600 dark:text-gray-400 bg-gray-50 focus:border-brand focus:outline-none"
                                >
                                    <option value="text">Texto Curto</option>
                                    <option value="textarea">Texto Longo</option>
                                    <option value="date">Data</option>
                                    <option value="number">Número</option>
                                </select>
                                <button type="button" onClick={() => removeCustomField(idx)} className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors">
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                        {(!config.customFields || config.customFields.length === 0) && (
                            <p className="text-xs text-center text-gray-400 dark:text-gray-500 font-medium py-2">Nenhum campo customizado criado.</p>
                        )}
                    </div>

                    <div className="rounded-xl border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-900 p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <Tag size={16} className="text-brand" />
                            <h3 className="text-xs font-black text-gray-700 dark:text-gray-200 uppercase">Identidade das Etiquetas</h3>
                        </div>
                        <div className="rounded-lg border-2 border-gray-900 bg-white dark:bg-slate-800 p-3 font-sans">
                            <div className="border-b border-gray-200 dark:border-slate-600 pb-2">
                                <p className="text-sm font-black leading-none text-brand">Nexus<span className="text-gray-900 dark:text-white">ITAM</span></p>
                                <p className="mt-1 truncate text-[10px] font-black uppercase text-gray-900 dark:text-white">{getCompanyLabel(config.companyName)}</p>
                            </div>
                            <div className="pt-3">
                                <p className="text-[9px] font-black uppercase text-gray-500 dark:text-gray-400">Patrimônio</p>
                                <p className="font-mono text-xl font-black text-gray-950">TAG-001</p>
                            </div>
                            <div className="mt-2 flex items-center justify-between border-t border-gray-900 pt-1">
                                <span className="text-[8px] font-black text-gray-600">SUPORTE TI</span>
                                <span className="max-w-[120px] truncate text-[9px] font-black text-gray-900 dark:text-white">{getSupportEmail(config.supportEmail)}</span>
                            </div>
                        </div>
                    </div>
                    <button type="submit" disabled={loading} className="w-full bg-black text-white py-3 rounded-lg font-bold hover:bg-gray-800 flex items-center justify-center gap-2 text-sm shadow-md transition-all active:scale-95">
                        {loading ? 'Salvando...' : <><Save size={16}/> Salvar Configurações</>}
                    </button>
                </form>
            </div>
        </div>

        {/* COLUNA 2 e 3: Área nevrálgica de transplante de órgãos (Dados JSON) */}
        <div className="lg:col-span-2 space-y-6">

          {/* SESSÃO DE APARÊNCIA / THEME */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-600 shadow-sm overflow-hidden">
              <div className="bg-gray-50 dark:bg-slate-900 p-4 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2">
                  <UserCog className="text-brand" size={18} />
                  <h2 className="font-bold text-gray-800 dark:text-white text-sm uppercase">Aparência do Sistema</h2>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">Modo de Exibição</h3>
                  <div className="flex gap-3">
                    <button onClick={() => setTheme('light')} className={`flex-1 py-3 border-2 rounded-xl text-sm font-bold flex flex-col items-center gap-2 transition-all ${theme === 'light' ? 'border-brand text-brand bg-brand/5' : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-600'}`}>
                      <div className="w-8 h-8 rounded-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 shadow-sm"></div>
                      Claro
                    </button>
                    <button onClick={() => setTheme('dark')} className={`flex-1 py-3 border-2 rounded-xl text-sm font-bold flex flex-col items-center gap-2 transition-all ${theme === 'dark' ? 'border-brand text-brand bg-brand/5' : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-600'}`}>
                      <div className="w-8 h-8 rounded-full bg-slate-900 border border-slate-700 shadow-sm"></div>
                      Escuro
                    </button>
                    <button onClick={() => setTheme('system')} className={`flex-1 py-3 border-2 rounded-xl text-sm font-bold flex flex-col items-center gap-2 transition-all ${theme === 'system' ? 'border-brand text-brand bg-brand/5' : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-600'}`}>
                      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-slate-900 to-white border border-gray-300 shadow-sm"></div>
                      Sistema
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">Cor Destaque (Accent Color)</h3>
                  <div className="flex gap-4">
                    {[
                      { id: 'blue', color: '#4F46E5' },
                      { id: 'green', color: '#10B981' },
                      { id: 'purple', color: '#8B5CF6' },
                      { id: 'orange', color: '#F97316' },
                      { id: 'cyan', color: '#06B6D4' }
                    ].map(c => (
                      <button 
                        key={c.id} 
                        onClick={() => setAccentColor(c.id)}
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${accentColor === c.id ? 'ring-4 ring-offset-2 ring-brand scale-110' : 'hover:scale-105'}`}
                        style={{ backgroundColor: c.color }}
                      >
                        {accentColor === c.id && <CheckCircle size={16} className="text-white drop-shadow-md" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
          </div>
            
          {/* CAIXA 1: Ferramenta brutalista de backup global em um clique */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-blue-100 dark:border-blue-900/50 shadow-sm overflow-hidden relative group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><Database size={100} className="text-blue-500"/></div>
                <div className="p-6 relative z-10">
                    <h2 className="text-lg font-black text-blue-900 dark:text-blue-400 mb-2 flex items-center gap-2"><Download className="text-blue-600 dark:text-blue-500"/> Backup do Sistema</h2>
                    <p className="text-sm text-blue-700/80 dark:text-blue-300/80 mb-6 max-w-md">Gera um arquivo JSON completo contendo todos os dados. Ideal para migração ou segurança.</p>
                    <button onClick={handleFullBackup} disabled={backupLoading} className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-700 flex items-center gap-2 shadow-lg shadow-blue-200 dark:shadow-none transition-all hover:scale-105 active:scale-95">
                        {backupLoading ? <RefreshCcw className="animate-spin" size={20}/> : <FileJson size={20}/>}
                        {backupLoading ? 'Gerando Arquivo...' : 'Baixar Backup Completo'}
                    </button>
                </div>
            </div>

            {/* CAIXA 2: Receptor focado em assimilar vidas passadas de outras bases suportadas */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-600 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-gray-100 dark:border-slate-700 flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-black text-gray-900 dark:text-white mb-1 flex items-center gap-2"><UploadCloud className="text-orange-500"/> Restauração de Dados</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Importe um arquivo JSON para restaurar ou atualizar dados.</p>
                    </div>
                    <button onClick={() => setShowFormatGuide(!showFormatGuide)} className="text-xs font-bold text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white flex items-center gap-1 bg-gray-100 dark:bg-slate-700 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600">
                    </button>
                </div>
                
                {/* Aba retrátil agindo como um instrutor chato porém necessário para formats de injeção */}
                {showFormatGuide && (
                    <div className="bg-gray-50 dark:bg-slate-900 p-6 border-b border-gray-200 dark:border-slate-600 text-sm">
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2"><Info size={16} className="text-blue-500"/> Estrutura JSON Esperada</h3>
                            <button onClick={handleDownloadTemplate} className="text-xs bg-white dark:bg-slate-800 border border-gray-300 px-2 py-1 rounded hover:bg-gray-100 font-bold text-gray-700 dark:text-gray-200">Baixar Modelo Vazio</button>
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
                    {/* Estado 2: Diagnóstico pronto. Aguardando a bênção do chefe supremo para atirar as informações no banco */}
                    {importSummary ? (
                        <div className="animate-in fade-in zoom-in duration-200 bg-blue-50 border border-blue-100 rounded-xl p-5">
                            <h3 className="font-bold text-blue-900 text-lg mb-4 flex items-center gap-2"><FileJson className="text-blue-600"/> Arquivo Analisado</h3>
                            
                            <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                                <div><p className="text-gray-500 dark:text-gray-400 text-xs uppercase font-bold">Nome</p><p className="font-mono font-bold text-gray-800 dark:text-gray-100 truncate">{importSummary.filename}</p></div>
                                <div><p className="text-gray-500 dark:text-gray-400 text-xs uppercase font-bold">Data (Meta)</p><p className="font-bold text-gray-800 dark:text-gray-100">{importSummary.date}</p></div>
                            </div>

                            <div className="bg-white dark:bg-slate-800 rounded-lg border border-blue-100 p-4 mb-6">
                                <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-2">Conteúdo Encontrado</p>
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                    {Object.entries(importSummary.counts).map(([key, count]) => (
                                        <div key={key} className="bg-gray-50 dark:bg-slate-900 p-2 rounded text-center border border-gray-100 dark:border-slate-700">
                                            <span className="block text-lg font-black text-gray-800 dark:text-gray-100">{count}</span>
                                            <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold">{key}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex gap-3">
                                <button onClick={() => setImportSummary(null)} className="flex-1 py-3 bg-white dark:bg-slate-800 border border-gray-300 text-gray-700 dark:text-gray-200 font-bold rounded-lg hover:bg-gray-50 dark:hover:bg-slate-900">Cancelar</button>
                                <button onClick={confirmRestore} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 shadow-lg shadow-blue-200 flex items-center justify-center gap-2">
                                    <Play size={18}/> Confirmar Importação
                                </button>
                            </div>
                        </div>
                    ) : restoreLoading ? (
                        // Estado 3: Turbinas trabalhando. Barra progressiva acalma a ansiedade avisando que não travou
                        <div className="text-center py-8">
                            <div className="w-16 h-16 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin mx-auto mb-4"></div>
                            <h3 className="font-bold text-xl text-gray-800 dark:text-gray-100">{restoreProgress}%</h3>
                            <p className="text-gray-500 dark:text-gray-400 font-medium">{restoreStatus}</p>
                            <div className="w-full bg-gray-100 rounded-full h-2 mt-4 overflow-hidden">
                                <div className="bg-orange-500 h-2 transition-all duration-300" style={{ width: `${restoreProgress}%` }}></div>
                            </div>
                        </div>
                    ) : (
                        // Estado 1: Tela de imã limpa e seca clamando por injeção de arquivo JSON
                        <div 
                                className={`p-8 border-2 border-dashed ${dragActive ? 'border-brand bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-200 dark:border-slate-600 bg-gray-50/50 dark:bg-slate-800/50'} transition-all text-center mx-6 mb-6 rounded-xl relative cursor-pointer group`}
                                onDragEnter={handleDrag}
                                onDragLeave={handleDrag}
                                onDragOver={handleDrag}
                                onDrop={handleDrop}
                                onClick={() => fileInputRef.current.click()}
                            >
                                <input ref={fileInputRef} type="file" className="hidden" accept=".json" onChange={handleFileChange} />
                                <div className="w-16 h-16 bg-white dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400 dark:text-gray-500 group-hover:text-orange-500 transition-colors shadow-sm border border-gray-100 dark:border-slate-700">
                                    <UploadCloud size={32}/>
                                </div>
                                <h3 className="font-bold text-gray-700 dark:text-gray-200 group-hover:text-gray-900 dark:group-hover:text-white">Clique ou Arraste seu JSON aqui</h3>
                            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 max-w-xs mx-auto">Suporta backups completos ou parciais. O sistema validará o arquivo antes de importar.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Alerta estético, brincadeira de WipeOut travada só pra botar medo caso queiram */}
            <div className="border border-red-100 rounded-xl p-4 bg-red-50/30 flex items-center justify-between opacity-60 hover:opacity-100 transition-opacity">
                <div className="flex items-center gap-3">
                    <Shield className="text-red-400" size={20}/>
                    <div>
                        <h4 className="font-bold text-red-900 text-sm">Hard Reset</h4>
                        <p className="text-[10px] text-red-700">Apenas desenvolvedores</p>
                    </div>
                </div>
                <div className="text-xs font-mono text-red-400 bg-white dark:bg-slate-800 px-2 py-1 rounded border border-red-100">Action Blocked</div>
            </div>

        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
