// src/pages/ImportData.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { db } from '../services/firebase';
import { collection, writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { 
  UploadCloud, FileSpreadsheet, FileJson, AlertTriangle, Check, ArrowLeft, Save, 
  Users, Server, Layers, FolderGit2, Download, Code, Database
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

// --- TRADUTORES INTELIGENTES (PT-BR / EN / MAPPING) ---
const normalizeStatus = (status) => {
    if (!status) return 'Planejamento';
    const s = status.toLowerCase();
    
    // Mapeamento Projetos
    if (s.includes('desenvolvimento') || s.includes('andamento') || s.includes('development') || s.includes('progress')) return 'Em Andamento';
    if (s.includes('concluído') || s.includes('concluido') || s.includes('completed') || s.includes('done') || s.includes('stable')) return 'Concluído';
    if (s.includes('pausado') || s.includes('bloqueado') || s.includes('blocked')) return 'Pausado'; // Para projetos
    
    // Mapeamento Tarefas
    if (s.includes('a fazer') || s.includes('todo') || s.includes('waiting')) return 'A Fazer';
    if (s.includes('revisão') || s.includes('review') || s.includes('bloqueado')) return 'Revisão'; // Bloqueado em tarefa vira Revisão

    return 'Planejamento';
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
    if (s.includes('logística') || s.includes('logistics') || s.includes('inventário')) return 'Inventário';
    if (s.includes('auditoria') || s.includes('audit')) return 'Auditoria';
    if (s.includes('levantamento')) return 'Levantamento';
    return 'Geral';
};

const ImportData = () => {
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState('assets');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
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

  // --- PROCESSADOR DE JSON COMPLEXO (MIGRATION) ---
  const processComplexJson = (json) => {
    const mixedData = [];
    const meta = json.meta || json.system_metadata || {}; 

    // 1. PROJETOS (Aceita chaves em PT ou EN)
    const rawProjects = json.projetos || json.projects || [];
    if (Array.isArray(rawProjects)) {
        rawProjects.forEach(p => {
            // Normaliza arrays de strings (ex: lideres: ["A", "B"]) para string única
            const leaderStr = Array.isArray(p.lideres) ? p.lideres.join(', ') : (p.lideres || p.leader || meta.responsavel_importacao || '');
            
            // Combina entregas e artefatos para o changelog
            const changes = [...(p.entregas || []), ...(p.artefatos || []), ...(p.changelog || [])];

            mixedData.push({
                _collection: 'projects',
                name: p.nome || p.title || 'Projeto Sem Nome',
                description: p.descricao || p.description || '',
                status: normalizeStatus(p.status),
                priority: normalizePriority(p.prioridade || p.priority),
                leader: leaderStr,
                version: p.versao_atual || p.versao || p.version || '1.0',
                deadline: p.data_conclusao || p.completion_date || '',
                changelog: changes, // Salva o array de histórico
                progress: (p.status?.toLowerCase().includes('conclu') || p.status === 'Completed') ? 100 : 50,
                createdAt: p.data_inicio ? new Date(p.data_inicio) : serverTimestamp()
            });
        });
    }

    // 2. TAREFAS
    const rawTasks = json.tarefas_recentes || json.recent_tasks || [];
    if (Array.isArray(rawTasks)) {
        rawTasks.forEach(t => {
            // Se tiver ativo relacionado, adiciona na descrição
            let fullDesc = t.descricao || t.description || '';
            if (t.ativo_relacionado || t.asset_id) {
                fullDesc += `\n\n[Ativo Relacionado: ${t.ativo_relacionado || t.asset_id}]`;
            }

            mixedData.push({
                _collection: 'tasks',
                title: t.titulo || t.title || 'Tarefa',
                description: fullDesc,
                status: normalizeStatus(t.status), // "Bloqueado" vira "Revisão"
                priority: 'Média', // JSON não tem prioridade na tarefa, assume média
                category: normalizeCategory(t.tipo || t.category),
                projectId: '', // Sem vínculo direto por enquanto
                createdAt: t.data_registro ? new Date(t.data_registro) : serverTimestamp()
            });
        });
    }

    if (mixedData.length > 0) {
        setIsMixedMode(true);
        setData(mixedData);
        setSuccess(`Arquivo de Migração Detectado! ${mixedData.length} registros encontrados.`);
    } else {
        setError("JSON não contém dados de 'projetos' ou 'tarefas_recentes'.");
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setError('');
    setSuccess('');
    setData([]);

    const reader = new FileReader();

    if (file.name.toLowerCase().endsWith('.json')) {
      reader.onload = (evt) => {
        try {
          const json = JSON.parse(evt.target.result);
          // Detecta se é o formato de migração (tem chaves específicas)
          if (!Array.isArray(json) && (json.projetos || json.projects || json.tarefas_recentes || json.meta)) {
              processComplexJson(json);
          } else if (Array.isArray(json)) {
              // Array simples: trata como importação do tipo selecionado
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
    } 
    else {
      // EXCEL (Mantido)
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
        } catch (err) {
          setError("Erro ao ler Excel.");
        }
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
        // Remove a chave auxiliar antes de salvar
        const { _collection, ...itemToSave } = item;
        
        const docRef = doc(collection(db, targetCollection)); 
        batch.set(docRef, itemToSave);
      });

      await batch.commit();
      
      setSuccess("Importação concluída com sucesso!");
      setTimeout(() => { setSuccess(''); setData([]); setIsMixedMode(false); }, 2500);
    } catch (err) {
      console.error(err);
      setError("Erro ao gravar no banco de dados.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto pb-24">
      
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => navigate('/')} className="p-2 bg-white rounded-full hover:bg-gray-100 shadow-sm border border-gray-200">
            <ArrowLeft size={20} />
        </button>
        <div>
            <h1 className="text-xl md:text-2xl font-black text-gray-900 flex items-center gap-2">
                <UploadCloud className="text-shineray" /> Importação de Dados
            </h1>
            <p className="text-sm text-gray-500">Suporta Excel, JSON Simples e JSON de Migração</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* MENU LATERAL */}
          <div className={`lg:col-span-1 space-y-3 ${isMixedMode ? 'opacity-50 pointer-events-none' : ''}`}>
              <h3 className="font-bold text-gray-400 text-xs uppercase">Importação Manual</h3>
              {Object.entries(IMPORT_SCHEMAS).map(([key, schema]) => (
                  <button
                    key={key}
                    onClick={() => { setSelectedType(key); setData([]); setError(''); }}
                    className={`w-full p-4 rounded-xl border flex items-center gap-3 transition-all text-left ${
                        selectedType === key 
                        ? 'border-black bg-black text-white shadow-lg scale-105' 
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
                    }`}
                  >
                      {schema.icon}
                      <span className="font-bold text-sm">{schema.label}</span>
                  </button>
              ))}
              <button onClick={handleDownloadTemplate} className="w-full py-2 mt-4 text-xs font-bold text-blue-600 flex items-center justify-center gap-2 border border-dashed border-blue-300 rounded-lg hover:bg-blue-50">
                  <Download size={14}/> Template Excel
              </button>
          </div>

          {/* ÁREA DE UPLOAD */}
          <div className="lg:col-span-2">
              <h3 className="font-bold text-gray-400 text-xs uppercase mb-3">Arquivo</h3>
              
              <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:bg-gray-50 transition-colors relative flex flex-col items-center justify-center min-h-[200px]">
                    <input 
                        type="file" 
                        accept=".xlsx, .xls, .csv, .json" 
                        onChange={handleFileUpload} 
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="pointer-events-none space-y-2">
                        <div className="flex justify-center gap-2 text-gray-300">
                           {isMixedMode ? <Database size={40} className="text-blue-500 animate-bounce"/> : <FileSpreadsheet size={40} />}
                           <FileJson size={40} />
                        </div>
                        <p className="font-bold text-gray-600">Arraste seu arquivo aqui</p>
                        <p className="text-xs text-gray-400">
                            {isMixedMode 
                             ? <span className="text-blue-600 font-bold bg-blue-50 px-2 py-1 rounded">MIGRAÇÃO DETECTADA</span> 
                             : <>Destino: <span className="font-bold text-black uppercase">{currentSchema.collection}</span></>}
                        </p>
                    </div>
              </div>

              {error && <div className="mt-4 p-4 bg-red-50 text-red-600 rounded-xl text-sm flex items-center gap-2 animate-in slide-in-from-top-2"><AlertTriangle size={18}/> {error}</div>}
              {success && <div className="mt-4 p-4 bg-green-50 text-green-700 rounded-xl text-sm flex items-center gap-2 animate-in slide-in-from-top-2 border border-green-200"><Check size={18}/> {success}</div>}

              {/* PREVIEW DA TABELA */}
              {data.length > 0 && (
                  <div className="mt-6 animate-in slide-in-from-bottom-2">
                      <div className="flex justify-between items-center mb-3">
                          <h3 className="font-bold text-gray-700 text-sm">Preview ({data.length})</h3>
                          <button onClick={handleImport} disabled={loading} className="bg-green-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-green-700 shadow-md flex items-center gap-2">
                              {loading ? 'Processando...' : <><Save size={16}/> Confirmar Importação</>}
                          </button>
                      </div>
                      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto max-h-[350px] custom-scrollbar">
                          <table className="w-full text-left text-xs">
                              <thead className="bg-gray-50 text-gray-500 font-bold uppercase sticky top-0">
                                  <tr>
                                      {isMixedMode && <th className="p-3 bg-blue-50 text-blue-800 border-b border-blue-100">Tipo</th>}
                                      {/* Mostra as primeiras 4 chaves dinamicamente */}
                                      {Object.keys(data[0]).filter(k => k !== '_collection' && k !== 'changelog').slice(0, 4).map(k => (
                                          <th key={k} className="p-3 border-b border-gray-200">{k}</th>
                                      ))}
                                  </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 font-mono text-gray-600">
                                  {data.map((row, idx) => (
                                      <tr key={idx} className="hover:bg-gray-50">
                                          {isMixedMode && (
                                              <td className="p-3 font-bold text-blue-600 border-r border-blue-50">
                                                  {row._collection === 'projects' ? 'PROJETO' : 'TAREFA'}
                                              </td>
                                          )}
                                          {Object.entries(row).filter(([k]) => k !== '_collection' && k !== 'changelog').slice(0, 4).map(([k, v], i) => (
                                              <td key={i} className="p-3 whitespace-nowrap">
                                                  {typeof v === 'object' ? '[Detalhes...]' : String(v).substring(0, 35)}
                                              </td>
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