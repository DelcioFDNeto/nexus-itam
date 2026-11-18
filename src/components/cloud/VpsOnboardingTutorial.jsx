// src/components/cloud/VpsOnboardingTutorial.jsx
import React, { useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
  FolderOpen,
  HelpCircle,
  KeyRound,
  Layers,
  Lock,
  Server,
  Shield,
  Terminal,
} from 'lucide-react';
import { toast } from 'sonner';

const SFTP_CHROOT_SNIPPET = `# 1. Crie usuário SFTP dedicado sem shell
sudo adduser --disabled-password --gecos "" --shell /usr/sbin/nologin nexusvault

# 2. Crie o diretório isolado (dono root obrigatório para chroot)
sudo mkdir -p /srv/nexus-vault/dados
sudo chown root:root /srv/nexus-vault && sudo chmod 755 /srv/nexus-vault
sudo chown nexusvault:nexusvault /srv/nexus-vault/dados

# 3. Cole sua chave pública SSH em authorized_keys (ou defina senha)
sudo mkdir -p /home/nexusvault/.ssh
# sudo tee /home/nexusvault/.ssh/authorized_keys < nexusvault.pub
sudo chown -R nexusvault:nexusvault /home/nexusvault/.ssh
sudo chmod 700 /home/nexusvault/.ssh

# 4. Ative jaula SFTP no sshd_config
sudo tee -a /etc/ssh/sshd_config <<'EOF'

Match User nexusvault
    ChrootDirectory /srv/nexus-vault
    ForceCommand internal-sftp
    AllowTcpForwarding no
    X11Forwarding no
EOF
sudo sshd -t && sudo systemctl reload ssh`;

const AGENT_OPS_SNIPPET = `# Verificar status do serviço na VPS
systemctl status nexus-storage-node --no-pager

# Acompanhar logs em tempo real
journalctl -u nexus-storage-node -n 50 --no-pager

# Liberar porta caso use UFW manualmente
sudo ufw allow 9443/tcp`;

