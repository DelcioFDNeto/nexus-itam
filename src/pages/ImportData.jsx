// src/pages/ImportData.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { db } from '../services/firebase';
import { collection, writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { 
  UploadCloud, FileSpreadsheet, FileJson, AlertTriangle, Check, ArrowLeft, Save, 
  Users, Server, Layers, FolderGit2, Download, Database, CheckCircle
} from 'lucide-react';

// --- SCHEMAS PARA IMPORTAÇÃO SIMPLES (EXCEL) ---
const IMPORT_SCHEMAS = {
  assets: {
    label: 'Ativos (Hardware)',
    icon: <Server size={24}/>,
    collection: 'assets',
    requiredCols: ['Patrimonio', 'Modelo'],
    transform: (row) => ({
      internalId: row['Patrimonio'] || row['Tag'] || '',
      model: row['Modelo'] || '',
      type: row['Tipo'] || 'Outros',
      status: row['Status'] || 'Disponível',
      location: row['Local'] || 'Matriz',
      serialNumber: row['Serial'] || '',
      createdAt: serverTimestamp()
    })
  },
  employees: {
    label: 'Funcionários',
    icon: <Users size={24}/>,
    collection: 'employees',
    requiredCols: ['Nome', 'Email'],
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
    icon: <FolderGit2 size={24}/>,
    collection: 'projects',
    requiredCols: ['Nome', 'Status'],
    transform: (row) => ({
      name: row['Nome'] || '',
      description: row['Descricao'] || '',
      status: row['Status'] || 'Planejamento',
      priority: row['Prioridade'] || 'Média',
      leader: row['Lider'] || '',
      version: row['Versao'] || '1.0',
      progress: 0,
      createdAt: serverTimestamp()
    })
  },
  tasks: {
    label: 'Tarefas',
    icon: <Layers size={24}/>,
    collection: 'tasks',
    requiredCols: ['Titulo', 'Status'],
    transform: (row) => ({
      title: row['Titulo'] || '',
      description: row['Descricao'] || '',
      status: row['Status'] || 'A Fazer',
      priority: row['Prioridade'] || 'Média',
      category: row['Categoria'] || 'Geral',
      projectId: '',
      createdAt: serverTimestamp()
    })
  }
};

// --- TRADUTORES INTELIGENTES ---
const normalizeStatus = (status) => {
    if (!status) return 'Planejamento';
    const s = status.toLowerCase();
    
    // Projetos
    if (s.includes('desenvolvimento') || s.includes('andamento') || s.includes('development') || s.includes('progress')) return 'Em Andamento';
    if (s.includes('concluído') || s.includes('concluido') || s.includes('completed') || s.includes('done') || s.includes('stable')) return 'Concluído';
    if (s.includes('pausado') || s.includes('bloqueado') || s.includes('blocked')) return 'Pausado';
    
    // Tarefas
    if (s.includes('a fazer') || s.includes('todo') || s.includes('waiting')) return 'A Fazer';
    if (s.includes('revisão') || s.includes('review')) return 'Revisão';

    return 'Planejamento'; // Default seguro
};

const normalizePriority = (p) => {
    if (!p) return 'Média';
    const s = p.toLowerCase();
    if (s.includes('crítica') || s.includes('critical')) return 'Crítica';
    if (s.includes('alta') || s.includes('high')) return 'Alta';
    if (s.includes('baixa') || s.includes('low')) return 'Baixa';
    return 'Média';
};

const normalizeCategory = (cat) => {
    if (!cat) return 'Geral';
    const s = cat.toLowerCase();
    if (s.includes('manutenção') || s.includes('maintenance') || s.includes('upgrade')) return 'Manutenção';
    if (s.includes('logística') || s.includes('logistics') || s.includes('inventário') || s.includes('inventory')) return 'Inventário';
    if (s.includes('auditoria') || s.includes('audit')) return 'Auditoria';
    if (s.includes('levantamento') || s.includes('survey')) return 'Levantamento';
    return 'Geral';
};

const ImportData = () => {
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState('assets');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Notificação Visual (Toast)
  const [notification, setNotification] = useState(null); 
  
  const [isMixedMode, setIsMixedMode] = useState(false);

  const currentSchema = IMPORT_SCHEMAS[selectedType];

  const handleDownloadTemplate = () => {
    const templateRow = {};
    currentSchema.requiredCols.forEach(col => templateRow[col] = `(Exemplo)`);
    const ws = XLSX.utils.json_to_sheet([templateRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, `Modelo_${selectedType}.xlsx`);
  };

  // --- PROCESSAMENTO INTELIGENTE (MISTO) ---
  const processComplexJson = (json) => {
    const mixedData = [];
    const meta = json.meta || json.system_metadata || json.import_metadata || {}; 

    // 1. DETECÇÃO DE PROJETOS (Migration JSON)
    const rawProjects = json.projetos || json.projects || [];
    if (Array.isArray(rawProjects)) {
        rawProjects.forEach(p => {
            const leaderStr = Array.isArray(p.lideres) ? p.lideres.join(', ') : (p.lideres || p.leader || meta.responsavel_importacao || '');
            const rawChanges = [...(p.entregas || []), ...(p.artefatos || []), ...(p.changelog || [])];
            
            // Sanitiza Changelog para evitar erro de objeto
            const safeChangelog = rawChanges.map(item => {
                if (typeof item === 'object') return item.version ? `v${item.version}: ${item.notes || ''}` : JSON.stringify(item);
                return String(item);
            });

            mixedData.push({
                _collection: 'projects',
                name: p.nome || p.title || 'Projeto Sem Nome',
                description: p.descricao || p.description || '',
                status: normalizeStatus(p.status),
                priority: normalizePriority(p.prioridade || p.priority),
                leader: leaderStr,
                version: p.versao_atual || p.versao || p.version || '1.0',
                deadline: p.data_conclusao || p.completion_date || '',
                changelog: safeChangelog,
                progress: (p.status?.toLowerCase().includes('conclu') || p.status === 'Completed') ? 100 : 50,
                createdAt: p.data_inicio ? new Date(p.data_inicio) : serverTimestamp()
            });
        });
    }

    // 2. DETECÇÃO DE TAREFAS (Migration JSON + Legacy Tasks JSON)
    // Aceita 'tarefas_recentes', 'recent_tasks' OU 'tasks' (seu novo arquivo)
    const rawTasks = json.tarefas_recentes || json.recent_tasks || json.tasks || [];
    
    if (Array.isArray(rawTasks)) {
        rawTasks.forEach(t => {
            // Concatena informações úteis na descrição para não perder dados do Excel antigo
            let fullDesc = t.descricao || t.description || t.notes || ''; // 'notes' do seu novo arquivo
            const extras = [];
            
            if (t.ativo_relacionado || t.asset_id) extras.push(`Ativo: ${t.ativo_relacionado || t.asset_id}`);
            if (t.id) extras.push(`ID Legado: ${t.id}`);
            if (t.responsible) extras.push(`Responsável Origem: ${t.responsible}`);
            
            if (extras.length > 0) fullDesc += `\n\n[${extras.join(' | ')}]`;

            mixedData.push({
                _collection: 'tasks',
                title: t.titulo || t.title || 'Tarefa Importada',
                description: fullDesc,
                status: normalizeStatus(t.status),
                priority: 'Média',
                // Mapeia 'section' (do novo arquivo) ou 'tipo'/'category' para nossas categorias
                category: normalizeCategory(t.section || t.tipo || t.category),
                projectId: '',
                // Mapeia 'start_date' (do novo arquivo) ou 'data_registro'
                createdAt: (t.start_date || t.data_registro) ? new Date(t.start_date || t.data_registro) : serverTimestamp()
            });
        });
    }

    if (mixedData.length > 0) {
        setIsMixedMode(true);
        setData(mixedData);
        setNotification({ type: 'info', message: `Arquivo reconhecido! ${mixedData.length} registros (Projetos/Tarefas).` });
    } else {
        setError("O arquivo JSON não contém chaves de dados conhecidas (projects, tasks, etc).");
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setError('');
    setNotification(null);
    setData([]);

    const reader = new FileReader();

    if (file.name.toLowerCase().endsWith('.json')) {
      reader.onload = (evt) => {
        try {
          const json = JSON.parse(evt.target.result);
          // Verifica se é Array puro ou Objeto Complexo
          const hasComplexKeys = !Array.isArray(json) && (
              json.projetos || json.projects || 
              json.tarefas_recentes || json.recent_tasks || 
              json.tasks || // <--- Suporte ao seu novo arquivo
              json.meta || json.import_metadata
          );

          if (hasComplexKeys) {
              processComplexJson(json);
          } else if (Array.isArray(json)) {
              setIsMixedMode(false);
              const formattedData = json.map(row => currentSchema.transform(row));
              setData(formattedData);
          } else {
              setError("Formato JSON desconhecido.");
          }
        } catch (err) {
          setError("Arquivo JSON corrompido.");
        }
      };
      reader.readAsText(file);
    } else {
      // EXCEL
      reader.onload = (evt) => {
        try {
          const bstr = evt.target.result;
          const wb = XLSX.read(bstr, { type: 'binary' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const rawData = XLSX.utils.sheet_to_json(ws);
          if (rawData.length === 0) throw new Error("Vazio");
          setIsMixedMode(false);
          const formattedData = rawData.map(row => currentSchema.transform(row));
          setData(formattedData);
        } catch (err) { setError("Erro ao ler Excel."); }
      };
      reader.readAsBinaryString(file);
    }
  };

  const handleImport = async () => {
    if (data.length === 0) return;
    setLoading(true);
    try {
      const batch = writeBatch(db);
      
      data.forEach(item => {
        const targetCollection = isMixedMode ? item._collection : currentSchema.collection;
        const { _collection, ...itemToSave } = item;
        const docRef = doc(collection(db, targetCollection)); 
        batch.set(docRef, itemToSave);
      });

      await batch.commit();
      
      setNotification({ type: 'success', message: `${data.length} registros importados com sucesso!` });
      
      setTimeout(() => { 
          setNotification(null); 
          setData([]); 
          setIsMixedMode(false); 
      }, 4000);

    } catch (err) {
      console.error(err);
      setError("Erro ao gravar no banco de dados.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto pb-24 relative">
      
      {/* TOAST NOTIFICATION */}
      {notification && (
          <div className={`fixed bottom-8 right-8 z-50 animate-in slide-in-from-right duration-300 flex items-center gap-4 px-6 py-4 rounded-2xl shadow-2xl border-2 ${
              notification.type === 'success' 
              ? 'bg-green-600 border-green-400 text-white' 
              : 'bg-blue-600 border-blue-400 text-white'
          }`}>
              {notification.type === 'success' ? <CheckCircle size={32} className="animate-bounce" /> : <Database size={32} />}
              <div>
                  <h4 className="font-black text-lg">{notification.type === 'success' ? 'Sucesso!' : 'Análise'}</h4>
                  <p className="font-medium text-white/90">{notification.message}</p>
              </div>
          </div>
      )}

      {/* HEADER */}
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => navigate('/')} className="p-2 bg-white rounded-full hover:bg-gray-100 shadow-sm border border-gray-200"><ArrowLeft size={20} /></button>
        <div>
            <h1 className="text-xl md:text-2xl font-black text-gray-900 flex items-center gap-2"><UploadCloud className="text-shineray" /> Importação de Dados</h1>
            <p className="text-sm text-gray-500">Excel (.xlsx) ou JSON (Migration/Legacy)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* MENU LATERAL */}
          <div className={`lg:col-span-1 space-y-3 ${isMixedMode ? 'opacity-50 pointer-events-none' : ''}`}>
              <h3 className="font-bold text-gray-400 text-xs uppercase">Importação Manual</h3>
              {Object.entries(IMPORT_SCHEMAS).map(([key, schema]) => (
                  <button key={key} onClick={() => { setSelectedType(key); setData([]); setError(''); }} className={`w-full p-4 rounded-xl border flex items-center gap-3 transition-all text-left ${selectedType === key ? 'border-black bg-black text-white shadow-lg' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'}`}>
                      {schema.icon} <span className="font-bold text-sm">{schema.label}</span>
                  </button>
              ))}
              <button onClick={handleDownloadTemplate} className="w-full py-2 mt-4 text-xs font-bold text-blue-600 flex items-center justify-center gap-2 border border-dashed border-blue-300 rounded-lg hover:bg-blue-50"><Download size={14}/> Template Excel</button>
          </div>

          {/* UPLOAD AREA */}
          <div className="lg:col-span-2">
              <h3 className="font-bold text-gray-400 text-xs uppercase mb-3">Upload</h3>
              <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:bg-gray-50 transition-colors relative flex flex-col items-center justify-center min-h-[200px]">
                    <input type="file" accept=".xlsx, .xls, .csv, .json" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"/>
                    <div className="pointer-events-none space-y-2">
                        <div className="flex justify-center gap-2 text-gray-300">
                           {isMixedMode ? <Database size={40} className="text-blue-500 animate-bounce"/> : <FileSpreadsheet size={40} />}
                           <FileJson size={40} />
                        </div>
                        <p className="font-bold text-gray-600">Arraste Excel ou JSON aqui</p>
                        <p className="text-xs text-gray-400">{isMixedMode ? <span className="text-blue-600 font-bold bg-blue-50 px-2 py-1 rounded">MIGRAÇÃO / LEGADO DETECTADO</span> : <>Destino: <span className="font-bold text-black uppercase">{currentSchema.collection}</span></>}</p>
                    </div>
              </div>

              {error && <div className="mt-4 p-4 bg-red-50 text-red-600 rounded-xl text-sm flex items-center gap-2"><AlertTriangle size={18}/> {error}</div>}
              
              {/* PREVIEW TABLE */}
              {data.length > 0 && (
                  <div className="mt-6 animate-in slide-in-from-bottom-2">
                      <div className="flex justify-between items-center mb-3">
                          <h3 className="font-bold text-gray-700 text-sm">Preview ({data.length})</h3>
                          <button onClick={handleImport} disabled={loading} className="bg-green-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-green-700 shadow-md flex items-center gap-2">
                              {loading ? 'Salvando...' : <><Save size={16}/> Confirmar Importação</>}
                          </button>
                      </div>
                      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto max-h-[350px] custom-scrollbar">
                          <table className="w-full text-left text-xs">
                              <thead className="bg-gray-50 text-gray-500 font-bold uppercase sticky top-0">
                                  <tr>
                                      {isMixedMode && <th className="p-3 bg-blue-50 text-blue-800 border-b border-blue-100">Tipo</th>}
                                      {Object.keys(data[0]).filter(k => k !== '_collection' && k !== 'changelog').slice(0, 4).map(k => <th key={k} className="p-3 border-b border-gray-200">{k}</th>)}
                                  </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 font-mono text-gray-600">
                                  {data.map((row, idx) => (
                                      <tr key={idx} className="hover:bg-gray-50">
                                          {isMixedMode && <td className="p-3 font-bold text-blue-600 border-r border-blue-50">{row._collection === 'projects' ? 'PROJETO' : 'TAREFA'}</td>}
                                          {Object.entries(row).filter(([k]) => k !== '_collection' && k !== 'changelog').slice(0, 4).map(([k, v], i) => (
                                              <td key={i} className="p-3 whitespace-nowrap">{typeof v === 'object' ? '...' : String(v).substring(0, 35)}</td>
                                          ))}
                                      </tr>
                                  ))}
                              </tbody>
                          </table>
                      </div>
                  </div>
              )}
          </div>
      </div>
    </div>
  );
};

export default ImportData;