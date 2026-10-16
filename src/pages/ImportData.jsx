// src/pages/ImportData.jsx
import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../services/firebase';
import { collection, writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { assertWithinLimit } from '../services/tenantService';
import { useConfirm } from '../components/ConfirmDialog';
import { 
  UploadCloud, FileSpreadsheet, AlertTriangle, ArrowLeft, 
  Users, Server, Layers, FolderGit2, Download, CheckCircle, X, Play
} from 'lucide-react';

// Dicionario de regras definindo a estrutura esperada e as colunas vitais para cada tipo de importacao
const IMPORT_SCHEMAS = {
  assets: {
    label: 'Ativos (Hardware)',
    icon: <Server size={20}/>,
    description: 'Importe notebooks, desktops e outros equipamentos.',
    collection: 'assets',
    requiredCols: ['Patrimonio', 'Modelo', 'Tipo', 'Status'],
    optionalCols: ['Local', 'Serial', 'Usuario'],
    transform: (row) => ({
      internalId: row['Patrimonio'] || row['Tag'] || '',
      model: row['Modelo'] || '',
      type: row['Tipo'] || 'Outros',
      status: row['Status'] || 'Disponível',
      location: row['Local'] || 'Matriz',
      serialNumber: row['Serial'] || '',
      assignedTo: row['Usuario'] || '',
      createdAt: serverTimestamp()
    })
  },
  employees: {
    label: 'Funcionários',
    icon: <Users size={20}/>,
    description: 'Cadastre colaboradores para vincular aos ativos.',
    collection: 'employees',
    requiredCols: ['Nome', 'Email', 'Cargo'],
    optionalCols: ['Setor', 'Departamento', 'Filial', 'Local'],
    transform: (row) => ({
      name: row['Nome'] || '',
      email: row['Email'] || '',
      role: row['Cargo'] || 'Analista',
      sector: row['Setor'] || row['Departamento'] || 'Geral',
      branch: row['Filial'] || row['Local'] || 'Matriz',
      status: 'Ativo',
      createdAt: serverTimestamp()
    })
  },
  projects: {
    label: 'Projetos',
    icon: <FolderGit2 size={20}/>,
    description: 'Importe projetos do Jira ou planilhas de controle.',
    collection: 'projects',
    requiredCols: ['Nome', 'Status'],
    optionalCols: ['Descricao', 'Prioridade', 'Lider', 'DataInicio'],
    transform: (row) => ({
      name: row['Nome'] || '',
      description: row['Descricao'] || '',
      status: normalizeStatus(row['Status']),
      priority: normalizePriority(row['Prioridade']),
      leader: row['Lider'] || '',
      version: '2.0',
      progress: 0,
      createdAt: row['DataInicio'] ? new Date(row['DataInicio']) : serverTimestamp()
    })
  },
  tasks: {
    label: 'Tarefas',
    icon: <Layers size={20}/>,
    description: 'Lista de tarefas legadas ou importadas de outras ferramentas.',
    collection: 'tasks',
    requiredCols: ['Titulo', 'Status'],
    optionalCols: ['Descricao', 'Prioridade', 'Categoria'],
    transform: (row) => ({
      title: row['Titulo'] || '',
      description: row['Descricao'] || '',
      status: normalizeStatus(row['Status']),
      priority: normalizePriority(row['Prioridade']),
      category: normalizeCategory(row['Categoria']),
      projectId: '',
      createdAt: serverTimestamp()
    })
  }
};

// Padronizam informacoes comuns digitadas de diversas formas pelo usuario na planilha
const normalizeStatus = (status) => {
    if (!status) return 'Planejamento';
    const s = String(status).toLowerCase();
    
    // Projetos
    if (s.includes('desenvolvimento') || s.includes('andamento') || s.includes('development') || s.includes('progress')) return 'Em Andamento';
    if (s.includes('concluído') || s.includes('concluido') || s.includes('completed') || s.includes('done') || s.includes('stable')) return 'Concluído';
    if (s.includes('pausado') || s.includes('bloqueado') || s.includes('blocked')) return 'Pausado';
    
    // Tarefas
    if (s.includes('a fazer') || s.includes('todo') || s.includes('waiting')) return 'A Fazer';
    if (s.includes('revisão') || s.includes('review')) return 'Revisão';

    return 'Planejamento'; 
};

const normalizePriority = (p) => {
    if (!p) return 'Média';
    const s = String(p).toLowerCase();
    if (s.includes('crítica') || s.includes('critical')) return 'Crítica';
    if (s.includes('alta') || s.includes('high')) return 'Alta';
    if (s.includes('baixa') || s.includes('low')) return 'Baixa';
    return 'Média';
};

const normalizeCategory = (cat) => {
    if (!cat) return 'Geral';
    const s = String(cat).toLowerCase();
    if (s.includes('manutenção') || s.includes('maintenance')) return 'Manutenção';
    if (s.includes('inventário') || s.includes('inventory')) return 'Inventário';
    if (s.includes('auditoria') || s.includes('audit')) return 'Auditoria';
    return 'Geral';
};

const isSystemFormat = (row, type) => {
  if (!row || typeof row !== 'object') return false;
  if (type === 'assets') return 'internalId' in row || 'model' in row;
  if (type === 'employees') return 'name' in row || 'role' in row || 'sector' in row;
  if (type === 'projects') return 'name' in row && ('status' in row || 'priority' in row || 'leader' in row);
  if (type === 'tasks') return 'title' in row;
  return false;
};

const transformSystemRow = (row, type, tenantId) => {
  if (type === 'assets') {
    return {
      internalId: String(row.internalId || row.tag || '').trim(),
      model: row.model || '',
      type: row.type || 'Outros',
      status: row.status || 'Disponível',
      location: row.location || 'Matriz',
      serialNumber: row.serialNumber || '',
      assignedTo: row.assignedTo || '',
      ...row,
      tenantId
    };
  }
  if (type === 'employees') {
    return {
      name: row.name || '',
      email: row.email || '',
      role: row.role || 'Analista',
      sector: row.sector || row.department || 'Geral',
      branch: row.branch || row.location || 'Matriz',
      status: row.status || 'Ativo',
      ...row,
      tenantId
    };
  }
  if (type === 'projects') {
    return {
      name: row.name || '',
      description: row.description || '',
      status: normalizeStatus(row.status),
      priority: normalizePriority(row.priority),
      leader: row.leader || '',
      version: row.version || '2.0',
      progress: typeof row.progress === 'number' ? row.progress : 0,
      ...row,
      tenantId
    };
  }
  if (type === 'tasks') {
    return {
      title: row.title || '',
      description: row.description || '',
      status: normalizeStatus(row.status),
      priority: normalizePriority(row.priority),
      category: normalizeCategory(row.category),
      projectId: row.projectId || '',
      ...row,
      tenantId
    };
  }
  return { ...row, tenantId };
};

const ImportData = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const confirm = useConfirm();
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId;
  
  const [selectedType, setSelectedType] = useState('assets');
  const [fileAnalysis, setFileAnalysis] = useState(null); // { filename, totalRows, missingCols: [], sample: [] }
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [error, setError] = useState('');
  const [notification, setNotification] = useState(null); 
  const [dragActive, setDragActive] = useState(false);
  
  const currentSchema = IMPORT_SCHEMAS[selectedType];

  const resetFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDownloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const templateRow = {};
    currentSchema.requiredCols.forEach(col => templateRow[col] = `(Obrigatório)`);
    currentSchema.optionalCols.forEach(col => templateRow[col] = `(Opcional)`);
    
    const ws = XLSX.utils.json_to_sheet([templateRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, `Modelo_Importacao_${selectedType}.xlsx`);
  };

  const validateHeaders = (rows) => {
      if (!rows || rows.length === 0) return { valid: false, missing: [] };
      const headers = Object.keys(rows[0]);
      const missing = currentSchema.requiredCols.filter(req => !headers.includes(req));
      return { valid: missing.length === 0, missing };
  };

  const processFile = (file) => {
      setError('');
      setFileAnalysis(null);

      const reader = new FileReader();
      
      // Leitura e mapeamento de arquivos diretos em formato de maquina (JSON)
      if (file.name.toLowerCase().endsWith('.json')) {
          reader.onload = (evt) => {
              try {
                  const json = JSON.parse(evt.target.result);
                  const arrayData = Array.isArray(json) ? json : (json.data || []);
                  
                  if (arrayData.length === 0) throw new Error("JSON vazio ou formato inválido.");

                  const isDirect = isSystemFormat(arrayData[0], selectedType);
                  const sample = arrayData.slice(0, 3);
                  
                  setFileAnalysis({
                      filename: file.name,
                      type: 'JSON',
                      isSystemJson: isDirect,
                      totalRows: arrayData.length,
                      valid: true,
                      missingCols: [],
                      sample: sample,
                      rawData: arrayData
                  });

              } catch (err) { setError("Erro ao ler JSON: " + err.message); }
              resetFileInput();
          };
          reader.readAsText(file);
      } 
      // Leitura da tipica planilha comercial originaria de humanos e setores administrativos
      else {
          reader.onload = async (evt) => {
              try {
                  const XLSX = await import("xlsx");
                  const bstr = evt.target.result;
                  const wb = XLSX.read(bstr, { type: 'binary' });
                  const wsname = wb.SheetNames[0];
                  const ws = wb.Sheets[wsname];
                  const rawData = XLSX.utils.sheet_to_json(ws);
                  
                  if (rawData.length === 0) throw new Error("Arquivo Excel vazio.");

                  const validation = validateHeaders(rawData);
                  
                  setFileAnalysis({
                      filename: file.name,
                      type: 'Excel',
                      isSystemJson: false,
                      totalRows: rawData.length,
                      valid: validation.valid,
                      missingCols: validation.missing,
                      sample: rawData.slice(0, 3),
                      rawData: rawData
                  });

              } catch (err) { setError("Erro ao ler Excel: " + err.message); }
              resetFileInput();
          };
          reader.readAsBinaryString(file);
      }
  };

  const handleDrag = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) processFile(e.target.files[0]);
  };

  const confirmImport = async () => {
    if (!fileAnalysis || !fileAnalysis.rawData) return;
    if (!tenantId) {
      setError("Inquilino não identificado. Por favor, faça login novamente.");
      return;
    }

    const isSystem = fileAnalysis.isSystemJson;
    const formattedData = fileAnalysis.rawData.map(row => {
      if (isSystem) {
        return transformSystemRow(row, selectedType, tenantId);
      }
      return {
        ...currentSchema.transform(row),
        tenantId
      };
    });

    const confirmed = await confirm({
      title: 'Confirmar Importação',
      message: `Deseja importar ${formattedData.length} registro(s) em '${currentSchema.label}'?`,
      confirmLabel: 'Importar'
    });
    if (!confirmed) return;
    
    setLoading(true);
    setError('');
    let written = 0;
    try {
      const collectionRef = collection(db, currentSchema.collection);
      const historyCollectionRef = collection(db, 'history');

      // Ativos contam no limite do plano da empresa
      if (currentSchema.collection === 'assets') {
        await assertWithinLimit(currentUser, 'assets', formattedData.length);
      }

      // Lotes de operacoes no Firestore (maximo 500 por batch).
      // Para ativos: cada ativo grava 2 docs (ativo + historico), portanto lote de 200 itens = 400 ops <= 450.
      // Para outras colecoes: lote de 400 itens = 400 ops <= 450.
      const isAssetCollection = currentSchema.collection === 'assets';
      const CHUNK = isAssetCollection ? 200 : 400;

      setProgress({ done: 0, total: formattedData.length });
      for (let i = 0; i < formattedData.length; i += CHUNK) {
        const batch = writeBatch(db);
        const chunkItems = formattedData.slice(i, i + CHUNK);
        
        chunkItems.forEach(item => {
          const docRef = doc(collectionRef);
          if (isAssetCollection) {
            batch.set(docRef, {
              ...item,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
            const historyRef = doc(historyCollectionRef);
            batch.set(historyRef, {
              assetId: docRef.id,
              tenantId,
              type: 'creation',
              action: 'Ativo Criado',
              date: serverTimestamp(),
              user: currentUser?.name || currentUser?.email || 'Sistema',
              details: 'Importação em massa via planilha/JSON.'
            });
          } else {
            batch.set(docRef, item);
          }
        });
        await batch.commit();
        written = Math.min(i + CHUNK, formattedData.length);
        setProgress({ done: written, total: formattedData.length });
      }

      setNotification({
          type: 'success',
          message: `${formattedData.length} registros importados com sucesso em '${currentSchema.label}'!`
      });

      setFileAnalysis(null);
      resetFileInput();

      setTimeout(() => setNotification(null), 5000);

    } catch (err) {
      console.error(err);
      setError(
        (err?.message?.startsWith('Limite') || err?.message?.startsWith('O plano'))
          ? err.message
          : `Erro ao gravar no banco de dados${written ? ` (${written} registros já foram gravados)` : ''}. ${err.message}`
      );
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto pb-24 min-h-screen">
      
      {/* Titulo da ferramenta */}
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => navigate('/settings')} className="p-2 bg-white dark:bg-slate-800 rounded-full hover:bg-gray-100 dark:hover:bg-slate-700 shadow-sm border border-gray-200 dark:border-slate-600 transition-colors">
            <ArrowLeft size={20} className="text-gray-600 dark:text-gray-300"/>
        </button>
        <div>
            <h1 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                Importação de Dados
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Adicione registros em massa via Excel ou JSON</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Menu lateral de tipos */}
          <div className="lg:col-span-3 space-y-2">
              <h3 className="font-bold text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-wider mb-2 px-2">Selecione o Tipo</h3>
              {Object.entries(IMPORT_SCHEMAS).map(([key, schema]) => (
                  <button 
                    key={key} 
                    onClick={() => { setSelectedType(key); setFileAnalysis(null); setError(''); resetFileInput(); }} 
                    className={`w-full p-3 rounded-xl border flex items-center gap-3 transition-all text-left ${
                        selectedType === key 
                        ? 'border-black bg-black text-white dark:border-indigo-500 dark:bg-indigo-600 shadow-lg shadow-gray-400/20' 
                        : 'border-transparent bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 hover:text-black dark:hover:text-white'
                    }`}
                  >
                      <div className={`${selectedType === key ? 'text-white' : 'text-gray-400 dark:text-gray-500 group-hover:text-black dark:group-hover:text-white'}`}>{schema.icon}</div>
                      <div>
                          <span className="font-bold text-sm block">{schema.label}</span>
                      </div>
                  </button>
              ))}
          </div>

          {/* Caixa central maior */}
          <div className="lg:col-span-9 space-y-6">
              
              {/* Manual de instrucoes minimo */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-sm">
                  <div>
                      <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        {currentSchema.icon} Importar {currentSchema.label}
                      </h2>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{currentSchema.description}</p>
                      
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                          <span className="bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded border border-gray-200 dark:border-slate-600 font-medium">Colunas Obrigatórias:</span>
                          {currentSchema.requiredCols.map(col => (
                              <span key={col} className="bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 px-2 py-1 rounded border border-blue-100 dark:border-blue-900/50 font-bold font-mono">{col}</span>
                          ))}
                      </div>
                  </div>
                  <button 
                    onClick={handleDownloadTemplate} 
                    className="shrink-0 flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 hover:border-gray-400 transition-all shadow-sm"
                  >
                      <Download size={16}/> Baixar Modelo Excel
                  </button>
              </div>

              {/* Quadros dinamicos */}
              {fileAnalysis ? (
                  <div className="bg-white dark:bg-slate-800 rounded-2xl border border-blue-100 dark:border-slate-700 shadow-lg overflow-hidden animate-in zoom-in-95 duration-200">
                      <div className="bg-blue-50/50 dark:bg-slate-900/60 p-4 border-b border-blue-100 dark:border-slate-700 flex justify-between items-center">
                          <div className="flex items-center gap-3">
                              <div className="p-2 bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 rounded-lg"><FileSpreadsheet size={24}/></div>
                              <div>
                                  <h3 className="font-bold text-blue-900 dark:text-blue-200">{fileAnalysis.filename}</h3>
                                  <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">{fileAnalysis.totalRows} registros encontrados • Formato {fileAnalysis.type}{fileAnalysis.isSystemJson ? ' (Schema Nativo)' : ''}</p>
                              </div>
                          </div>
                          <button onClick={() => { setFileAnalysis(null); resetFileInput(); }} className="p-2 hover:bg-blue-100 dark:hover:bg-slate-700 rounded-full text-blue-400 hover:text-blue-700 dark:hover:text-blue-200"><X size={20}/></button>
                      </div>

                      <div className="p-6">
                          {fileAnalysis.valid ? (
                              <>
                                <div className="flex items-center gap-2 mb-4 text-green-700 dark:text-emerald-300 bg-green-50 dark:bg-emerald-950/30 p-3 rounded-lg border border-green-100 dark:border-emerald-900/50 text-sm">
                                    <CheckCircle size={18}/>
                                    <span className="font-bold">Validação aprovada!</span> Todas as colunas obrigatórias foram encontradas.
                                </div>
                                
                                <div className="mb-6">
                                    <h4 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-2">Pré-visualização (Amostra)</h4>
                                    <div className="overflow-x-auto border border-gray-200 dark:border-slate-700 rounded-lg">
                                        <table className="w-full text-left text-xs">
                                            <thead className="bg-gray-50 dark:bg-slate-900 text-gray-500 dark:text-gray-400 font-bold">
                                                <tr>
                                                    {Object.keys(fileAnalysis.sample[0] || {}).map(k => <th key={k} className="p-2 border-b dark:border-slate-700">{k}</th>)}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 dark:divide-slate-700 font-mono text-gray-600 dark:text-gray-300 bg-white dark:bg-slate-800">
                                                {fileAnalysis.sample.map((row, i) => (
                                                    <tr key={i}>
                                                        {Object.values(row).map((v, j) => <td key={j} className="p-2 whitespace-nowrap">{String(v)}</td>)}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                <div className="flex justify-end gap-3">
                                    <button onClick={() => { setFileAnalysis(null); resetFileInput(); }} disabled={loading} className="px-6 py-3 bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-200 font-bold rounded-xl hover:bg-gray-200 dark:hover:bg-slate-600 disabled:opacity-50">Cancelar</button>
                                    <button 
                                        onClick={confirmImport} 
                                        disabled={loading}
                                        className="px-6 py-3 bg-black text-white dark:bg-white dark:text-slate-900 font-bold rounded-xl hover:bg-gray-800 dark:hover:bg-gray-100 shadow-lg flex items-center gap-2 disabled:opacity-60"
                                    >
                                        {loading ? (progress ? `Importando ${progress.done}/${progress.total}...` : 'Importando...') : <><Play size={18} fill="currentColor"/> Confirmar Importação</>}
                                    </button>
                                </div>
                              </>
                          ) : (
                              <div className="text-center py-8">
                                  <div className="inline-flex p-4 bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-full mb-4"><AlertTriangle size={32}/></div>
                                  <h3 className="font-bold text-xl text-gray-900 dark:text-white mb-2">Colunas Obrigatórias Ausentes</h3>
                                  <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">O arquivo não possui as seguintes colunas exigidas para <strong>{currentSchema.label}</strong>:</p>
                                  
                                  <div className="flex flex-wrap justify-center gap-2 mb-8">
                                      {fileAnalysis.missingCols.map(col => (
                                          <span key={col} className="bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 px-3 py-1 rounded border border-red-200 dark:border-red-900/50 font-bold font-mono">{col}</span>
                                      ))}
                                  </div>

                                  <button onClick={() => { setFileAnalysis(null); resetFileInput(); }} className="text-sm font-bold text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white underline">Tentar outro arquivo</button>
                              </div>
                          )}
                      </div>
                  </div>
              ) : (
                  <div 
                    className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer group flex flex-col items-center justify-center min-h-[300px] ${
                        dragActive 
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-400 scale-[1.01]' 
                        : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-gray-400 dark:hover:border-slate-500 hover:bg-gray-50 dark:hover:bg-slate-750'
                    }`}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                      <input ref={fileInputRef} type="file" className="hidden" accept=".xlsx,.xls,.csv,.json" onChange={handleFileChange} />
                      
                      <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 transition-colors shadow-sm ${dragActive ? 'bg-blue-200 dark:bg-blue-900 text-blue-600 dark:text-blue-300' : 'bg-gray-100 dark:bg-slate-700 text-gray-400 dark:text-gray-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:bg-white dark:group-hover:bg-slate-800'}`}>
                          {dragActive ? <UploadCloud size={40} className="animate-bounce"/> : <FileSpreadsheet size={40}/>}
                      </div>
                      
                      <h3 className={`text-xl font-bold mb-2 transition-colors ${dragActive ? 'text-blue-800 dark:text-blue-200' : 'text-gray-700 dark:text-gray-200 group-hover:text-gray-900 dark:group-hover:text-white'}`}>
                          {dragActive ? 'Solte o arquivo agora' : 'Clique ou Arraste seu arquivo aqui'}
                      </h3>
                      <p className="text-gray-400 dark:text-gray-500 text-sm max-w-xs mx-auto mb-6">Suporta arquivos Excel (.xlsx) ou JSON. O sistema analisará a estrutura antes de importar.</p>
                      
                      {error && (
                          <div className="mt-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-300 rounded-lg text-sm font-bold flex items-center gap-2 animate-pulse">
                              <AlertTriangle size={16}/> {error}
                          </div>
                      )}
                  </div>
              )}
          </div>
      </div>

        {/* Alerta de sucesso */}
        {notification && (
          <div className="fixed bottom-8 right-8 z-50 animate-in slide-in-from-right duration-500 fade-in bg-green-600 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3">
              <CheckCircle size={24} className="text-green-200"/>
              <div>
                  <h4 className="font-bold">Sucesso!</h4>
                  <p className="text-sm text-green-100">{notification.message}</p>
              </div>
          </div>
        )}
    </div>
  );
};

export default ImportData;