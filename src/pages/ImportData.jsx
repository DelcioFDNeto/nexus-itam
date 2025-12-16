// src/pages/ImportData.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { db } from '../services/firebase';
import { collection, writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { 
  UploadCloud, FileSpreadsheet, FileJson, AlertTriangle, Check, ArrowLeft, Save, 
  Users, Server, Layers, FolderGit2, Download
} from 'lucide-react';

const IMPORT_SCHEMAS = {
  assets: {
    label: 'Ativos',
    icon: <Server size={24}/>,
    collection: 'assets',
    requiredCols: ['Patrimonio', 'Modelo'],
    transform: (row) => ({
      internalId: row['Patrimonio'] || row['Tag'] || row['internalId'] || '',
      model: row['Modelo'] || row['model'] || '',
      type: row['Tipo'] || row['type'] || 'Outros',
      status: row['Status'] || row['status'] || 'Disponível',
      location: row['Local'] || row['location'] || 'Matriz',
      serialNumber: row['Serial'] || row['serialNumber'] || '',
      createdAt: serverTimestamp()
    })
  },
  employees: {
    label: 'Funcionários',
    icon: <Users size={24}/>,
    collection: 'employees',
    requiredCols: ['Nome', 'Email'],
    transform: (row) => ({
      name: row['Nome'] || row['name'] || '',
      email: row['Email'] || row['email'] || '',
      role: row['Cargo'] || row['role'] || 'Analista',
      department: row['Departamento'] || row['department'] || 'TI',
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
      name: row['Nome'] || row['name'] || '',
      description: row['Descricao'] || row['description'] || '',
      status: row['Status'] || row['status'] || 'Planejamento',
      priority: row['Prioridade'] || row['priority'] || 'Média',
      leader: row['Lider'] || row['leader'] || '',
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
      title: row['Titulo'] || row['title'] || '',
      description: row['Descricao'] || row['description'] || '',
      status: row['Status'] || row['status'] || 'A Fazer',
      priority: row['Prioridade'] || row['priority'] || 'Média',
      category: row['Categoria'] || row['category'] || 'Geral',
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

  const processData = (rawData) => {
    if (!Array.isArray(rawData) || rawData.length === 0) {
      setError("O arquivo está vazio ou formato inválido (deve ser uma lista).");
      return;
    }

    // Validação básica (checa se o primeiro item tem as chaves, ignorando case sensitive se necessário)
    const firstRow = rawData[0];
    const keys = Object.keys(firstRow);
    const missingCols = currentSchema.requiredCols.filter(col => 
      !keys.some(k => k.toLowerCase() === col.toLowerCase())
    );

    if (missingCols.length > 0) {
      // Tenta ser flexível: se for JSON, as chaves podem estar em inglês (mapped no transform)
      // Se falhar mesmo assim, avisa
       console.warn("Colunas ausentes no header:", missingCols);
    }
    
    const formattedData = rawData.map(row => currentSchema.transform(row));
    setData(formattedData);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setError('');
    setSuccess('');
    setData([]);

    const reader = new FileReader();

    // LÓGICA PARA JSON
    if (file.name.endsWith('.json')) {
      reader.onload = (evt) => {
        try {
          const json = JSON.parse(evt.target.result);
          processData(json);
        } catch (err) {
          setError("Arquivo JSON inválido.");
        }
      };
      reader.readAsText(file);
    } 
    // LÓGICA PARA EXCEL/CSV
    else {
      reader.onload = (evt) => {
        try {
          const bstr = evt.target.result;
          const wb = XLSX.read(bstr, { type: 'binary' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const rawData = XLSX.utils.sheet_to_json(ws);
          processData(rawData);
        } catch (err) {
          setError("Erro ao ler Excel.");
        }
      };
      reader.readAsBinaryString(file);
    }
  };

  const handleImport = async () => {
    if (data.length === 0) return;
    if (!confirm(`Importar ${data.length} registros?`)) return;

    setLoading(true);
    try {
      const batch = writeBatch(db);
      data.forEach(item => {
        const docRef = doc(collection(db, currentSchema.collection)); 
        batch.set(docRef, item);
      });
      await batch.commit();
      setSuccess(`${data.length} importados com sucesso!`);
      setTimeout(() => { setSuccess(''); setData([]); }, 3000);
    } catch (err) {
      console.error(err);
      setError("Erro ao salvar no Firebase.");
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
                <UploadCloud className="text-shineray" /> Importação
            </h1>
            <p className="text-sm text-gray-500">Excel (.xlsx) ou JSON</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* SELEÇÃO */}
          <div className="lg:col-span-1 space-y-3">
              <h3 className="font-bold text-gray-400 text-xs uppercase">Tipo de Dado</h3>
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
                  <Download size={14}/> Baixar Template Excel
              </button>
          </div>

          {/* UPLOAD */}
          <div className="lg:col-span-2">
              <h3 className="font-bold text-gray-400 text-xs uppercase mb-3">Upload de Arquivo</h3>
              
              <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:bg-gray-50 transition-colors relative flex flex-col items-center justify-center min-h-[200px]">
                    <input 
                        type="file" 
                        accept=".xlsx, .xls, .csv, .json" 
                        onChange={handleFileUpload} 
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="pointer-events-none space-y-2">
                        <div className="flex justify-center gap-2 text-gray-300">
                           <FileSpreadsheet size={40} />
                           <FileJson size={40} />
                        </div>
                        <p className="font-bold text-gray-600">Arraste Excel ou JSON aqui</p>
                        <p className="text-xs text-gray-400">Destino: <span className="font-bold text-black uppercase">{currentSchema.collection}</span></p>
                    </div>
              </div>

              {error && <div className="mt-4 p-4 bg-red-50 text-red-600 rounded-xl text-sm flex items-center gap-2"><AlertTriangle size={18}/> {error}</div>}
              {success && <div className="mt-4 p-4 bg-green-50 text-green-700 rounded-xl text-sm flex items-center gap-2"><Check size={18}/> {success}</div>}

              {data.length > 0 && (
                  <div className="mt-6 animate-in slide-in-from-bottom-2">
                      <div className="flex justify-between items-center mb-3">
                          <h3 className="font-bold text-gray-700 text-sm">Preview ({data.length})</h3>
                          <button onClick={handleImport} disabled={loading} className="bg-green-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-green-700 shadow-md flex items-center gap-2">
                              {loading ? 'Salvando...' : <><Save size={16}/> Confirmar</>}
                          </button>
                      </div>
                      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto max-h-[300px]">
                          <table className="w-full text-left text-xs">
                              <thead className="bg-gray-50 text-gray-500 font-bold uppercase sticky top-0">
                                  <tr>
                                      {Object.keys(data[0]).slice(0, 4).map(k => <th key={k} className="p-3">{k}</th>)}
                                  </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 font-mono text-gray-600">
                                  {data.map((row, idx) => (
                                      <tr key={idx}>
                                          {Object.values(row).slice(0, 4).map((v, i) => <td key={i} className="p-3 whitespace-nowrap">{String(v).substring(0,20)}</td>)}
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