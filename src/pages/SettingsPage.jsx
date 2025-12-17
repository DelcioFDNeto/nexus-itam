import React, { useState, useEffect } from 'react';
import { db } from '../services/firebase';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { 
  Settings, Save, Database, Download, AlertTriangle, 
  UserCog, FileText, CheckCircle, Shield 
} from 'lucide-react';

const SettingsPage = () => {
  const [loading, setLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  
  // Estado das configurações
  const [config, setConfig] = useState({
    companyName: 'Shineray By Sabel',
    itManager: 'Délcio Farias',
    supportEmail: 'shiadmti@gmail.com',
    termTitle: 'Termo de Responsabilidade',
    locationBranch: 'Matriz - Belém'
  });

  // 1. Carregar Configurações Salvas
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
      alert("Configurações atualizadas com sucesso!");
    } catch (error) {
      alert("Erro ao salvar.");
    } finally {
      setLoading(false);
    }
  };

  // 3. Gerar Backup Completo (JSON)
  const handleFullBackup = async () => {
    if (!confirm("Gerar backup completo do sistema? Isso pode levar alguns segundos.")) return;
    setBackupLoading(true);
    
    try {
      const backupData = {
        meta: {
          date: new Date().toISOString(),
          version: '1.0',
          type: 'full_backup'
        },
        assets: [],
        employees: [],
        history: [],
        projects: [],
        tasks: [],
        sectors: []
      };

      // Busca paralela para velocidade
      const [assetsSnap, empSnap, histSnap, projSnap, tasksSnap, sectSnap] = await Promise.all([
        getDocs(collection(db, 'assets')),
        getDocs(collection(db, 'employees')),
        getDocs(collection(db, 'history')),
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'tasks')),
        getDocs(collection(db, 'sectors'))
      ]);

      backupData.assets = assetsSnap.docs.map(d => ({ ...d.data(), _id: d.id }));
      backupData.employees = empSnap.docs.map(d => ({ ...d.data(), _id: d.id }));
      backupData.history = histSnap.docs.map(d => ({ ...d.data(), _id: d.id }));
      backupData.projects = projSnap.docs.map(d => ({ ...d.data(), _id: d.id }));
      backupData.tasks = tasksSnap.docs.map(d => ({ ...d.data(), _id: d.id }));
      backupData.sectors = sectSnap.docs.map(d => ({ ...d.data(), _id: d.id }));

      // Criar arquivo para download
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", `BACKUP_SHINERAY_${new Date().toISOString().slice(0,10)}.json`);
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();

    } catch (error) {
      console.error(error);
      alert("Erro ao gerar backup.");
    } finally {
      setBackupLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
      
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 bg-gray-900 text-white rounded-xl">
            <Settings size={28} />
        </div>
        <div>
            <h1 className="text-2xl font-black text-gray-900">Configurações do Sistema</h1>
            <p className="text-sm text-gray-500">Personalização e segurança de dados</p>
        </div>
      </div>

      <div className="space-y-8">
        
        {/* BLOCO 1: PERSONALIZAÇÃO DE DOCUMENTOS */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="bg-gray-50 p-4 border-b border-gray-100 flex items-center gap-2">
                <FileText className="text-shineray" size={20}/>
                <h2 className="font-bold text-gray-800">Parâmetros de Documentos (PDF)</h2>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome da Empresa</label>
                        <input 
                            value={config.companyName} 
                            onChange={e => setConfig({...config, companyName: e.target.value})} 
                            className="w-full p-3 border rounded-xl font-bold text-gray-800 focus:outline-none focus:border-black"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Gestor de TI (Assinatura)</label>
                        <input 
                            value={config.itManager} 
                            onChange={e => setConfig({...config, itManager: e.target.value})} 
                            className="w-full p-3 border rounded-xl font-bold text-gray-800 focus:outline-none focus:border-black"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email de Suporte (Etiqueta)</label>
                        <input 
                            value={config.supportEmail} 
                            onChange={e => setConfig({...config, supportEmail: e.target.value})} 
                            className="w-full p-3 border rounded-xl font-medium text-gray-600 focus:outline-none focus:border-black"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Título do Termo</label>
                        <input 
                            value={config.termTitle} 
                            onChange={e => setConfig({...config, termTitle: e.target.value})} 
                            className="w-full p-3 border rounded-xl font-medium text-gray-600 focus:outline-none focus:border-black"
                        />
                    </div>
                </div>
                
                <div className="pt-4 flex justify-end">
                    <button type="submit" disabled={loading} className="bg-black text-white px-6 py-3 rounded-xl font-bold hover:bg-gray-800 flex items-center gap-2 shadow-lg">
                        {loading ? 'Salvando...' : <><Save size={18}/> Salvar Preferências</>}
                    </button>
                </div>
            </form>
        </div>

        {/* BLOCO 2: DADOS E BACKUP */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="bg-blue-50 p-4 border-b border-blue-100 flex items-center gap-2">
                <Database className="text-blue-600" size={20}/>
                <h2 className="font-bold text-blue-900">Segurança de Dados</h2>
            </div>
            <div className="p-6">
                <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                    <div>
                        <h3 className="font-bold text-gray-900 text-lg">Backup Completo (JSON)</h3>
                        <p className="text-sm text-gray-500 mt-1 max-w-md">
                            Gera um arquivo contendo todos os ativos, histórico, funcionários, projetos e tarefas. 
                            Use isso periodicamente para garantir a segurança das informações.
                        </p>
                    </div>
                    <button 
                        onClick={handleFullBackup} 
                        disabled={backupLoading}
                        className="w-full md:w-auto bg-blue-600 text-white px-6 py-4 rounded-xl font-bold hover:bg-blue-700 flex items-center justify-center gap-2 shadow-lg shadow-blue-100 transition-all hover:scale-105"
                    >
                        {backupLoading ? 'Gerando...' : <><Download size={20}/> Baixar Backup Agora</>}
                    </button>
                </div>

                <div className="mt-8 pt-6 border-t border-gray-100 grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                    <div className="p-4 bg-gray-50 rounded-xl">
                        <Shield className="mx-auto text-green-500 mb-2" size={24}/>
                        <p className="text-xs font-bold text-gray-600">Dados Criptografados</p>
                        <p className="text-[10px] text-gray-400">Pelo Google Firestore</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-xl">
                        <CheckCircle className="mx-auto text-green-500 mb-2" size={24}/>
                        <p className="text-xs font-bold text-gray-600">Sincronização</p>
                        <p className="text-[10px] text-gray-400">Tempo Real Ativo</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-xl">
                        <UserCog className="mx-auto text-green-500 mb-2" size={24}/>
                        <p className="text-xs font-bold text-gray-600">Acesso Admin</p>
                        <p className="text-[10px] text-gray-400">Permissão Total</p>
                    </div>
                </div>
            </div>
        </div>

        {/* BLOCO 3: ZONA DE PERIGO (Opcional - Deixei visual apenas por segurança) */}
        <div className="border border-red-100 rounded-2xl p-6 bg-red-50/50 flex items-start gap-4 opacity-70 hover:opacity-100 transition-opacity">
            <AlertTriangle className="text-red-500 shrink-0" size={24}/>
            <div>
                <h3 className="font-bold text-red-900">Zona de Perigo</h3>
                <p className="text-xs text-red-700 mt-1">
                    Para resetar o banco de dados completamente (limpar todos os ativos), entre em contato com o desenvolvedor ou use o console do Firebase diretamente. Essa ação é bloqueada por padrão na interface.
                </p>
            </div>
        </div>

      </div>
    </div>
  );
};

export default SettingsPage;