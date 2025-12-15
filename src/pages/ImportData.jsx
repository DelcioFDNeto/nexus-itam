// src/pages/ImportData.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { db } from '../services/firebase';
import { collection, writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { 
  UploadCloud, FileSpreadsheet, AlertTriangle, Check, ArrowLeft, Save, 
  Users, Server, Layers, FolderGit2, Download
} from 'lucide-react';

// CONFIGURAÇÃO DOS TIPOS (SCHEMAS)
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

const ImportData = () => {
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState('assets');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const currentSchema = IMPORT_SCHEMAS[selectedType];

  const handleDownloadTemplate = () => {
    const templateRow = {};
    currentSchema.requiredCols.forEach(col => templateRow[col] = `(Exemplo)`);
    const ws = XLSX.utils.json_to_sheet([templateRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, `Modelo_${selectedType}.xlsx`);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError(''); setSuccess(''); setData([]);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rawData = XLSX.utils.sheet_to_json(ws);

        if (rawData.length === 0) { setError("Arquivo vazio."); return; }

        const firstRow = rawData[0];
        const missingCols = currentSchema.requiredCols.filter(col => !Object.keys(firstRow).includes(col));
        if (missingCols.length > 0) { setError(`Faltam colunas: ${missingCols.join(', ')}`); return; }
        
        setData(rawData.map(row => currentSchema.transform(row)));
      } catch (err) {
        console.error(err);
        setError("Erro ao ler arquivo. Use .xlsx");
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleImport = async () => {
    if (data.length === 0 || !confirm(`Importar ${data.length} itens?`)) return;
    setLoading(true);
    try {
      const batch = writeBatch(db);
      data.forEach(item => {
        const docRef = doc(collection(db, currentSchema.collection)); 
        batch.set(docRef, item);
      });
      await batch.commit();
      setSuccess(`${data.length} registros importados!`);
      setTimeout(() => { setSuccess(''); setData([]); }, 3000);
    } catch (err) {
      console.error(err);
      setError("Erro ao salvar no banco.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto pb-24">
      
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => navigate('/')} className="p-3 bg-white rounded-xl hover:bg-gray-100 shadow-sm border border-gray-200">
            <ArrowLeft size={20} />
        </button>
        <div>
            <h1 className="text-xl md:text-2xl font-black text-gray-900 flex items-center gap-2">
                <FileSpreadsheet className="text-shineray" /> Importação
            </h1>
            <p className="text-xs text-gray-500 font-bold uppercase">Excel (.xlsx)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* PAINEL ESQUERDO: SELEÇÃO */}
          <div className="lg:col-span-1 space-y-4">
              <h3 className="font-bold text-gray-400 uppercase text-[10px] tracking-widest">Selecione o Tipo</h3>
              <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
                  {Object.entries(IMPORT_SCHEMAS).map(([key, schema]) => (
                      <button
                        key={key}
                        onClick={() => { setSelectedType(key); setData([]); setError(''); }}
                        className={`p-3 rounded-xl border-2 flex flex-col lg:flex-row items-center lg:justify-start gap-2 transition-all ${
                            selectedType === key 
                            ? 'border-black bg-black text-white shadow-lg' 
                            : 'border-gray-100 bg-white text-gray-600 hover:border-gray-300'
                        }`}
                      >
                          {schema.icon}
                          <span className="font-bold text-xs lg:text-sm">{schema.label}</span>
                      </button>
                  ))}
              </div>

              <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 mt-4">
                  <h4 className="font-bold text-blue-800 text-[10px] uppercase mb-2">Colunas Obrigatórias:</h4>
                  <div className="flex flex-wrap gap-1 mb-3">
                      {currentSchema.requiredCols.map(col => (
                          <span key={col} className="bg-white px-2 py-1 rounded text-[10px] font-mono font-bold text-blue-600 border border-blue-200">
                              {col}
                          </span>
                      ))}
                  </div>
                  <button onClick={handleDownloadTemplate} className="w-full py-2 bg-white border border-blue-200 text-blue-700 text-xs font-bold rounded-lg hover:bg-blue-100 flex items-center justify-center gap-2">
                      <Download size={14}/> Baixar Modelo
                  </button>
              </div>
          </div>

          {/* PAINEL DIREITO: UPLOAD */}
          <div className="lg:col-span-2">
              <h3 className="font-bold text-gray-400 uppercase text-[10px] tracking-widest mb-4">Arquivo & Processamento</h3>
              
              <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:bg-gray-50 transition-colors relative flex flex-col items-center justify-center min-h-[200px]">
                    <input type="file" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"/>
                    <UploadCloud size={48} className="text-gray-300 mb-3" />
                    <p className="font-bold text-gray-600 text-sm">Toque para selecionar a planilha</p>
                    <p className="text-xs text-gray-400 mt-1">Destino: <span className="font-bold text-black uppercase">{currentSchema.collection}</span></p>
              </div>

              {error && <div className="mt-4 p-4 bg-red-50 text-red-600 rounded-xl text-sm flex items-center gap-3 border border-red-100"><AlertTriangle size={20}/> {error}</div>}
              {success && <div className="mt-4 p-4 bg-green-50 text-green-700 rounded-xl text-sm flex items-center gap-3 border border-green-200"><Check size={20}/> {success}</div>}

              {data.length > 0 && (
                  <div className="mt-6 animate-in fade-in">
                      <div className="flex justify-between items-center mb-3">
                          <h3 className="font-bold text-gray-700 text-xs uppercase">Preview ({data.length})</h3>
                          <button onClick={handleImport} disabled={loading} className="bg-green-600 text-white px-4 py-2 rounded-lg font-bold text-xs hover:bg-green-700 shadow-md disabled:opacity-50 flex items-center gap-2">
                              {loading ? '...' : <><Save size={14}/> Confirmar</>}
                          </button>
                      </div>
                      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm overflow-x-auto">
                          <table className="w-full text-left text-xs whitespace-nowrap">
                              <thead className="bg-gray-50 text-gray-500 font-bold uppercase">
                                  <tr>{Object.keys(data[0]).slice(0, 5).map(k => <th key={k} className="p-3">{k}</th>)}</tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 font-mono text-gray-600">
                                  {data.map((r, i) => <tr key={i} className="hover:bg-gray-50">{Object.values(r).slice(0, 5).map((v, j) => <td key={j} className="p-3">{String(v).substring(0, 20)}</td>)}</tr>)}
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