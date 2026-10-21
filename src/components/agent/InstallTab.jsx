// src/components/agent/InstallTab.jsx
import React, { useState } from 'react';
import { AlertTriangle, Clipboard, Download, Info, Terminal } from 'lucide-react';
import { toast } from 'sonner';
import { AGENT_MODES, AGENT_TARGETS, buildAgentScript } from '../../utils/agentScripts';
import { AGENT_VERSION } from '../../utils/agentInventory';

const GUIDES = {
  windows: {
    portable: [
      'Copie o arquivo para a máquina (pendrive ou pasta de rede).',
      'Clique com o botão direito → "Executar com o PowerShell". Como administrador, também lê BitLocker.',
      'A máquina aparece na fila em segundos. Nada fica instalado.',
    ],
    service: [
      'Uma máquina: PowerShell como administrador → powershell -ExecutionPolicy Bypass -File .\\nexus-agente-windows-instalar.ps1',
      'Em massa (Active Directory): GPO → Configuração do Computador → Scripts → Inicialização → adicione o arquivo (roda como SYSTEM).',
      'Intune: Dispositivos → Scripts → adicionar script do PowerShell, executar no contexto do sistema, 64 bits.',
      'Fica em C:\\ProgramData\\NexusITAM (só SYSTEM e administradores leem) e roda na inicialização, no logon e todo dia às 12:30.',
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
  'Hardware: fabricante, modelo, processador, memória, discos (com serial e SSD/HDD), placa de vídeo e bateria',
  'Monitores conectados com número de série',
  'Sistema, build, domínio, usuário logado e último boot',
  'Rede: IP, MAC e gateway (identifica a loja pela faixa de IP)',
  'Segurança: antivírus e atualização, firewall, BitLocker/FileVault, administradores locais, último Windows Update',
  'Programas instalados com versão (inclusive os instalados por usuário)',
];

/** Gera e explica os scripts do agente para cada sistema. */
const InstallTab = ({ tenantId, agentToken }) => {
  const [os, setOs] = useState('windows');
  const [mode, setMode] = useState('service');

  const build = () => buildAgentScript({
    os,
    mode,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    tenantId,
    agentToken,
  });

  const needsToken = mode !== 'uninstall';
  const blocked = needsToken && !agentToken;

  const download = () => {
    try {
      const { content, filename, mime } = build();
      const url = URL.createObjectURL(new Blob([content], { type: mime }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(`${filename} baixado.`);
    } catch (error) {
      toast.error(error.message);
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
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
      <section className="xl:col-span-3 bg-slate-900 text-white rounded-2xl p-6 space-y-5">
        <div>
          <h2 className="font-black text-xl flex items-center gap-2"><Terminal size={20} className="text-cyan-400" /> Instalar o agente</h2>
          <p className="text-sm text-slate-300 mt-1">Script nativo do sistema, sem programa de terceiros. Versão {AGENT_VERSION}.</p>
        </div>

        <div className="flex bg-slate-800/60 p-1 rounded-xl border border-white/10 gap-1" role="radiogroup" aria-label="Sistema operacional">
          {Object.entries(AGENT_TARGETS).map(([id, target]) => (
            <button key={id} type="button" role="radio" aria-checked={os === id} onClick={() => setOs(id)} className={`flex-1 py-2 text-sm font-bold rounded-lg ${os === id ? 'bg-cyan-400 text-slate-900' : 'text-slate-300 hover:text-white'}`}>
              {target.label}
            </button>
          ))}
        </div>
        <div className="flex bg-slate-800/60 p-1 rounded-xl border border-white/10 gap-1" role="radiogroup" aria-label="Modo">
          {Object.entries(AGENT_MODES).map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)} className={`flex-1 py-2 text-sm font-bold rounded-lg ${mode === id ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>

        <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-200">
          {GUIDES[os][mode].map((step) => <li key={step} className="break-words">{step}</li>)}
        </ol>

        {blocked && (
          <p className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/15 p-3 text-sm text-amber-100">
            <AlertTriangle size={16} className="text-amber-400 shrink-0" /> Gere o token de segurança na aba "Políticas e segurança" antes de baixar.
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={download} disabled={blocked} className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-cyan-400 text-slate-900 font-black text-sm hover:bg-cyan-300 disabled:opacity-40">
            <Download size={17} /> Baixar script
          </button>
          <button type="button" onClick={copy} disabled={blocked} className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white/10 border border-white/20 font-bold text-sm hover:bg-white/20 disabled:opacity-40">
            <Clipboard size={17} /> Copiar
          </button>
        </div>
      </section>

      <aside className="xl:col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-5 space-y-4 self-start">
        <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2"><Info size={16} className="text-brand" /> O que o agente coleta</h3>
        <ul className="space-y-2 text-xs text-gray-600 dark:text-gray-300 list-disc pl-4">
          {COLLECTS.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p className="text-xs text-gray-500 dark:text-gray-400 rounded-xl bg-gray-50 dark:bg-slate-900 p-3">
          Somente leitura: o agente não instala nem altera nada na máquina. Cada máquina mantém um único registro na fila, atualizado a cada coleta.
          Agentes 1.x continuam aceitos, mas reinstale para ganhar identidade da máquina, segurança e programas com versão.
        </p>
      </aside>
    </div>
  );
};

export default InstallTab;
