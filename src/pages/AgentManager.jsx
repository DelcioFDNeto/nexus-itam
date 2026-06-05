import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clipboard,
  Download,
  FileJson,
  Laptop,
  Play,
  RefreshCcw,
  ShieldCheck,
  UploadCloud,
  Wrench,
  Settings,
  Terminal,
  Cpu,
  Info
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { updateAsset } from '../services/assetService';
import {
  DEFAULT_AGENT_NAMING,
  generateAgentAssetCode,
  getAgentSubmissions,
  markAgentSubmission,
  previewAgentPayload,
  registerAgentAsset,
  resolveAgentNamingFromDatabase,
} from '../services/agentService';
import { buildWindowsScript, buildLinuxScript, buildMacScript } from '../utils/agentScripts';

const samplePayload = {
  hostname: 'DESKTOP-TI-001',
  usuario_logado: 'usuario.ti',
  mac_address: '00:11:22:AA:BB:CC',
  ip_address: '192.168.0.10',
  sistema_operacional: 'Microsoft Windows 11 Pro',
  hardware: {
    placa_mae_serial: 'BOARD-123456',
    bios_serial: 'SN-ABC-123',
    processador: 'Intel Core i5',
    ram_gb: 16,
  },
  data_coleta: new Date().toISOString(),
};

const normalizeNamingConfig = (config = {}) => ({
  ...DEFAULT_AGENT_NAMING,
  ...config,
  companyPrefix: String(config.companyPrefix || DEFAULT_AGENT_NAMING.companyPrefix).toUpperCase(),
  locationCode: String(config.locationCode || DEFAULT_AGENT_NAMING.locationCode).toUpperCase(),
  padLength: Number(config.padLength) || DEFAULT_AGENT_NAMING.padLength,
});

// Geradores de script movidos para ../utils/agentScripts};

const parsePayload = (value) => {
  const parsed = JSON.parse(value);
  return parsed.payload || parsed;
};

const buildJsonPayload = (currentText) => {
  try {
    const parsed = parsePayload(currentText);
    return {
      ...samplePayload,
      ...parsed,
      internalId: undefined,
      patrimonio: undefined,
      assetTag: undefined,
      data_coleta: new Date().toISOString(),
      hardware: {
        ...samplePayload.hardware,
        ...(parsed.hardware || {}),
      },
    };
  } catch {
    return {
      ...samplePayload,
      data_coleta: new Date().toISOString(),
    };
  }
};