const DRIVER_GUIDES = {
  agent_node: {
    id: 'agent_node',
    badge: 'Recomendado para VPS Linux',
    title: 'Agente 1-Click Linux (Nexus Storage Node)',
    summary:
      'Instala um micro-serviço isolado na porta 9443 (systemd + Node 20 LTS) autenticado por HMAC-SHA256, sem expor acesso SSH no sistema.',
    steps: [
      {
        title: '1. Defina a pasta raiz e a capacidade',
        desc: 'Mantenha /srv/nexus-vault (ou outro diretório dedicado) e informe quantos GB deseja reservar para a empresa.',
      },
      {
        title: '2. Gere e execute o Script 1-Click na VPS',
        desc: 'Clique em "Gerar Script 1-Click Linux", use "Copiar Script" e cole no terminal SSH da VPS como root (ou sudo).',
      },
      {
        title: '3. Cole o Endpoint retornado no terminal',
        desc: 'Ao concluir, o terminal exibirá algo como http://SEU_IP:9443. Informe essa URL no campo "Endpoint do Nexus Storage Node" (o token HMAC já fica salvo no cofre).',
      },
      {
        title: '4. Salve, diagnostique e inicialize',
        desc: 'Clique em "Salvar Credenciais VPS", depois em "Diagnosticar Nó VPS" e por fim em "Inicializar Estrutura". Libere TCP 9443 no firewall da hospedagem se necessário.',
      },
    ],
    snippetTitle: 'Comandos úteis de diagnóstico na VPS',
    snippet: AGENT_OPS_SNIPPET,
  },
  sftp: {
    id: 'sftp',
    badge: 'Zero-Install (SSH Nativo)',
    title: 'SFTP / SSH Nativo para Linux, VPS ou NAS',
    summary:
      'Usa o servidor SSH já existente no datacenter ou servidor Linux, sem instalar nenhum software adicional.',
    steps: [
      {
        title: '1. Crie um usuário isolado na VPS/Datacenter',
        desc: 'Para segurança máxima, use o bloco abaixo para criar o usuário nexusvault preso em ChrootDirectory (/srv/nexus-vault/dados).',
      },
      {
        title: '2. Preencha Host, Porta e Autenticação',
        desc: 'Informe o IP ou domínio em Host, Porta 22 (ou sua porta SSH customizada), Usuário e Senha ou Chave Privada OpenSSH/PEM.',
      },
      {
        title: '3. Ajuste o Diretório Raiz',
        desc: 'Com ChrootDirectory em /srv/nexus-vault, informe /dados no campo Diretório Raiz Reservado. Sem chroot, informe /srv/nexus-vault.',
      },
      {
        title: '4. Salve, diagnostique e inicialize',
        desc: 'Clique em "Salvar Credenciais VPS" → "Diagnosticar Nó VPS" → "Inicializar Estrutura" para criar a árvore corporativa.',
      },
    ],
    snippetTitle: 'Comandos para criar usuário SFTP isolado (opcional/recomendado)',
    snippet: SFTP_CHROOT_SNIPPET,
  },
  s3: {
    id: 's3',
    badge: 'Datacenter / Object Storage',
    title: 'Amazon S3, MinIO (Self-Hosted) ou Cloudflare R2',
    summary:
      'Ideal quando sua empresa já possui um cluster MinIO em datacenter próprio ou bucket S3/R2 compatível com assinatura AWS SigV4.',
    steps: [
      {
        title: '1. Crie um Bucket exclusivo no seu Storage',
        desc: 'No painel do MinIO, AWS S3 ou Cloudflare R2, crie um bucket dedicado (ex.: nexus-vault-empresa).',
      },
      {
        title: '2. Gere uma Access Key restrita ao Bucket',
        desc: 'Crie um par Access Key / Secret Key com permissão de leitura e escrita apenas nesse bucket.',
      },
      {
        title: '3. Preencha Endpoint, Bucket, Região e Chaves',
        desc: 'Para MinIO use https://minio.suaempresa.com.br; para Cloudflare R2 use o endpoint S3 da conta; para AWS use https://s3.sa-east-1.amazonaws.com.',
      },
      {
        title: '4. Salve, diagnostique e inicialize',
        desc: 'Clique em "Salvar Credenciais VPS" → "Diagnosticar Nó VPS" → "Inicializar Estrutura".',
      },
    ],
    snippetTitle: null,
    snippet: null,
  },
  webdav: {
    id: 'webdav',
    badge: 'Nextcloud / Storage HTTP',
    title: 'WebDAV Corporativo ou Nextcloud',
    summary:
      'Integra diretórios já expostos via protocolo WebDAV em servidores NAS (Synology/TrueNAS), Apache ou Nextcloud.',
    steps: [
      {
        title: '1. Obtenha a URL WebDAV base',
        desc: 'Ex.: https://nuvem.empresa.com.br/remote.php/dav/files/usuario (Nextcloud) ou endereço WebDAV dedicado.',
      },
      {
        title: '2. Gere uma Senha de Aplicativo',
        desc: 'Prefira criar uma senha de app exclusiva para o Nexus ITAM em vez da senha pessoal.',
      },
      {
        title: '3. Preencha Endpoint, Usuário e Senha',
        desc: 'Defina também a subpasta raiz desejada (ex.: /nexus-vault ou /) para manter os arquivos organizados.',
      },
      {
        title: '4. Salve, diagnostique e inicialize',
        desc: 'Clique em "Salvar Credenciais VPS" → "Diagnosticar Nó VPS" → "Inicializar Estrutura".',
      },
    ],
    snippetTitle: null,
    snippet: null,
  },
};

