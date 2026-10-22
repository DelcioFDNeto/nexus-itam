// src/components/agent/InstallTab.jsx
import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  Clipboard,
  Cpu,
  Download,
  FileCode,
  Info,
  Monitor,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '../ConfirmDialog';
import {
  AGENT_MODES,
  AGENT_TARGETS,
  buildAgentConfigJson,
  buildAgentScript,
  buildWindowsCmdInstaller,
} from '../../utils/agentScripts';
import { AGENT_VERSION, isAgentOutdated } from '../../utils/agentInventory';
import { dispatchBatchAgentUpdate } from '../../services/rmmService';

const GUIDES = {
  windows: {
    service: [
      'Uma máquina: baixe o "Instalador 1-Clique (.CMD)" e dê dois cliques. Ele pede permissão de administrador, instala o serviço "Nexus ITAM Agent" e o ícone do NexusDesk ao lado do relógio.',
      'Executável avulso: extraia o NexusAgent.zip, ponha o config.json na mesma pasta, abra o NexusAgent.exe e clique em "Conectar este computador" (pede administrador).',
      'Atualização remota pelo painel (OTA): máquinas já matriculadas (v3.1+) podem ser atualizadas em 1 clique diretamente pelo painel sem precisar rodar o instalador novamente.',
      'Em massa (Active Directory / GPO): script .PS1 em Configuração do Computador → Scripts → Inicialização. Pode rodar a cada boot: a máquina já matriculada só é atualizada.',
      'O token só é usado na matrícula de cada máquina e depois sai do disco. Para tirar uma máquina da empresa, revogue o agente no console remoto.',
    ],
    portable: [
      'Copie o arquivo .ps1 para a máquina (pendrive ou pasta de rede).',
      'Clique com o botão direito → "Executar com o PowerShell". Como administrador, também lê BitLocker.',
      'A máquina aparece na fila em segundos. Nada fica instalado.',
    ],
    uninstall: ['Execute como administrador em cada máquina, ou publique pela mesma GPO/Intune usada na instalação.'],
  },
  linux: {
    portable: ['sudo bash nexus-agente-linux-coleta.sh', 'Sem sudo também funciona, mas sem número de série e UUID da placa.'],
    service: [
      'sudo bash nexus-agente-linux-instalar.sh',
      'Instala em /opt/nexus-itam (só root lê) e agenda em /etc/cron.d: na inicialização e a cada 6 horas.',
      'Em massa: distribua com Ansible, Puppet ou o gerenciador que já usa.',
    ],
    uninstall: ['sudo bash nexus-agente-linux-remover.sh'],
  },
  mac: {
    portable: ['sudo bash nexus-agente-mac-coleta.sh'],
    service: [
      'sudo bash nexus-agente-mac-instalar.sh',
      'Instala em /usr/local/nexus-itam (só root lê) e cria um LaunchDaemon: na inicialização e a cada 6 horas.',
      'Em massa: Jamf, Kandji ou outro MDM, como script executado pelo root.',
    ],
    uninstall: ['sudo bash nexus-agente-mac-remover.sh'],
  },
};

const COLLECTS = [
  'NexusDesk (acesso remoto pelo navegador e celular): tela ao vivo, controle de mouse/teclado, modo trackpad mobile e zoom com pinça, com aceite do colaborador e descarte automático de frames',
  'Atualização Over-The-Air (OTA): atualize a versão do NexusAgent.exe nas máquinas da empresa em 1 clique direto pelo painel',
  'Ícone na bandeja: ID NexusDesk de 9 dígitos, uso de CPU/RAM/disco, "Pedir suporte à TI" e transparência de privacidade',
  'Serviço do Windows: terminal PowerShell, processos, reiniciar e instalar via winget mesmo sem ninguém logado — tudo auditado',
  'Hardware completo: fabricante, modelo, processador, memória, discos (serial e SSD/HDD), placa de vídeo e bateria',
  'Segurança: antivírus, firewall, BitLocker/FileVault, administradores locais e programas instalados com versão',
];