const AgentManager = () => {
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId || 'default-tenant';
  const [jsonText, setJsonText] = useState(JSON.stringify(samplePayload, null, 2));
  const [preview, setPreview] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [namingConfig, setNamingConfig] = useState(DEFAULT_AGENT_NAMING);
  const [agentToken, setAgentToken] = useState('');
  const [trustedIps, setTrustedIps] = useState('');
  const [autoAcceptEnabled, setAutoAcceptEnabled] = useState(false);
  const [selectedSubmissions, setSelectedSubmissions] = useState([]);
  const [autoNamingPreview, setAutoNamingPreview] = useState(null);
  const [deployMode, setDeployMode] = useState('portable'); // 'portable' ou 'service'
  const [targetOS, setTargetOS] = useState('windows'); // 'windows', 'linux', 'mac'

  const pendingSubmissions = useMemo(
    () => submissions.filter((item) => item.status !== 'processed'),
    [submissions],
  );
  const normalizedNamingConfig = useMemo(() => normalizeNamingConfig(namingConfig), [namingConfig]);
  const nextAssetCode = autoNamingPreview?.nextInternalId || generateAgentAssetCode({ ...normalizedNamingConfig, typeCode: 'TIPO', nextSequence: 1 });

  const updateNamingField = (field, value) => {
    setNamingConfig((prev) => ({
      ...prev,
      [field]: ['nextSequence', 'padLength'].includes(field) ? Number(value) : value.toUpperCase(),
    }));
  };

  const saveNamingConfig = async (configToSave = namingConfig) => {
    setSavingConfig(true);
    try {
      await setDoc(doc(db, 'settings', tenantId), { 
        agentNaming: configToSave,
        trustedIps,
        autoAcceptEnabled 
      }, { merge: true });
      toast.success('Configurações salvas.');
      setNamingConfig(configToSave);
      // if (!silent) toast.success('Padrão de nomenclatura salvo.');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao salvar nomenclatura do agente.');
    } finally {
      setSavingConfig(false);
    }
  };

  const generateAgentToken = async () => {
    setSavingConfig(true);
    try {
      const newToken = crypto.randomUUID();
      await setDoc(doc(db, 'settings', tenantId), { agentToken: newToken }, { merge: true });
      setAgentToken(newToken);
      toast.success('Token de segurança gerado com sucesso.');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao gerar token.');
    } finally {
      setSavingConfig(false);
    }
  };

  const refreshAutoNamingPreview = async () => {
    if (!tenantId) return;
    try {
      const payload = parsePayload(jsonText);
      const resolved = await resolveAgentNamingFromDatabase(payload, { namingConfig: normalizedNamingConfig, tenantId });
      setAutoNamingPreview(resolved);
    } catch {
      setAutoNamingPreview(null);
    }
  };

  const analyzeJson = async () => {
    setLoadingPreview(true);
    try {
      const payload = parsePayload(jsonText);
      const result = await previewAgentPayload(payload, { namingConfig: normalizedNamingConfig, tenantId });
      setPreview({ ...result, payload });
      setAutoNamingPreview(result.resolvedNaming);
      toast.success('Payload analisado.');
    } catch (error) {
      console.error(error);
      toast.error(`JSON inválido ou incompleto: ${error.message}`);
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  const loadInbox = async () => {
    if (!tenantId) return;
    setLoadingInbox(true);
    try {
      const data = await getAgentSubmissions(tenantId);
      
      const settingsRef = doc(db, 'settings', tenantId);
      const snap = await getDoc(settingsRef);
      const autoAccept = snap.data()?.autoAcceptEnabled;
      const ips = (snap.data()?.trustedIps || '').split(',').map(s=>s.trim()).filter(Boolean);

      const enriched = await Promise.all(
        data.map(async (submission) => {
          try {
            const agentPreview = await previewAgentPayload(submission.payload || {}, { namingConfig: normalizedNamingConfig, tenantId });
            
            if (autoAccept && submission.status === 'pending' && ips.some(ip => agentPreview.ipAddress?.startsWith(ip))) {
              const result = await registerAgentAsset(submission.payload, { user: 'Agente ITAM (Auto)', namingConfig: normalizedNamingConfig, tenantId });
              await markAgentSubmission(submission.id, { status: 'processed', result });
              return { ...submission, status: 'processed', preview: agentPreview };
            }

            return { ...submission, preview: agentPreview };
          } catch {
            return submission;
          }
        }),
      );
      setSubmissions(enriched);
    } catch (error) {
      console.error(error);
      toast.error('Erro ao carregar submissões do agente.');
    } finally {
      setLoadingInbox(false);
    }
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
      const settingsRef = doc(db, 'settings', tenantId);
      const snap = await getDoc(settingsRef);
      if (snap.exists()) {
        const data = snap.data();
        setNamingConfig(normalizeNamingConfig(data.agentNaming || {}));
        if (data.agentToken) setAgentToken(data.agentToken);
        setTrustedIps(data.trustedIps || '');
        setAutoAcceptEnabled(!!data.autoAcceptEnabled);
      } else {
        const generalRef = doc(db, 'settings', 'general');
        const generalSnap = await getDoc(generalRef);
        if (generalSnap.exists()) {
          const generalData = generalSnap.data();
          setNamingConfig(normalizeNamingConfig(generalData.agentNaming || {}));
          if (generalData.agentToken) setAgentToken(generalData.agentToken);
          setTrustedIps(generalData.trustedIps || '');
          setAutoAcceptEnabled(!!generalData.autoAcceptEnabled);
        }
      }
      } catch (error) {
        console.error(error);
      }
    };

    if (tenantId) {
      loadSettings();
    }
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) {
      loadInbox();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, normalizedNamingConfig]);

  useEffect(() => {
    refreshAutoNamingPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jsonText, normalizedNamingConfig, tenantId]);

  const toggleSelectAll = () => {
    if (selectedSubmissions.length === pendingSubmissions.length) {
      setSelectedSubmissions([]);
    } else {
      setSelectedSubmissions(pendingSubmissions.map(s => s.id));
    }
  };

  const toggleSelect = (id) => {
    setSelectedSubmissions(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const processSelected = async () => {
    if (selectedSubmissions.length === 0) return;
    setProcessing(true);
    try {
      for (const id of selectedSubmissions) {
        const submission = pendingSubmissions.find(s => s.id === id);
        if (submission) {
          const result = await registerAgentAsset(submission.payload, {
            user: currentUser?.email || 'Agente ITAM',
            namingConfig: normalizedNamingConfig,
            tenantId,
          });
          await markAgentSubmission(submission.id, { status: 'processed', result });
        }
      }
      toast.success(`${selectedSubmissions.length} ativos incorporados com sucesso.`);
      setSelectedSubmissions([]);
      await loadInbox();
    } catch (error) {
      console.error(error);
      toast.error('Erro ao processar em lote.');
    } finally {
      setProcessing(false);
    }
  };

  const registerManualPayload = async () => {
    setProcessing(true);
    try {
      const payload = preview?.payload || parsePayload(jsonText);
      const result = await registerAgentAsset(payload, {
        user: currentUser?.email || 'Agente ITAM',
        namingConfig: normalizedNamingConfig,
        tenantId,
      });
      toast.success(result.action === 'created' ? 'Ativo criado pelo agente.' : 'Ativo existente atualizado pelo agente.');
      await analyzeJson();
    } catch (error) {
      console.error(error);
      toast.error(`Erro ao registrar ativo: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  // eslint-disable-next-line no-unused-vars
  const updateDuplicateStatus = async (status) => {
    if (!preview?.duplicate?.id) return;
    setProcessing(true);
    try {
      await updateAsset(preview.duplicate.id, { status }, {
        tenantId,
        type: 'agent-management',
        action: 'Gestão via Agente ITAM',
        details: `Status alterado para ${status} a partir do módulo Agente ITAM.`,
        user: currentUser?.email || 'Agente ITAM',
      });
      toast.success(`Status atualizado para ${status}.`);
      await analyzeJson();
    } catch (error) {
      console.error(error);
      toast.error('Erro ao atualizar status do ativo.');
    } finally {
      setProcessing(false);
    }
  };

  const getSelectedScript = () => {
    const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'SEU_PROJECT_ID';
    const apiKey = import.meta.env.VITE_FIREBASE_API_KEY || 'SUA_API_KEY';
    if (targetOS === 'windows') return buildWindowsScript(projectId, apiKey, tenantId, agentToken, deployMode);
    if (targetOS === 'linux') return buildLinuxScript(projectId, apiKey, tenantId, agentToken, deployMode);
    return buildMacScript(projectId, apiKey, tenantId, agentToken, deployMode);
  };

  const downloadScript = () => {
    if (!agentToken) return toast.error('Gere um Token de Segurança primeiro.');
    const ext = targetOS === 'windows' ? '.ps1' : '.sh';
    const blob = new Blob([getSelectedScript()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Instalar_Agente_Nexus_${targetOS}_${deployMode}${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Script para ${targetOS.toUpperCase()} baixado com sucesso.`);
  };

  const copyScript = async () => {
    if (!agentToken) return toast.error('Gere um Token de Segurança primeiro.');
    await navigator.clipboard.writeText(getSelectedScript());
    toast.success('Script do agente copiado.');
  };

  // eslint-disable-next-line no-unused-vars
  const generateJson = async () => {
    const payload = buildJsonPayload(jsonText);
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Payload_Agente_ITAM_${payload.hostname || 'endpoint'}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setJsonText(json);
    toast.success('JSON do agente gerado.');
  };

  const uploadJson = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => setJsonText(evt.target.result);
    reader.readAsText(file);
  };

  return (
    <div className="max-w-7xl mx-auto pb-24 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-br from-indigo-500 to-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-500/20">
            <Cpu size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Automação de Agente</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Coleta ativa e silenciosa com deploy em massa.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* COLUNA ESQUERDA: Geração e Instruções */}
        <div className="xl:col-span-2 space-y-6">
          
          {/* Card de Configuração e Exportação do Agente */}
          <section className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-3xl shadow-sm overflow-hidden">
            <div className="p-6 md:p-8 bg-slate-900 text-white relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none"></div>
              <h2 className="font-black text-2xl flex items-center gap-2 mb-2 relative z-10"><Terminal size={24} className="text-cyan-400"/> Gerar Script Agente</h2>
              <p className="text-indigo-200 text-sm relative z-10">
                Baixe o script nativo para inventariar as máquinas da sua rede. Não requer instalação de agentes de terceiros.
              </p>

              <div className="mt-8 flex bg-slate-800/50 p-1.5 rounded-xl border border-white/10 max-w-md relative z-10 gap-1">
                <button onClick={() => setTargetOS('windows')} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${targetOS === 'windows' ? 'bg-cyan-500 text-slate-900 shadow-md' : 'text-slate-400 hover:text-white'}`}>Windows</button>
                <button onClick={() => setTargetOS('linux')} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${targetOS === 'linux' ? 'bg-amber-500 text-slate-900 shadow-md' : 'text-slate-400 hover:text-white'}`}>Linux</button>
                <button onClick={() => setTargetOS('mac')} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${targetOS === 'mac' ? 'bg-gray-200 text-slate-900 shadow-md' : 'text-slate-400 hover:text-white'}`}>macOS</button>
              </div>

              <div className="mt-4 flex bg-slate-800/50 p-1.5 rounded-xl border border-white/10 max-w-md relative z-10 gap-1">
                <button 
                  onClick={() => setDeployMode('portable')}
                  className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${deployMode === 'portable' ? 'bg-white dark:bg-slate-800 text-slate-900 shadow-md' : 'text-slate-400 hover:text-white'}`}
                >
                  Modo Portátil (1-Click)
                </button>
                <button 
                  onClick={() => setDeployMode('service')}
                  className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${deployMode === 'service' ? 'bg-indigo-500 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
                >
                  Serviço Invisível (Auto)
                </button>
              </div>

              <div className="mt-6 flex flex-wrap gap-3 relative z-10">
                <button onClick={downloadScript} disabled={!agentToken} className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-cyan-400 text-slate-900 font-black text-sm hover:bg-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-cyan-500/20">
                  <Download size={18} /> Baixar Script ({targetOS.toUpperCase()})
                </button>
                <button onClick={copyScript} disabled={!agentToken} className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/10 border border-white/20 text-white font-bold text-sm hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  <Clipboard size={18} /> Copiar
                </button>
              </div>

              {!agentToken && (
                <div className="mt-4 bg-amber-500/20 border border-amber-500/30 text-amber-100 p-3 rounded-xl text-sm flex items-center gap-2 relative z-10">
                  <AlertTriangle size={18} className="text-amber-400 flex-shrink-0" />
                  Para baixar o script, configure o Token de Segurança na seção abaixo.
                </div>
              )}
            </div>

            {/* Documentação de Implantação */}
            <div className="p-6 md:p-8 bg-white dark:bg-slate-800">
              <h3 className="font-black text-gray-900 dark:text-white text-lg mb-4 flex items-center gap-2">
                <Info size={18} className="text-blue-500"/> Guia de Implantação Rápida
              </h3>
              
              {deployMode === 'portable' ? (
                <div className="space-y-3 text-sm text-gray-600 bg-blue-50 border border-blue-100 p-5 rounded-2xl">
                  <p><strong>Uso ideal:</strong> Técnicos de suporte rodando o script via pendrive ou pasta de rede compartilhada durante manutenções.</p>
                  <p><strong>Como usar:</strong> Basta dar dois cliques ou rodar o script no PowerShell da máquina alvo. Ele lerá os dados e os enviará diretamente para a nuvem da sua empresa.</p>
                </div>
              ) : (
                <div className="space-y-3 text-sm text-gray-600 bg-slate-50 border border-gray-200 dark:border-slate-600 p-5 rounded-2xl">
                  <p><strong>Uso ideal:</strong> Active Directory (GPO) ou Microsoft Intune para dezenas/centenas de máquinas.</p>
                  <ol className="list-decimal pl-5 space-y-2 mt-2">
                    <li>Baixe o script <code>Instalar_Agente_Nexus_Background.ps1</code>.</li>
                    <li>Crie uma nova GPO de <strong>Startup Script</strong> (Configurações do Computador) no AD.</li>
                    <li>Aponte a GPO para executar este script de instalação.</li>
                    <li><strong>Resultado:</strong> O script criará silenciosamente uma Tarefa Agendada no Windows. Sempre que um usuário logar, o inventário será feito e enviado invisivelmente.</li>
                  </ol>
                </div>
              )}
            </div>
          </section>

          {/* Configuração de Segurança (Token) */}
          <section className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-3xl shadow-sm overflow-hidden mb-6">
            <div className="p-6 md:p-8">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="font-black text-gray-900 dark:text-white flex items-center gap-2 text-xl tracking-tight"><ShieldCheck size={20} className="text-amber-500"/> Segurança do Agente (Token Drop-Box)</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">O Token garante que apenas scripts autorizados podem enviar dados para a sua fila.</p>
                </div>
                <button onClick={generateAgentToken} disabled={savingConfig} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-white font-bold text-xs hover:bg-amber-600 disabled:opacity-60 shadow-md">
                  <RefreshCcw size={14} className={savingConfig ? "animate-spin" : ""} /> Gerar Novo Token
                </button>
              </div>

              <div className="bg-amber-50 dark:bg-slate-900 p-4 rounded-2xl border border-amber-100 dark:border-slate-700 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-black uppercase text-amber-600 dark:text-amber-500 mb-1 block">Token de Autenticação Atual</span>
                  <div className="font-mono text-sm font-black text-gray-900 dark:text-white">
                    {agentToken || 'Nenhum token gerado. O Agente não funcionará até que você gere um.'}
                  </div>
                </div>
              </div>

              <div className="mt-6 border-t border-gray-100 dark:border-slate-700 pt-6">
                <h3 className="font-black text-gray-900 dark:text-white text-sm mb-3">Aprovação Automática (Lote / Bulk Actions)</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 block">Redes Confiáveis (IPs separados por vírgula)</label>
                    <input 
                      type="text" 
                      value={trustedIps} 
                      onChange={(e) => setTrustedIps(e.target.value)}
                      placeholder="Ex: 192.168.0., 10.0.0." 
                      className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="relative inline-flex items-center cursor-pointer mt-5">
                      <input type="checkbox" className="sr-only peer" checked={autoAcceptEnabled} onChange={(e) => setAutoAcceptEnabled(e.target.checked)} />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-emerald-500"></div>
                      <span className="ml-3 text-sm font-bold text-gray-700 dark:text-gray-300">Habilitar Auto-Accept</span>
                    </label>
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <button onClick={() => saveNamingConfig()} disabled={savingConfig} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white font-bold text-xs hover:bg-gray-800 disabled:opacity-60 shadow-md">
                    {savingConfig ? <RefreshCcw size={14} className="animate-spin" /> : <CheckCircle size={14} />} Salvar Configurações
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Configuração de Padrões e Caixa de Teste */}
          <section className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-3xl shadow-sm overflow-hidden">
            <div className="p-6 md:p-8 border-b border-gray-100 dark:border-slate-700">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="font-black text-gray-900 dark:text-white flex items-center gap-2 text-xl tracking-tight"><ShieldCheck size={20} className="text-emerald-500"/> Padrão de Etiquetagem Automática</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Como os ativos enviados pelo agente serão batizados.</p>
                </div>
                <button onClick={() => saveNamingConfig()} disabled={savingConfig} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white font-bold text-xs hover:bg-gray-800 disabled:opacity-60 shadow-md">
                  {savingConfig ? <RefreshCcw size={14} className="animate-spin" /> : <CheckCircle size={14} />} Salvar Padrão
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-slate-700">
                <ConfigInput label="Prefixo / Empresa" value={namingConfig.companyPrefix} onChange={(value) => updateNamingField('companyPrefix', value)} maxLength={6} />
                <ConfigInput label="Sigla Local" value={namingConfig.locationCode} onChange={(value) => updateNamingField('locationCode', value)} maxLength={6} />
                <ConfigInput label="Qtd. Dígitos" type="number" value={namingConfig.padLength} onChange={(value) => updateNamingField('padLength', value)} min={2} max={8} />
                <div className="flex flex-col justify-end">
                  <span className="text-[10px] font-black uppercase text-gray-400 dark:text-gray-500 mb-1">Próximo Ticket</span>
                  <div className="h-[42px] bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl px-3 flex items-center font-mono text-sm font-black text-indigo-600 shadow-sm">
                    {nextAssetCode}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 md:p-8 bg-slate-50">
               <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2 mb-4 text-sm"><FileJson size={16}/> Simulador de Payload (JSON)</h3>
               <textarea
                  value={jsonText}
                  onChange={(event) => setJsonText(event.target.value)}
                  className="w-full h-40 p-4 rounded-xl bg-gray-900 text-cyan-100 font-mono text-xs outline-none border border-gray-800 focus:ring-2 focus:ring-indigo-500 resize-none shadow-inner"
                  spellCheck={false}
                />
                <div className="flex gap-3 mt-4">
                  <button onClick={analyzeJson} disabled={loadingPreview} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 px-4 py-2.5 rounded-xl font-bold text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-900 flex items-center gap-2 transition-all">
                    {loadingPreview ? <RefreshCcw size={14} className="animate-spin" /> : <Play size={14} />} Analisar Lógica
                  </button>
                  <label className="cursor-pointer bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 px-4 py-2.5 rounded-xl font-bold text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-900 flex items-center gap-2 transition-all">
                    <UploadCloud size={14} /> Importar JSON
                    <input type="file" accept=".json,application/json" onChange={uploadJson} className="hidden" />
                  </label>
                </div>
            </div>
          </section>
        </div>

        {/* COLUNA DIREITA: Fila e Resolução */}
        <aside className="space-y-6">
          
          {/* Caixa de Entrada (Fila do Agente) */}
          <section className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-3xl shadow-sm overflow-hidden flex flex-col h-[500px]">
            <div className="p-4 md:p-5 border-b border-gray-100 dark:border-slate-700 flex flex-col gap-3 bg-slate-50">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-black text-gray-900 dark:text-white text-lg tracking-tight">Fila de Recepção</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mt-0.5">{pendingSubmissions.length} endpoint(s) aguardando</p>
                </div>
                <button onClick={loadInbox} disabled={loadingInbox} className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 text-gray-400 dark:text-gray-500 transition-colors shadow-sm">
                  <RefreshCcw size={16} className={loadingInbox ? 'animate-spin' : ''} />
                </button>
              </div>
              
              {pendingSubmissions.length > 0 && (
                <div className="flex items-center justify-between bg-white dark:bg-slate-800 p-2 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm">
                  <label className="flex items-center gap-2 px-2 cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      checked={selectedSubmissions.length === pendingSubmissions.length && pendingSubmissions.length > 0}
                      onChange={toggleSelectAll}
                    />
                    <span className="text-xs font-bold text-gray-600 dark:text-gray-300">Selecionar Todos</span>
                  </label>
                  <button 
                    onClick={processSelected} 
                    disabled={selectedSubmissions.length === 0 || processing}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    <CheckCircle size={14} /> Incorporar ({selectedSubmissions.length})
                  </button>
                </div>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100 p-2">
              {submissions.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                  <Activity size={32} className="text-gray-200 mb-3"/>
                  <p className="text-sm font-bold text-gray-500 dark:text-gray-400">Nenhum endpoint na fila.</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Os dados enviados pelo agente aparecerão aqui.</p>
                </div>
              ) : submissions.map((submission) => (
                <div key={submission.id} className="p-3 hover:bg-gray-50 dark:bg-slate-900 rounded-2xl transition-colors m-1 border border-transparent hover:border-gray-100 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      {submission.status === 'pending' && (
                        <input 
                          type="checkbox" 
                          className="mt-1 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          checked={selectedSubmissions.includes(submission.id)}
                          onChange={() => toggleSelect(submission.id)}
                        />
                      )}
                      <div className="min-w-0" onClick={() => setPreview(submission.preview)} style={{cursor: 'pointer'}}>
                        <p className="font-black text-sm text-gray-900 dark:text-white truncate hover:text-indigo-600">{submission.hostname || 'Desconhecido'}</p>
                        <p className="text-[10px] font-mono text-gray-500 dark:text-gray-400 truncate mt-0.5">SN: {submission.serialNumber || 'N/A'}</p>
                      </div>
                    </div>
                    <span className={`flex-shrink-0 text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md border ${submission.status === 'processed' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                      {submission.status === 'processed' ? 'OK' : 'Novo'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Resultado do Simulador */}
          {preview && (
            <section className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-3xl shadow-sm overflow-hidden animate-fade-in">
              <div className="p-5 md:p-6 border-b border-gray-100 dark:border-slate-700">
                <h2 className="font-black text-gray-900 dark:text-white flex items-center gap-2"><Laptop size={18} className="text-indigo-500"/> Resultado da Análise</h2>
              </div>
              <div className="p-5 md:p-6 space-y-4">
                <div className={`rounded-2xl p-4 border ${preview.duplicate ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
                  <div className="flex items-center gap-2 font-black text-sm text-gray-900 dark:text-white">
                    {preview.duplicate ? <AlertTriangle size={18} className="text-amber-600" /> : <CheckCircle size={18} className="text-emerald-600" />}
                    {preview.duplicate ? 'Ativo Já Registrado' : 'Ativo Inédito'}
                  </div>
                  <p className="text-xs text-gray-600 mt-2 leading-relaxed">
                    {preview.duplicate
                      ? `Encontramos um registro com a chave ${preview.duplicate.matchField}. Se incorporado, o agente fará apenas a ATUALIZAÇÃO de hardware e dados.`
                      : 'Nenhum patrimônio ou número de série bateu com a base. Um novo registro será criado.'}
                  </p>
                </div>
                
                <div className="bg-gray-50 dark:bg-slate-900 rounded-2xl p-4 border border-gray-100 dark:border-slate-700">
                  <div className="grid grid-cols-1 gap-2.5 text-sm">
                    <InfoRow label="Patrimônio" value={preview.normalized.internalId} />
                    <InfoRow label="Serial" value={preview.normalized.serialNumber} />
                    <InfoRow label="Hostname" value={preview.normalized.hostname} />
                    <InfoRow label="Usuário" value={preview.normalized.loggedUser} />
                  </div>
                </div>

                <div className="pt-2">
                  <button onClick={registerManualPayload} disabled={processing} className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-indigo-600 text-white font-black text-xs uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-60 shadow-lg shadow-indigo-500/20">
                    <Play size={16} /> {preview.duplicate ? 'Atualizar Ativo' : 'Registrar Novo Ativo'}
                  </button>
                </div>
              </div>
            </section>
          )}

        </aside>
      </div>
    </div>
  );
};

const InfoRow = ({ label, value }) => (
  <div className="flex items-center justify-between gap-3 border-b border-gray-200 dark:border-slate-600/60 pb-2.5 last:border-0 last:pb-0">
    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">{label}</span>
    <span className="text-right font-mono text-xs font-black text-gray-900 dark:text-white truncate">{value || 'N/A'}</span>
  </div>
);

const ConfigInput = ({ label, value, onChange, type = 'text', ...props }) => (
  <label className="block">
    <span className="text-[10px] font-black uppercase text-gray-500 dark:text-gray-400 mb-1.5 block">{label}</span>
    <input
      type={type}
      value={value || ''}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm font-black text-gray-900 dark:text-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all shadow-sm"
      {...props}
    />
  </label>
);

export default AgentManager;