const STANDARD_FOLDERS = [
  { path: '/Corporativo-Publico', desc: 'Políticas, manuais e modelos visíveis para toda a empresa' },
  { path: '/Setores', desc: 'Pastas departamentais (RH, Financeiro, TI) isoladas por setor' },
  { path: '/Cofre-TI-Infra/Termos', desc: 'Arquivamento direto de Termos CLT/PJ assinados e contratos' },
  { path: '/Chamados', desc: 'Arquivamento direto de protocolos, chats e fotos de suporte' },
  { path: '/Espaco-Pessoal', desc: 'Espaço reservado individual por colaborador autorizado' },
];

export default function VpsOnboardingTutorial({
  providerType = 'agent_node',
  isConfigured = false,
  isConnected = false,
  hasFolders = false,
  onSelectProvider,
  onOpenExplorerTab,
  onOpenAclTab,
}) {
  const setupComplete = Boolean(isConfigured && isConnected && hasFolders);
  const [expanded, setExpanded] = useState(!setupComplete);
  const [manualOverride, setManualOverride] = useState(null);

  const guideDriver =
    manualOverride && manualOverride.forProvider === providerType && DRIVER_GUIDES[manualOverride.tab]
      ? manualOverride.tab
      : DRIVER_GUIDES[providerType]
        ? providerType
        : 'agent_node';

  const activeGuide = DRIVER_GUIDES[guideDriver] || DRIVER_GUIDES.agent_node;
  const completedSteps = [isConfigured, isConnected, hasFolders].filter(Boolean).length;

  const copyText = async (txt, label = 'Comandos') => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(txt);
        toast.success(`${label} copiados para a área de transferência.`);
      }
    } catch {
      toast.error('Não foi possível copiar automaticamente.');
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] overflow-hidden">
      {/* Header / Progress Strip */}
      <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/70 dark:bg-zinc-900/50">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <BookOpen size={16} className="text-brand-aa" />
            <h2 className="text-sm font-black text-slate-900 dark:text-white">
              Guia de Vínculo VPS &amp; Operação do Cofre
            </h2>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-brand/10 text-brand-aa">
              {completedSteps}/3 etapas
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold">
            <span className={`inline-flex items-center gap-1 ${isConfigured ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>
              {isConfigured ? <CheckCircle2 size={13} /> : <Circle size={13} />}
              1. Credenciais salvas
            </span>
            <span className={`inline-flex items-center gap-1 ${isConnected ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>
              {isConnected ? <CheckCircle2 size={13} /> : <Circle size={13} />}
              2. Comunicação ativa
            </span>
            <span className={`inline-flex items-center gap-1 ${hasFolders ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>
              {hasFolders ? <CheckCircle2 size={13} /> : <Circle size={13} />}
              3. Pastas inicializadas
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold text-slate-700 dark:text-zinc-200 flex items-center gap-1.5 self-start md:self-auto"
        >
          <HelpCircle size={14} className="text-brand-aa" />
          <span>{expanded ? 'Ocultar Tutorial' : 'Abrir Tutorial Passo a Passo'}</span>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {expanded && (
        <div className="p-5 border-t border-slate-200 dark:border-zinc-800 space-y-5">
          {/* Provider Guide Switcher */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Escolha o cenário da sua empresa para ver o passo a passo
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.values(DRIVER_GUIDES).map((item) => {
                const selected = guideDriver === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setManualOverride({ forProvider: providerType, tab: item.id })}
                    className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${
                      selected
                        ? 'bg-brand text-brand-fg border-brand'
                        : 'bg-slate-50 dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-zinc-700 hover:border-brand/50'
                    }`}
                  >
                    {item.id === 'agent_node' && 'Agente 1-Click Linux'}
                    {item.id === 'sftp' && 'SFTP / SSH Nativo'}
                    {item.id === 's3' && 'S3 / MinIO / R2'}
                    {item.id === 'webdav' && 'WebDAV / Nextcloud'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Driver Recipe */}
          <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/60 p-4 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300 mb-1">
                  {activeGuide.badge}
                </span>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">{activeGuide.title}</h3>
                <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">{activeGuide.summary}</p>
              </div>
              {onSelectProvider && providerType !== activeGuide.id && (
                <button
                  type="button"
                  onClick={() => onSelectProvider(activeGuide.id)}
                  className="px-3 py-1.5 rounded-xl bg-brand text-brand-fg text-xs font-bold flex items-center gap-1.5"
                >
                  <Server size={13} />
                  <span>Usar este driver no formulário</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {activeGuide.steps.map((st) => (
                <div
                  key={st.title}
                  className="rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-[#111113] p-3 space-y-1"
                >
                  <p className="text-xs font-black text-slate-900 dark:text-white">{st.title}</p>
                  <p className="text-[11px] leading-relaxed text-slate-600 dark:text-zinc-400">{st.desc}</p>
                </div>
              ))}
            </div>

            {activeGuide.snippet && (
              <div className="rounded-xl border border-slate-700 bg-slate-900 text-emerald-300 p-3.5 text-[11px] font-mono space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-zinc-300 font-sans">
                  <span className="font-bold flex items-center gap-1.5">
                    <Terminal size={13} className="text-emerald-400" />
                    {activeGuide.snippetTitle}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyText(activeGuide.snippet, 'Comandos SSH')}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-600/30 font-semibold flex items-center gap-1"
                  >
                    <Copy size={12} />
                    <span>Copiar Comandos</span>
                  </button>
                </div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap">{activeGuide.snippet}</pre>
              </div>
            )}
          </div>

          {/* Standard Folders & Day-to-Day Module Usage */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4 space-y-2.5">
              <h4 className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                <FolderOpen size={14} className="text-emerald-500" />
                <span>Estrutura criada por "Inicializar Estrutura"</span>
              </h4>
              <div className="space-y-1.5">
                {STANDARD_FOLDERS.map((f) => (
                  <div key={f.path} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] py-1 border-b border-slate-100 dark:border-zinc-800/80 last:border-0">
                    <span className="font-mono font-bold text-slate-800 dark:text-zinc-200">{f.path}</span>
                    <span className="text-slate-500 dark:text-zinc-400">{f.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4 space-y-3">
              <h4 className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                <Layers size={14} className="text-brand-aa" />
                <span>Como utilizar no dia a dia (Console e Portal)</span>
              </h4>
              <ul className="space-y-2 text-[11px] text-slate-600 dark:text-zinc-300">
                <li className="flex items-start gap-2">
                  <Shield size={13} className="text-emerald-500 mt-0.5 shrink-0" />
                  <span>
                    <strong>Permissões por Setor e Usuário:</strong> configure quem apenas visualiza online (sem download), baixa, edita ou gerencia cada pasta.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Lock size={13} className="text-amber-500 mt-0.5 shrink-0" />
                  <span>
                    <strong>Segurança Zero-Knowledge:</strong> o Superadmin da plataforma nunca acessa suas chaves ou arquivos; toda movimentação gera prova criptográfica SHA-256.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <KeyRound size={13} className="text-sky-500 mt-0.5 shrink-0" />
                  <span>
                    <strong>Portal do Colaborador (Arquivos &amp; Nuvem):</strong> colaboradores acessam apenas as pastas autorizadas com edição colaborativa de arquivos .xlsx/.csv ao vivo, sem ver credenciais da VPS.
                  </span>
                </li>
              </ul>

              <div className="flex flex-wrap gap-2 pt-1">
                {hasFolders && onOpenExplorerTab && (
                  <button
                    type="button"
                    onClick={onOpenExplorerTab}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800 text-xs font-bold text-slate-800 dark:text-zinc-100 hover:bg-slate-200 dark:hover:bg-zinc-700"
                  >
                    Abrir Gerenciador de Arquivos
                  </button>
                )}
                {hasFolders && onOpenAclTab && (
                  <button
                    type="button"
                    onClick={onOpenAclTab}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800 text-xs font-bold text-slate-800 dark:text-zinc-100 hover:bg-slate-200 dark:hover:bg-zinc-700"
                  >
                    Configurar Permissões por Setor
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
