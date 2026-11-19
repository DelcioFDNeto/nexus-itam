// src/components/cloud/DesktopSyncModal.jsx
// =============================================================================
// Modais de Edição Sincronizada Desktop (`nexusvault://` via Agente Windows)
// e Guia Passo a Passo para Colaboradores & Equipe (Excel, Word, Apps Nativos)
// =============================================================================
import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Info,
  Laptop,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Unlock,
  X,
} from 'lucide-react';

const AGENT_DOWNLOAD_URL = '/downloads/NexusAgent.zip';

function formatFriendlyTime(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function DesktopSyncStatusModal({
  session,
  busy = false,
  slowHint = false,
  onRelaunch,
  onOpenGuide,
  onCloseSession,
  onDismiss,
}) {
  if (!session) return null;

  return (
    <div
      data-testid="admin-desktop-sync-modal"
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Monitor size={18} />
            </span>
            <div className="min-w-0">
              <h4 className="text-sm font-black text-slate-900 dark:text-white truncate">
                Edição Sincronizada no PC (Auto-Sync)
              </h4>
              <p className="text-[11px] text-slate-500 truncate">{session.fileName}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Minimizar acompanhamento"
            onClick={onDismiss}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200/70 dark:hover:bg-zinc-800"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {session.status === 'pending' && (
            <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 space-y-2">
              <div className="flex items-center gap-2 font-bold text-sky-800 dark:text-sky-200">
                <RefreshCw size={15} className="animate-spin" />
                <span>Chamando o Agente Nexus no computador...</span>
              </div>
              <p className="text-[11px] text-sky-700 dark:text-sky-300 leading-relaxed">
                Se o navegador perguntar se deseja abrir o <strong>NexusAgent</strong>, marque{' '}
                <strong>&quot;Sempre permitir&quot;</strong> e clique em <strong>Abrir</strong>.
              </p>
            </div>
          )}

          {session.status === 'opened' && (
            <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-200">
                  <CheckCircle2 size={16} />
                  <span>Arquivo aberto no PC — Auto-Sync Ativo!</span>
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white font-mono text-[10px] font-bold">
                  v{session.currentVersion}
                </span>
              </div>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-300 leading-relaxed">
                Edite normalmente no Excel, Word ou programa padrão. A cada <strong>Ctrl+S</strong>, o Agente
                grava automaticamente uma nova versão na VPS. Ao fechar o programa, o cadeado é liberado sozinho.
              </p>
              <div className="pt-1 flex flex-wrap items-center gap-3 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
                <span>
                  Salvamentos sincronizados: <strong>{session.syncCount}</strong>
                </span>
                {session.lastSyncedAt && (
                  <span>
                    • Último envio: <strong>{formatFriendlyTime(session.lastSyncedAt)}</strong>
                  </span>
                )}
              </div>
            </div>
          )}

          {session.status !== 'pending' && session.status !== 'opened' && (
            <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4 space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-200">
                <CheckCircle2 size={16} />
                <span>Edição finalizada e sincronizada na VPS!</span>
              </div>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                Versão final: <strong>v{session.currentVersion}</strong> ({session.syncCount} salvamento(s)). Arquivo
                desbloqueado automaticamente.
              </p>
            </div>
          )}

          {slowHint && session.status === 'pending' && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 space-y-2.5">
              <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="font-bold">O Agente Nexus ainda não abriu o arquivo?</p>
                  <p className="text-[11px] leading-relaxed">
                    Confirme se o <strong>NexusAgent v3.4+</strong> está ativo na bandeja do Windows (ou dispare a
                    atualização OTA pela aba <em>Agente ITAM</em>).
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onOpenGuide}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[11px] font-bold inline-flex items-center gap-1"
                >
                  <Info size={13} />
                  <span>Ver Passo a Passo</span>
                </button>
                <a
                  href={AGENT_DOWNLOAD_URL}
                  download="NexusAgent.zip"
                  className="px-3 py-1.5 rounded-lg border border-amber-600/40 text-amber-800 dark:text-amber-200 text-[11px] font-bold inline-flex items-center gap-1"
                >
                  <ExternalLink size={13} />
                  <span>Baixar Agente v3.4 (.ZIP)</span>
                </a>
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-slate-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {session.status !== 'closed' && (
                <button
                  type="button"
                  onClick={onRelaunch}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 font-bold text-slate-700 dark:text-zinc-200 inline-flex items-center gap-1"
                >
                  <ExternalLink size={13} />
                  <span>Abrir novamente</span>
                </button>
              )}
              <button
                type="button"
                onClick={onOpenGuide}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 font-semibold text-slate-600 dark:text-zinc-300 inline-flex items-center gap-1"
              >
                <Info size={13} />
                <span>Passo a passo</span>
              </button>
            </div>

            {session.status !== 'closed' ? (
              <button
                type="button"
                disabled={busy}
                onClick={onCloseSession}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 text-white font-bold inline-flex items-center gap-1 disabled:opacity-50"
              >
                <Unlock size={13} />
                <span>Encerrar e Desbloquear</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onDismiss}
                className="px-4 py-1.5 rounded-lg bg-brand text-brand-fg font-bold"
              >
                Concluir
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DesktopSyncGuideModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div
      data-testid="admin-desktop-guide-modal"
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Laptop size={18} />
            </span>
            <div>
              <h4 className="text-sm font-black text-slate-900 dark:text-white">
                Guia: Edição no Excel e Programas Nativos com Auto-Sync na VPS
              </h4>
              <p className="text-[11px] text-slate-500">
                Passo a passo para colaboradores e TI — funciona com Excel (.xlsx/.xlsm), Word, PowerPoint, PDF e qualquer app Windows
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Fechar guia"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200/70 dark:hover:bg-zinc-800"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-emerald-900 dark:text-emerald-100 leading-relaxed">
            Em vez de usar um editor web limitado, basta clicar em <strong>&quot;Editar no PC&quot;</strong> em qualquer arquivo:
            o <strong>Agente Nexus ITAM (v3.4+)</strong> abre direto no <strong>Microsoft Excel / Word / app padrão</strong>{' '}
            do Windows, trava o arquivo contra conflitos e envia automaticamente cada <strong>Ctrl+S</strong> como uma nova versão na VPS.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-3.5 space-y-1.5 bg-slate-50/70 dark:bg-zinc-900/50">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand text-brand-fg font-black text-[11px]">
                1
              </span>
              <h5 className="font-bold text-slate-900 dark:text-white">Ativar ou atualizar o Agente v3.4+</h5>
              <p className="text-[11px] text-slate-600 dark:text-zinc-400 leading-relaxed">
                Em máquinas já cadastradas, basta ir em <strong>Agente ITAM → Instalar &amp; Atualizar</strong> e clicar em{' '}
                <strong>Atualizar Frota (OTA)</strong>. Em PCs novos ou home office, extraia o <strong>NexusAgent.zip</strong> e abra o{' '}
                <strong>NexusAgent.exe</strong> uma única vez.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-3.5 space-y-1.5 bg-slate-50/70 dark:bg-zinc-900/50">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand text-brand-fg font-black text-[11px]">
                2
              </span>
              <h5 className="font-bold text-slate-900 dark:text-white">Clicar em &quot;Editar no PC&quot;</h5>
              <p className="text-[11px] text-slate-600 dark:text-zinc-400 leading-relaxed">
                Selecione a planilha/arquivo no Explorador (Admin ou Portal do Colaborador) e clique em{' '}
                <strong>Editar no PC</strong>. Na primeira vez, marque <strong>&quot;Sempre permitir&quot;</strong> no aviso do navegador.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-3.5 space-y-1.5 bg-slate-50/70 dark:bg-zinc-900/50">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand text-brand-fg font-black text-[11px]">
                3
              </span>
              <h5 className="font-bold text-slate-900 dark:text-white">Editar normalmente e apertar Ctrl+S</h5>
              <p className="text-[11px] text-slate-600 dark:text-zinc-400 leading-relaxed">
                O arquivo abre com 100% de fórmulas, macros e gráficos no programa nativo. Cada <strong>Ctrl+S</strong> cria uma nova
                versão auditada (v2, v3, v4...) direto na sua VPS e exibe confirmação discreta na bandeja.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-3.5 space-y-1.5 bg-slate-50/70 dark:bg-zinc-900/50">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand text-brand-fg font-black text-[11px]">
                4
              </span>
              <h5 className="font-bold text-slate-900 dark:text-white">Fechar o programa libera o cadeado</h5>
              <p className="text-[11px] text-slate-600 dark:text-zinc-400 leading-relaxed">
                Enquanto aberto, o arquivo fica bloqueado exclusivamente para quem está editando. Ao fechar o Excel/Word, o Agente confirma
                a versão final e destrava o arquivo sozinho.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-3.5 space-y-1.5">
            <h5 className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-emerald-600" />
              <span>Segurança Zero-Trust</span>
            </h5>
            <p className="text-[11px] text-slate-600 dark:text-zinc-400 leading-relaxed">
              Cada abertura gera um token exclusivo de arquivo único (sem expor a senha ou JWT do usuário), respeita todas as permissões
              ACL de setor/usuário (bloqueando usuários somente-visualização) e grava trilha de auditoria SHA-256 a cada salvamento.
            </p>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 flex flex-wrap items-center justify-between gap-2">
          <a
            href={AGENT_DOWNLOAD_URL}
            download="NexusAgent.zip"
            className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-95"
          >
            <ExternalLink size={14} />
            <span>Baixar Agente Windows v3.4 (.ZIP)</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold"
          >
            Fechar guia
          </button>
        </div>
      </div>
    </div>
  );
}
