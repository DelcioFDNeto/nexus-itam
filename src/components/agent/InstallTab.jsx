// src/components/agent/InstallTab.jsx
import React, { useState } from 'react';
import {
  AlertTriangle,
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
import {
  AGENT_MODES,
  AGENT_TARGETS,
  buildAgentConfigJson,
  buildAgentScript,
  buildWindowsCmdInstaller,
} from '../../utils/agentScripts';
import { AGENT_VERSION } from '../../utils/agentInventory';

const GUIDES = {
  windows: {
    service: [
      'Mais fácil (1 máquina): Baixe o "Instalador .CMD (Duplo Clique)" abaixo e dê dois cliques. Ele solicita permissão de Administrador e instala o NexusAgent.exe na bandeja do Windows.',
      'Executável Direto: Baixe o "NexusAgent.exe" + "config.json" na mesma pasta, ou abra o NexusAgent.exe e cole o Tenant ID e o Token.',
      'Em massa (Active Directory / GPO): Baixe o script .PS1 → Configuração do Computador → Scripts → Inicialização.',
      'Intune / RMM: Publique o script .PS1 em contexto de sistema (64 bits). Ele compila e instala C:\\ProgramData\\NexusITAM\\NexusAgent.exe + atalho na Área de Trabalho.',
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
  'Acesso Remoto Interativo (AnyDesk Web): visualização da tela ao vivo + controle de mouse e teclado direto pelo navegador',
  'Aplicativo de Bandeja (NexusAgent.exe): exibe ID de 9 dígitos, patrimônio, uso de CPU/RAM/Disco e botão "Pedir Suporte à TI"',
  'Terminal PowerShell Remoto, Gerenciador de Processos ao vivo (Kill) e Instalação silenciosa via Winget',
  'Hardware completo: fabricante, modelo, processador, memória, discos (serial e SSD/HDD), placa de vídeo e bateria',
  'Monitores conectados com número de série e rede (IP, MAC e gateway para identificar a filial automaticamente)',
  'Segurança: antivírus, firewall, BitLocker/FileVault, administradores locais e programas instalados com versão',
];

/** Gera e explica os instaladores e o executavel nativo do agente para cada sistema. */
const InstallTab = ({ tenantId, agentToken }) => {
  const [os, setOs] = useState('windows');
  const [mode, setMode] = useState('service');

  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'itam-nexus';
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyDummy';

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
      // 1. Baixa o pacote compactado contendo o executavel nativo
      const zipLink = document.createElement('a');
      zipLink.href = '/downloads/NexusAgent.zip';
      zipLink.download = 'NexusAgent.zip';
      zipLink.click();

      // 2. Se houver token, baixa tambem o config.json pronto para colocar na mesma pasta
      if (tenantId && agentToken) {
        setTimeout(() => {
          const cfg = buildAgentConfigJson({ projectId, tenantId, agentToken });
          triggerBlobDownload(cfg.content, cfg.filename, cfg.mime);
        }, 400);
        toast.success('NexusAgent.zip e config.json baixados! Extraia o executável e execute com o config.json na mesma pasta.');
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

  return (
    <div className="space-y-6">
      {/* Card de destaque do Executavel Windows (Substituto AnyDesk + RMM) */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-6 border border-indigo-500/30 shadow-xl flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-400/15 border border-cyan-400/30 text-cyan-300 text-xs font-black uppercase tracking-wider">
            <Monitor size={14} /> Novo • Substituto Nativo do AnyDesk & RMM
          </div>
          <h2 className="text-xl md:text-2xl font-black tracking-tight">
            Executável Windows <span className="text-cyan-400 font-mono">NexusAgent.exe</span> (v3.0)
          </h2>
          <p className="text-xs md:text-sm text-slate-300 leading-relaxed">
            Instala o ícone na bandeja do relógio com <strong>ID de Acesso de 9 dígitos</strong>, visualização e controle remoto de tela pelo navegador, terminal PowerShell ao vivo, gerenciador de processos, alertas na tela e botão para o colaborador pedir suporte à TI.
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

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <section className="xl:col-span-3 bg-slate-900 text-white rounded-2xl p-6 space-y-5">
          <div>
            <h2 className="font-black text-xl flex items-center gap-2">
              <Terminal size={20} className="text-cyan-400" /> Scripts de Implantação (GPO, Intune, Linux e macOS)
            </h2>
            <p className="text-sm text-slate-300 mt-1">
              Scripts assinados com o Token da sua empresa para distribuição em massa. Versão {AGENT_VERSION}.
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
          <div className="flex bg-slate-800/60 p-1 rounded-xl border border-white/10 gap-1" role="radiogroup" aria-label="Modo">
            {Object.entries(AGENT_MODES).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={mode === id}
                onClick={() => setMode(id)}
                className={`flex-1 py-2 text-sm font-bold rounded-lg ${mode === id ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white'}`}
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
            <Info size={16} className="text-brand" /> Recursos do Agente RMM & Acesso Remoto
          </h3>
          <ul className="space-y-2 text-xs text-gray-600 dark:text-gray-300 list-disc pl-4">
            {COLLECTS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="text-xs text-gray-500 dark:text-gray-400 rounded-xl bg-gray-50 dark:bg-slate-900 p-3 space-y-1.5">
            <p className="font-bold text-gray-700 dark:text-slate-200 flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-emerald-500" /> Segurança Zero-Trust Multi-Tenant
            </p>
            <p>
              Toda comunicação usa o Token exclusivo da sua empresa validado no servidor. Você pode conectar tanto em modo não supervisionado quanto pedindo autorização na tela do colaborador.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default InstallTab;
