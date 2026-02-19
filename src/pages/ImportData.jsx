// src/pages/ImportData.jsx
import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { db } from '../services/firebase';
import { collection, writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { 
  UploadCloud, FileSpreadsheet, FileJson, AlertTriangle, Check, ArrowLeft, Save, 
  Users, Server, Layers, FolderGit2, Download, Database, CheckCircle, Info, X, Play
} from 'lucide-react';

// --- SCHEMAS PARA IMPORTAÇÃO SIMPLES (EXCEL) ---
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
      owner: row['Usuario'] || '',
      createdAt: serverTimestamp()
    })
  },
  employees: {
    label: 'Funcionários',
    icon: <Users size={20}/>,
    description: 'Cadastre colaboradores para vincular aos ativos.',
    collection: 'employees',
    requiredCols: ['Nome', 'Email', 'Cargo'],
    optionalCols: ['Departamento'],
    transform: (row) => ({
      name: row['Nome'] || '',
      email: row['Email'] || '',
      role: row['Cargo'] || 'Analista',
      department: row['Departamento'] || 'TI',
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

// --- TRADUTORES INTELIGENTES ---
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

const ImportData = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  
  const [selectedType, setSelectedType] = useState('assets');
  const [data, setData] = useState([]);
  const [fileAnalysis, setFileAnalysis] = useState(null); // { filename, totalRows, missingCols: [], sample: [] }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notification, setNotification] = useState(null); 
  const [dragActive, setDragActive] = useState(false);
  
  const currentSchema = IMPORT_SCHEMAS[selectedType];

  const handleDownloadTemplate = () => {
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
      setData([]);

      const reader = new FileReader();
      
      // JSON HANDLER
      if (file.name.toLowerCase().endsWith('.json')) {
          reader.onload = (evt) => {
              try {
                  const json = JSON.parse(evt.target.result);
                  // Lógica simplificada para JSON: Assume array de objetos
                  const arrayData = Array.isArray(json) ? json : (json.data || []);
                  
                  if (arrayData.length === 0) throw new Error("JSON vazio ou formato inválido.");

                  // Adaptação simples para JSON (tenta usar as chaves do schema como lower case)
                  const sample = arrayData.slice(0, 3);
                  
                  setFileAnalysis({
                      filename: file.name,
                      type: 'JSON',
                      totalRows: arrayData.length,
                      valid: true,
                      missingCols: [], // JSON é mais flexível, deixamos passar
                      sample: sample,
                      rawData: arrayData
                  });

              } catch (err) { setError("Erro ao ler JSON: " + err.message); }
          };
          reader.readAsText(file);
      } 
      // EXCEL HANDLER
      else {
          reader.onload = (evt) => {
              try {
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
                      totalRows: rawData.length,
                      valid: validation.valid,
                      missingCols: validation.missing,
                      sample: rawData.slice(0, 3), // Primeiras 3 linhas para preview
                      rawData: rawData
                  });

              } catch (err) { setError("Erro ao ler Excel: " + err.message); }
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
    
    setLoading(true);
    try {
      const batch = writeBatch(db);
      const collectionRef = collection(db, currentSchema.collection);
      
      // Transforma os dados usando o Schema atual
      const formattedData = fileAnalysis.rawData.map(row => currentSchema.transform(row));
      
      // Firestore Batch Limit is 500. Vamos pegar os primeiros 490 para segurança neste exemplo simples. 
      // Para produção real, seria ideal chunking como no backupService.js
      const chunk = formattedData.slice(0, 490); 
      
      chunk.forEach(item => {
        const docRef = doc(collectionRef); // ID Auto-gerado
        batch.set(docRef, item);
      });

      await batch.commit();
      
      setNotification({ 
          type: 'success', 
          message: `${chunk.length} registros importados com sucesso em '${currentSchema.collection}'!` 
      });
      
      setFileAnalysis(null); // Limpa estado

      setTimeout(() => setNotification(null), 5000);

    } catch (err) {
      console.error(err);
      setError("Erro ao gravar no banco de dados. " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto pb-24 min-h-screen">
      
      {/* HEADER */}
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => navigate('/settings')} className="p-2 bg-white rounded-full hover:bg-gray-100 shadow-sm border border-gray-200 transition-colors">
            <ArrowLeft size={20} className="text-gray-600"/>
        </button>
        <div>
            <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
                Importação de Dados
            </h1>
            <p className="text-sm text-gray-500">Adicione registros em massa via Excel ou JSON</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* SIDEBAR - TIPO DE IMPORTAÇÃO */}
          <div className="lg:col-span-3 space-y-2">
              <h3 className="font-bold text-gray-400 text-[10px] uppercase tracking-wider mb-2 px-2">Selecione o Tipo</h3>
              {Object.entries(IMPORT_SCHEMAS).map(([key, schema]) => (
                  <button 
                    key={key} 
                    onClick={() => { setSelectedType(key); setFileAnalysis(null); setError(''); }} 
                    className={`w-full p-3 rounded-xl border flex items-center gap-3 transition-all text-left ${
                        selectedType === key 
                        ? 'border-black bg-black text-white shadow-lg shadow-gray-400/20' 
                        : 'border-transparent bg-white text-gray-600 hover:bg-gray-50 hover:text-black'
                    }`}
                  >
                      <div className={`${selectedType === key ? 'text-white' : 'text-gray-400 group-hover:text-black'}`}>{schema.icon}</div>
                      <div>
                          <span className="font-bold text-sm block">{schema.label}</span>
                      </div>
                  </button>
              ))}
          </div>

          {/* MAIN CONTENT */}
          <div className="lg:col-span-9 space-y-6">
              
              {/* GUIA DO FORMATO (CARD INFORMATIVO) */}
              <div className="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-sm">
                  <div>
                      <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        {currentSchema.icon} Importar {currentSchema.label}
                      </h2>
                      <p className="text-sm text-gray-500 mt-1">{currentSchema.description}</p>
                      
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                          <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded border border-gray-200 font-medium">Colunas Obrigatórias:</span>
                          {currentSchema.requiredCols.map(col => (
                              <span key={col} className="bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-100 font-bold font-mono">{col}</span>
                          ))}
                      </div>
                  </div>
                  <button 
                    onClick={handleDownloadTemplate} 
                    className="shrink-0 flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all shadow-sm"
                  >
                      <Download size={16}/> Baixar Modelo Excel
                  </button>
              </div>

              {/* ÁREA DE ANÁLISE / UPLOAD */}
              {fileAnalysis ? (
                  // ESTADO: ARQUIVO ANALISADO
                  <div className="bg-white rounded-2xl border border-blue-100 shadow-lg overflow-hidden animate-in zoom-in-95 duration-200">
                      <div className="bg-blue-50/50 p-4 border-b border-blue-100 flex justify-between items-center">
                          <div className="flex items-center gap-3">
                              <div className="p-2 bg-blue-100 text-blue-600 rounded-lg"><FileSpreadsheet size={24}/></div>
                              <div>
                                  <h3 className="font-bold text-blue-900">{fileAnalysis.filename}</h3>
                                  <p className="text-xs text-blue-600 font-medium">{fileAnalysis.totalRows} registros encontrados • Formato {fileAnalysis.type}</p>
                              </div>
                          </div>
                          <button onClick={() => setFileAnalysis(null)} className="p-2 hover:bg-blue-100 rounded-full text-blue-400 hover:text-blue-700"><X size={20}/></button>
                      </div>

                      <div className="p-6">
                          {fileAnalysis.valid ? (
                              <>
                                <div className="flex items-center gap-2 mb-4 text-green-700 bg-green-50 p-3 rounded-lg border border-green-100 text-sm">
                                    <CheckCircle size={18}/>
                                    <span className="font-bold">Validação aprovada!</span> Todas as colunas obrigatórias foram encontradas.
                                </div>
                                
                                <div className="mb-6">
                                    <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">Pré-visualização (Amostra)</h4>
                                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                                        <table className="w-full text-left text-xs">
                                            <thead className="bg-gray-50 text-gray-500 font-bold">
                                                <tr>
                                                    {Object.keys(fileAnalysis.sample[0] || {}).map(k => <th key={k} className="p-2 border-b">{k}</th>)}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 font-mono text-gray-600 bg-white">
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
                                    <button onClick={() => setFileAnalysis(null)} className="px-6 py-3 bg-gray-100 text-gray-600 font-bold rounded-xl hover:bg-gray-200">Cancelar</button>
                                    <button 
                                        onClick={confirmImport} 
                                        disabled={loading}
                                        className="px-6 py-3 bg-black text-white font-bold rounded-xl hover:bg-gray-800 shadow-lg flex items-center gap-2"
                                    >
                                        {loading ? 'Importando...' : <><Play size={18} fill="currentColor"/> Confirmar Importação</>}
                                    </button>
                                </div>
                              </>
                          ) : (
                              <div className="text-center py-8">
                                  <div className="inline-flex p-4 bg-red-100 text-red-600 rounded-full mb-4"><AlertTriangle size={32}/></div>
                                  <h3 className="font-bold text-xl text-gray-900 mb-2">Colunas Obrigatórias Ausentes</h3>
                                  <p className="text-gray-500 mb-6 max-w-md mx-auto">O arquivo não possui as seguintes colunas exigidas para <strong>{currentSchema.label}</strong>:</p>
                                  
                                  <div className="flex flex-wrap justify-center gap-2 mb-8">
                                      {fileAnalysis.missingCols.map(col => (
                                          <span key={col} className="bg-red-50 text-red-700 px-3 py-1 rounded border border-red-200 font-bold font-mono">{col}</span>
                                      ))}
                                  </div>

                                  <button onClick={() => setFileAnalysis(null)} className="text-sm font-bold text-gray-500 hover:text-black underline">Tentar outro arquivo</button>
                              </div>
                          )}
                      </div>
                  </div>
              ) : (
                  // ESTADO: DRAG & DROP
                  <div 
                    className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer group flex flex-col items-center justify-center min-h-[300px] ${
                        dragActive 
                        ? 'border-blue-500 bg-blue-50 scale-[1.01]' 
                        : 'border-gray-200 bg-white hover:border-gray-400 hover:bg-gray-50'
                    }`}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current.click()}
                  >
                      <input ref={fileInputRef} type="file" className="hidden" accept=".xlsx,.xls,.csv,.json" onChange={handleFileChange} />
                      
                      <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 transition-colors shadow-sm ${dragActive ? 'bg-blue-200 text-blue-600' : 'bg-gray-100 text-gray-400 group-hover:text-blue-600 group-hover:bg-white'}`}>
                          {dragActive ? <UploadCloud size={40} className="animate-bounce"/> : <FileSpreadsheet size={40}/>}
                      </div>
                      
                      <h3 className={`text-xl font-bold mb-2 transition-colors ${dragActive ? 'text-blue-800' : 'text-gray-700 group-hover:text-gray-900'}`}>
                          {dragActive ? 'Solte o arquivo agora' : 'Clique ou Arraste seu arquivo aqui'}
                      </h3>
                      <p className="text-gray-400 text-sm max-w-xs mx-auto mb-6">Suporta arquivos Excel (.xlsx) ou JSON. O sistema analisará a estrutura antes de importar.</p>
                      
                      {error && (
                          <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm font-bold flex items-center gap-2 animate-pulse">
                              <AlertTriangle size={16}/> {error}
                          </div>
                      )}
                  </div>
              )}
          </div>
      </div>

        {/* TOAST SUCCESS */}
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