/** Gera e explica os instaladores, atualizacao OTA e o executavel nativo do agente para cada sistema. */
const InstallTab = ({ tenantId, agentToken, liveDevices = [], currentUser = null }) => {
  const confirm = useConfirm();
  const [os, setOs] = useState('windows');
  const [mode, setMode] = useState('service');
  const [updatingFleet, setUpdatingFleet] = useState(false);

  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'itam-nexus';
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyDummy';

  const activeDevices = useMemo(
    () => liveDevices.filter((d) => d?.deviceKey && !['revoked', 'uninstalled'].includes(d.status)),
    [liveDevices]
  );
  const outdatedDevices = useMemo(
    () => activeDevices.filter((d) => isAgentOutdated(d.agentVersion)),
    [activeDevices]
  );

  const build = () =>
    buildAgentScript({
      os,
      mode,
      projectId,
      apiKey,
      tenantId,
      agentToken,
    });

  const needsToken = mode !== 'uninstall';
  const blocked = needsToken && !agentToken;

  const triggerBlobDownload = (content, filename, mime) => {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const download = () => {
    try {
      const { content, filename, mime } = build();
      triggerBlobDownload(content, filename, mime);
      toast.success(`${filename} baixado.`);
    } catch (error) {
      toast.error(error.message);
    }
  };

  const downloadWindowsCmd = () => {
    try {
      const { content, filename, mime } = buildWindowsCmdInstaller({
        projectId,
        apiKey,
        tenantId,
        agentToken,
      });
      triggerBlobDownload(content, filename, mime);
      toast.success('Instalador .CMD baixado! Dê dois cliques nele no computador de destino.');
    } catch (error) {
      toast.error(error.message);
    }
  };

  const downloadExecutableAndConfig = () => {
    try {
      const zipLink = document.createElement('a');
      zipLink.href = '/downloads/NexusAgent.zip';
      zipLink.download = 'NexusAgent.zip';
      zipLink.click();

      if (tenantId && agentToken) {
        setTimeout(() => {
          const cfg = buildAgentConfigJson({ projectId, apiKey, tenantId, agentToken });
          triggerBlobDownload(cfg.content, cfg.filename, cfg.mime);
        }, 400);
        toast.success('NexusAgent.zip e config.json baixados. Extraia, ponha o config.json na mesma pasta e abra o NexusAgent.exe.');
      } else {
        toast.success('NexusAgent.zip baixado com sucesso!');
      }
    } catch (error) {
      toast.error(error.message || 'Erro ao baixar pacote.');
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(build().content.replace(/^\uFEFF/, ''));
      toast.success('Script copiado.');
    } catch (error) {
      toast.error(error.message || 'Não foi possível copiar.');
    }
  };

  const handleUpdateAllDevices = async (targets) => {
    if (!tenantId || !targets.length) return;
    const ok = await confirm({
      title: `Atualizar ${targets.length} máquina(s) remotamente para v${AGENT_VERSION}?`,
      message: `O painel enviará um comando OTA assinado para ${targets.length} máquina(s). Cada computador baixará o pacote oficial NexusAgent v${AGENT_VERSION} e reiniciará o serviço automaticamente sem perder a matrícula.`,
      confirmLabel: `Atualizar ${targets.length} máquina(s)`,
    });
    if (!ok) return;
    setUpdatingFleet(true);
    try {
      const res = await dispatchBatchAgentUpdate({
        tenantId,
        devices: targets,
        targetVersion: AGENT_VERSION,
        user: currentUser,
      });
      if (res.updated > 0) {
        toast.success(`Atualização v${AGENT_VERSION} enviada para ${res.updated} máquina(s)!`);
      }
      if (res.failed > 0) {
        toast.warning(`${res.failed} máquina(s) não puderam receber a atualização.`);
      }
    } catch (e) {
      toast.error(e?.message || 'Erro ao disparar atualização remota.');
    } finally {
      setUpdatingFleet(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Card de destaque do Executavel Windows (NexusDesk + RMM) */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-6 border border-indigo-500/30 shadow-xl flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-400/15 border border-cyan-400/30 text-cyan-300 text-xs font-black uppercase tracking-wider">
            <Monitor size={14} /> NexusDesk • Acesso Remoto Seguro & RMM
          </div>
          <h2 className="text-xl md:text-2xl font-black tracking-tight">
            Executável Windows <span className="text-cyan-400 font-mono">NexusAgent.exe</span> (v{AGENT_VERSION})
          </h2>
          <p className="text-xs md:text-sm text-slate-300 leading-relaxed">
            Serviço do Windows com inventário, monitoramento e comandos remotos, mais o ícone na bandeja com <strong>ID NexusDesk de 9 dígitos</strong>, pedido de suporte e acesso remoto à tela pelo computador ou celular, com aceite do colaborador.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={downloadWindowsCmd}
            disabled={blocked}
            className="inline-flex items-center gap-2 px-5 py-3.5 rounded-xl bg-cyan-400 hover:bg-cyan-300 disabled:opacity-40 text-slate-950 font-black text-xs md:text-sm shadow-lg shadow-cyan-400/20 transition-all"
          >
            <Download size={17} />
            Instalador 1-Clique (.CMD)
          </button>
          <button
            type="button"
            onClick={downloadExecutableAndConfig}
            className="inline-flex items-center gap-2 px-4 py-3.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold text-xs md:text-sm transition-all"
          >
            <Cpu size={17} className="text-cyan-300" />
            Baixar NexusAgent (.ZIP) + config.json
          </button>
        </div>
      </div>

      {/* Card de Atualizacao Remota OTA pelo Painel */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-indigo-200 dark:border-indigo-900/60 p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
            <ArrowUpCircle size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-black text-sm md:text-base text-gray-900 dark:text-white">
                Atualização Remota de Versão pelo Painel (OTA 1-Clique)
              </h3>
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-mono text-xs font-bold">
                Versão atual do sistema: v{AGENT_VERSION}
              </span>
            </div>
            <p className="text-xs text-gray-600 dark:text-slate-300 mt-1">
              {activeDevices.length === 0
                ? 'Assim que a primeira máquina for instalada (v3.1+), você poderá atualizar sua versão diretamente por este botão.'
                : outdatedDevices.length > 0
                  ? `${outdatedDevices.length} de ${activeDevices.length} máquina(s) matriculada(s) estão em versão anterior e podem ser atualizadas remotamente agora.`
                  : `Todas as ${activeDevices.length} máquina(s) matriculada(s) já estão na versão mais recente (v${AGENT_VERSION}).`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {outdatedDevices.length > 0 ? (
            <button
              type="button"
              onClick={() => handleUpdateAllDevices(outdatedDevices)}
              disabled={updatingFleet}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-black text-xs shadow-md shadow-indigo-600/20 transition-colors"
            >
              <ArrowUpCircle size={15} className={updatingFleet ? 'animate-bounce' : ''} />
              {updatingFleet ? 'Enviando atualização...' : `Atualizar ${outdatedDevices.length} desatualizada(s)`}
            </button>
          ) : activeDevices.length > 0 ? (
            <button
              type="button"
              onClick={() => handleUpdateAllDevices(activeDevices)}
              disabled={updatingFleet}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-gray-800 dark:text-white font-bold text-xs transition-colors"
            >
              <CheckCircle2 size={15} className="text-emerald-500" />
              {updatingFleet ? 'Reinstalando...' : `Forçar reinstalação OTA (${activeDevices.length})`}
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <section className="xl:col-span-3 bg-slate-900 text-white rounded-2xl p-6 space-y-5">
          <div>
            <h2 className="font-black text-xl flex items-center gap-2">
              <Terminal size={20} className="text-cyan-400" /> Scripts de Implantação (GPO, Intune, Linux e macOS)
            </h2>
            <p className="text-sm text-slate-300 mt-1">
              Scripts com o token da sua empresa para distribuição em massa. Versão {AGENT_VERSION}.
            </p>
          </div>

          <div className="flex bg-slate-800/60 p-1 rounded-xl border border-white/10 gap-1" role="radiogroup" aria-label="Sistema operacional">
            {Object.entries(AGENT_TARGETS).map(([id, target]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={os === id}
                onClick={() => setOs(id)}
                className={`flex-1 py-2 text-sm font-bold rounded-lg ${os === id ? 'bg-cyan-400 text-slate-900' : 'text-slate-300 hover:text-white'}`}
              >
                {target.label}
              </button>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row bg-slate-800/60 p-1 rounded-xl border border-white/10 gap-1" role="radiogroup" aria-label="Modo">
            {Object.entries(AGENT_MODES).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={mode === id}
                onClick={() => setMode(id)}
                className={`flex-1 py-2 px-2 text-xs sm:text-sm font-bold rounded-lg ${mode === id ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-200">
            {GUIDES[os][mode].map((step) => (
              <li key={step} className="break-words">
                {step}
              </li>
            ))}
          </ol>

          {blocked && (
            <p className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/15 p-3 text-sm text-amber-100">
              <AlertTriangle size={16} className="text-amber-400 shrink-0" /> Gere o token de segurança na aba &ldquo;Políticas e segurança&rdquo; antes de baixar.
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={download}
              disabled={blocked}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-cyan-400 text-slate-900 font-black text-sm hover:bg-cyan-300 disabled:opacity-40"
            >
              <Download size={17} /> Baixar script
            </button>
            <button
              type="button"
              onClick={copy}
              disabled={blocked}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white/10 border border-white/20 font-bold text-sm hover:bg-white/20 disabled:opacity-40"
            >
              <Clipboard size={17} /> Copiar
            </button>
            {os === 'windows' && mode === 'service' && (
              <button
                type="button"
                onClick={downloadWindowsCmd}
                disabled={blocked}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-sm disabled:opacity-40"
              >
                <FileCode size={17} /> Baixar .CMD (Duplo Clique)
              </button>
            )}
          </div>
        </section>

        <aside className="xl:col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-5 space-y-4 self-start">
          <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2">
            <Info size={16} className="text-brand" /> Recursos do Agente RMM & NexusDesk
          </h3>
          <ul className="space-y-2 text-xs text-gray-600 dark:text-gray-300 list-disc pl-4">
            {COLLECTS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="text-xs text-gray-500 dark:text-gray-400 rounded-xl bg-gray-50 dark:bg-slate-900 p-3 space-y-1.5">
            <p className="font-bold text-gray-700 dark:text-slate-200 flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-emerald-500" /> Segurança e privacidade
            </p>
            <p>
              Cada máquina tem identidade própria, matriculada só na sua empresa: ela não envia nada para outra empresa nem recebe comandos de fora da sua gestão. Os dados coletados são da sua empresa; o Nexus, como fornecedor, não tem acesso a eles.
            </p>
            <p>
              Acesso sem supervisão, comandos remotos e o tempo de resposta são definidos em &ldquo;Políticas e segurança&rdquo;, onde fica também o registro de cada acesso.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default InstallTab;
