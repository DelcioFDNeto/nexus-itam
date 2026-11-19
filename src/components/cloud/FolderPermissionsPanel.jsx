// src/components/cloud/FolderPermissionsPanel.jsx
// =============================================================================
// Painel Visual & Intuitivo de Permissões e Níveis de Acesso das Pastas da VPS
// Reutilizado tanto no Modal direto do Explorador quanto na Aba "Permissões".
// =============================================================================

import React, { useMemo, useState } from 'react';
import {
  Ban,
  Building2,
  Check,
  Crown,
  Download,
  Eye,
  FilePenLine,
  Folder,
  FolderLock,
  HelpCircle,
  Info,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';

const ACCESS_LEVEL_DEFINITIONS = [
  {
    id: 'viewer_online',
    shortLabel: 'Somente Ver',
    label: 'Somente Visualizar (Sem Download)',
    description: 'Abre arquivos apenas no navegador. Download, edição e exclusão ficam bloqueados.',
    badgeClass: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30',
    ringClass: 'border-amber-500 bg-amber-500/10',
    Icon: Eye,
    capabilities: { view: true, download: false, write: false, deleteAny: false },
  },
  {
    id: 'reader',
    shortLabel: 'Leitor',
    label: 'Leitor (Ver e Baixar)',
    description: 'Pode abrir na tela e baixar cópias dos arquivos, sem enviar nem modificar nada.',
    badgeClass: 'bg-sky-500/15 text-sky-800 dark:text-sky-300 border-sky-500/30',
    ringClass: 'border-sky-500 bg-sky-500/10',
    Icon: Download,
    capabilities: { view: true, download: true, write: false, deleteAny: false },
  },
  {
    id: 'editor',
    shortLabel: 'Editor',
    label: 'Editor (Enviar e Editar)',
    description: 'Envia arquivos, cria subpastas, edita planilhas e só exclui o que ele mesmo enviou.',
    badgeClass: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30',
    ringClass: 'border-emerald-500 bg-emerald-500/10',
    Icon: FilePenLine,
    capabilities: { view: true, download: true, write: true, deleteAny: false },
  },
  {
    id: 'full_control',
    shortLabel: 'Controle Total',
    label: 'Controle Total',
    description: 'Acesso completo na pasta: enviar, editar, mover, renomear e excluir qualquer item.',
    badgeClass: 'bg-indigo-500/15 text-indigo-800 dark:text-indigo-300 border-indigo-500/30',
    ringClass: 'border-indigo-500 bg-indigo-500/10',
    Icon: Crown,
    capabilities: { view: true, download: true, write: true, deleteAny: true },
  },
  {
    id: 'none',
    shortLabel: 'Bloqueado',
    label: 'Bloqueado (Sem Acesso)',
    description: 'Oculta a pasta e bloqueia completamente o acesso, sobrescrevendo regras herdadas.',
    badgeClass: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
    ringClass: 'border-rose-500 bg-rose-500/10',
    Icon: Ban,
    capabilities: { view: false, download: false, write: false, deleteAny: false },
  },
];

const ACCESS_LEVEL_MAP = Object.fromEntries(
  ACCESS_LEVEL_DEFINITIONS.map((def) => [def.id, def]),
);

const ROLE_OPTIONS = [
  { value: 'collaborator', label: 'Colaboradores do Portal', hint: 'Todos os funcionários com login no Portal' },
  { value: 'operator', label: 'Operadores de TI', hint: 'Equipe técnica do Console Admin' },
  { value: 'viewer', label: 'Visualizadores (Auditores)', hint: 'Perfis somente-leitura do Console' },
  { value: 'manager', label: 'Gestores', hint: 'Líderes e supervisores de área' },
  { value: '*', label: 'Todos os usuários da empresa', hint: 'Aplica a qualquer perfil (exceto Admin/Dono)' },
];

const ROLE_LABEL_MAP = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));

function isFolder(node) {
  return (node?.nodeType || node?.node_type || node?.type) === 'folder';
}

function getPath(node) {
  return node?.virtualPath || node?.virtual_path || `/${node?.name || ''}`;
}

export default function FolderPermissionsPanel({
  nodes = [],
  selectedNodeId = '',
  onSelectNodeId,
  lockSelectedNode = false,
  canManageAcl = false,
  rules = [],
  inheritedRules = [],
  defaultPolicy = null,
  loading = false,
  saving = false,
  portalUsers = [],
  employees = [],
  sectors = [],
  onSaveRule,
  onDeleteRule,
  onClose,
}) {
  const [targetType, setTargetType] = useState('department');
  const [targetValue, setTargetValue] = useState('');
  const [customTargetMode, setCustomTargetMode] = useState(false);
  const [accessLevel, setAccessLevel] = useState('reader');
  const [userFilter, setUserFilter] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const activeNodes = useMemo(
    () =>
      (nodes || [])
        .filter((n) => n && !n.isTrashed && !n.is_trashed)
        .sort((a, b) => {
          const aDir = isFolder(a);
          const bDir = isFolder(b);
          if (aDir !== bDir) return aDir ? -1 : 1;
          return getPath(a).localeCompare(getPath(b), 'pt-BR');
        }),
    [nodes],
  );

  const selectedNode = useMemo(
    () => activeNodes.find((n) => n.id === selectedNodeId) || activeNodes[0] || null,
    [activeNodes, selectedNodeId],
  );

  // Lista unificada e deduplicada de Setores / Departamentos conhecidos
  const knownDepartments = useMemo(() => {
    const map = new Map();
    const addDept = (raw) => {
      const clean = String(raw || '').trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      if (!map.has(key)) map.set(key, clean);
    };
    (sectors || []).forEach((s) => addDept(typeof s === 'string' ? s : s?.name));
    (portalUsers || []).forEach((u) => addDept(u?.department));
    (employees || []).forEach((e) => addDept(e?.sector || e?.department));
    activeNodes.forEach((n) => {
      const p = getPath(n);
      if (isFolder(n) && p.startsWith('/Setores/')) {
        const sub = p.slice('/Setores/'.length).split('/')[0];
        if (sub) addDept(sub);
      }
      if (n.departmentScope || n.department_scope) {
        addDept(n.departmentScope || n.department_scope);
      }
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [sectors, portalUsers, employees, activeNodes]);

  // Lista unificada de Pessoas (contas do Portal primeiro + colaboradores RH)
  const knownPeople = useMemo(() => {
    const byEmail = new Map();
    for (const u of portalUsers || []) {
      const email = String(u?.email || '').trim().toLowerCase();
      if (!email) continue;
      byEmail.set(email, {
        email,
        name: u.name || email,
        department: u.department || '',
        role: u.role || 'collaborator',
        isPortal: true,
      });
    }
    for (const e of employees || []) {
      const email = String(e?.email || '').trim().toLowerCase();
      if (!email || byEmail.has(email)) continue;
      byEmail.set(email, {
        email,
        name: e.name || email,
        department: e.sector || e.department || '',
        role: 'collaborator',
        isPortal: false,
      });
    }
    return Array.from(byEmail.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [portalUsers, employees]);

  const peopleByEmail = useMemo(() => {
    const m = new Map();
    knownPeople.forEach((p) => m.set(p.email, p));
    return m;
  }, [knownPeople]);

  const filteredPeople = useMemo(() => {
    const q = userFilter.trim().toLowerCase();
    if (!q) return knownPeople;
    return knownPeople.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        p.department.toLowerCase().includes(q),
    );
  }, [knownPeople, userFilter]);

  const resolveRuleSubjectDisplay = (rule) => {
    const tType = String(rule.targetType || rule.target_type || '').toLowerCase();
    const tVal = String(rule.targetValue || rule.target_value || '').trim();
    if (tType === 'department') {
      return {
        category: 'Setor',
        title: tVal === '*' ? 'Todos os setores' : tVal,
        subtitle: tVal === '*' ? 'Qualquer departamento da empresa' : 'Todos os colaboradores deste setor',
        Icon: Building2,
        iconBg: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
      };
    }
    if (tType === 'user') {
      const person = peopleByEmail.get(tVal.toLowerCase());
      return {
        category: 'Pessoa',
        title: person ? person.name : tVal,
        subtitle: person ? `${person.email}${person.department ? ` • ${person.department}` : ''}` : 'Usuário específico',
        Icon: User,
        iconBg: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
      };
    }
    return {
      category: 'Perfil',
      title: ROLE_LABEL_MAP[tVal.toLowerCase()] || tVal,
      subtitle: `Regra por papel (${tVal})`,
      Icon: Users,
      iconBg: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    };
  };

  const handleTypeSwitch = (nextType) => {
    setTargetType(nextType);
    setCustomTargetMode(false);
    setUserFilter('');
    if (nextType === 'role') {
      setTargetValue('collaborator');
    } else if (nextType === 'department') {
      setTargetValue(knownDepartments[0] || '');
    } else {
      setTargetValue(knownPeople[0]?.email || '');
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!selectedNode || !canManageAcl) return;
    const cleanVal = String(targetValue || '').trim();
    if (!cleanVal) return;
    await onSaveRule?.(selectedNode.id, {
      targetType,
      targetValue: targetType === 'user' ? cleanVal.toLowerCase() : cleanVal,
      accessLevel,
    });
    if (customTargetMode) {
      setTargetValue('');
    }
  };

  const applyQuickPreset = async (presetRule) => {
    if (!selectedNode || !canManageAcl) return;
    await onSaveRule?.(selectedNode.id, presetRule);
  };

  const selectedPath = selectedNode ? getPath(selectedNode) : '/';
  const sectorFromPath = selectedPath.startsWith('/Setores/')
    ? selectedPath.slice('/Setores/'.length).split('/')[0]
    : '';

  return (
    <div className="space-y-4">
      {/* HEADER */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
            <FolderLock size={18} className="text-brand-aa shrink-0" />
            <span className="truncate">
              {lockSelectedNode && selectedNode
                ? `Permissões — ${selectedNode.name}`
                : 'Permissões & Níveis de Acesso das Pastas'}
            </span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Defina em linguagem simples quem pode apenas visualizar, baixar, editar ou ficar bloqueado em cada pasta da VPS.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            title="Entender como funciona a prioridade das permissões"
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold inline-flex items-center gap-1 transition-colors ${
              showHelp
                ? 'border-brand/40 bg-brand/10 text-brand-aa'
                : 'border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800'
            }`}
          >
            <HelpCircle size={13} />
            <span className="hidden sm:inline">Como funciona?</span>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar permissões"
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* GUIA RÁPIDO DOBRÁVEL */}
      {showHelp && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3.5 text-xs space-y-2 text-slate-700 dark:text-zinc-200">
          <p className="font-black text-sky-800 dark:text-sky-300 flex items-center gap-1.5">
            <Info size={14} />
            <span>Ordem de prioridade das permissões (da mais forte para a mais geral)</span>
          </p>
          <ol className="list-decimal list-inside space-y-1 text-[11px] leading-relaxed">
            <li>
              <strong>Proprietários e Administradores</strong> sempre têm <em>Controle Total</em> (nunca perdem acesso).
            </li>
            <li>
              <strong>Pessoa específica</strong> vence regras de <strong>Perfil</strong>, que vence <strong>Setor</strong>.
            </li>
            <li>
              Uma regra colocada em uma <strong>subpasta</strong> sobrescreve o que foi herdado da <strong>pasta superior</strong>.
            </li>
            <li>
              Para esconder uma subpasta específica de alguém que acessa a pasta pai, adicione essa pessoa/setor como{' '}
              <strong className="text-rose-600 dark:text-rose-400">Bloqueado (Sem Acesso)</strong>.
            </li>
          </ol>
        </div>
      )}

      {/* SELETOR DE PASTA / ARQUIVO (oculto quando aberto direto no modal de uma pasta específica) */}
      {!lockSelectedNode && (
        <div className="space-y-1.5">
          <label htmlFor="acl-node-select" className="block text-xs font-bold text-slate-700 dark:text-zinc-200">
            1. Escolha a pasta ou arquivo na VPS
          </label>
          <select
            id="acl-node-select"
            value={selectedNode?.id || ''}
            onChange={(e) => onSelectNodeId?.(e.target.value)}
            className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white"
          >
            {activeNodes.map((n) => (
              <option key={n.id} value={n.id}>
                {isFolder(n) ? '📁 ' : '📄 '}
                {getPath(n)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* RESUMO DA REGRA PADRÃO AUTOMÁTICA DESTA PASTA */}
      {selectedNode && (
        <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50/90 dark:bg-zinc-900/70 p-3.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Folder size={15} className="text-amber-500 shrink-0" />
              <span className="text-xs font-black text-slate-900 dark:text-white font-mono truncate">
                {selectedPath}
              </span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20">
              Admins &amp; Dono: Controle Total
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-zinc-300 leading-relaxed">
            <strong className="text-slate-800 dark:text-zinc-100">Comportamento padrão: </strong>
            {defaultPolicy?.summary ||
              'Administradores e gestores têm controle total. Adicione regras abaixo para definir exatamente quem acessa esta pasta.'}
          </p>

          {/* ATALHOS RÁPIDOS DE 1 CLIQUE */}
          {canManageAcl && (
            <div className="pt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-500 inline-flex items-center gap-1 mr-1">
                <Sparkles size={12} className="text-brand-aa" />
                <span>Ações rápidas:</span>
              </span>
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  applyQuickPreset({
                    targetType: 'role',
                    targetValue: 'collaborator',
                    accessLevel: 'reader',
                  })
                }
                className="px-2.5 py-1 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300 text-[11px] font-bold hover:bg-sky-500/20 transition-colors disabled:opacity-50"
              >
                Liberar leitura p/ toda empresa
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  applyQuickPreset({
                    targetType: 'role',
                    targetValue: 'collaborator',
                    accessLevel: 'none',
                  })
                }
                className="px-2.5 py-1 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300 text-[11px] font-bold hover:bg-rose-500/20 transition-colors disabled:opacity-50"
              >
                Restringir (ocultar de colaboradores)
              </button>
              {sectorFromPath && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    applyQuickPreset({
                      targetType: 'department',
                      targetValue: sectorFromPath,
                      accessLevel: 'editor',
                    })
                  }
                  className="px-2.5 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 text-[11px] font-bold hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                >
                  Liberar edição p/ setor {sectorFromPath}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* REGRAS PERSONALIZADAS ATUAIS DESTA PASTA */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400">
            Regras definidas nesta pasta ({rules.length})
          </h3>
          {loading && <span className="text-[11px] text-slate-400">Carregando…</span>}
        </div>

        {rules.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-zinc-800 px-3.5 py-4 text-center text-xs text-slate-500 dark:text-zinc-400">
            Nenhuma regra personalizada aplicada diretamente aqui — esta pasta segue o comportamento padrão e/ou herdado.
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((r, idx) => {
              const subj = resolveRuleSubjectDisplay(r);
              const SubjIcon = subj.Icon;
              const currentLevel = String(r.accessLevel || r.access_level || 'reader').toLowerCase();
              const levelDef = ACCESS_LEVEL_MAP[currentLevel] || ACCESS_LEVEL_MAP.reader;

              return (
                <div
                  key={r.id || `${subj.title}-${idx}`}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 px-3 py-2.5"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${subj.iconBg}`}>
                      <SubjIcon size={15} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {subj.title}
                        </span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400">
                          {subj.category}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-zinc-400 truncate">
                        {subj.subtitle}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {canManageAcl && selectedNode ? (
                      <select
                        aria-label={`Alterar nível de acesso de ${subj.title}`}
                        disabled={saving}
                        value={currentLevel}
                        onChange={(e) =>
                          onSaveRule?.(selectedNode.id, {
                            targetType: r.targetType || r.target_type,
                            targetValue: r.targetValue || r.target_value,
                            accessLevel: e.target.value,
                          })
                        }
                        className={`min-h-[34px] rounded-lg border px-2.5 py-1 text-[11px] font-bold cursor-pointer ${levelDef.badgeClass}`}
                      >
                        {ACCESS_LEVEL_DEFINITIONS.map((lvl) => (
                          <option
                            key={lvl.id}
                            value={lvl.id}
                            className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-white"
                          >
                            {lvl.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold ${levelDef.badgeClass}`}>
                        {levelDef.shortLabel}
                      </span>
                    )}

                    {canManageAcl && r.id && selectedNode && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => onDeleteRule?.(selectedNode.id, r.id)}
                        title="Remover esta permissão"
                        aria-label={`Remover regra de ${subj.title}`}
                        className="p-2 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-colors disabled:opacity-40"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* REGRAS HERDADAS DE PASTAS SUPERIORES */}
      {inheritedRules.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-400 dark:text-zinc-500">
            Herdado de pastas superiores ({inheritedRules.length})
          </h3>
          <div className="space-y-1.5">
            {inheritedRules.map((r, idx) => {
              const subj = resolveRuleSubjectDisplay(r);
              const levelDef =
                ACCESS_LEVEL_MAP[String(r.accessLevel || r.access_level || 'reader').toLowerCase()] ||
                ACCESS_LEVEL_MAP.reader;
              return (
                <div
                  key={`inh-${r.id || idx}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/70 dark:border-zinc-800/70 bg-slate-50/70 dark:bg-zinc-900/40 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <span className="font-bold text-slate-700 dark:text-zinc-200">{subj.title}</span>
                    <span className="text-[11px] text-slate-500 ml-1.5">
                      (de <span className="font-mono">{r.sourcePath || r.sourceName}</span>)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${levelDef.badgeClass}`}>
                      {levelDef.shortLabel}
                    </span>
                    {!lockSelectedNode && r.sourceNodeId && onSelectNodeId && (
                      <button
                        type="button"
                        onClick={() => onSelectNodeId(r.sourceNodeId)}
                        className="text-[11px] font-bold text-brand-aa hover:underline"
                      >
                        Editar na origem
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* FORMULÁRIO GUIADO: ADICIONAR NOVA PERMISSÃO */}
      {canManageAcl && selectedNode && (
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/50 p-4 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
              <Plus size={14} className="text-brand-aa" />
              <span>Adicionar ou sobrescrever permissão</span>
            </h3>
          </div>

          {/* PASSO 1: QUEM? (Setor / Pessoa / Perfil) */}
          <div className="space-y-1.5">
            <span className="block text-[11px] font-bold text-slate-600 dark:text-zinc-300">
              Quem receberá esta regra?
            </span>
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Tipo de destinatário da permissão">
              {[
                { id: 'department', label: 'Setor / Área', Icon: Building2 },
                { id: 'user', label: 'Colaborador', Icon: User },
                { id: 'role', label: 'Perfil Geral', Icon: Users },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleTypeSwitch(id)}
                  className={`min-h-[38px] px-2.5 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                    targetType === id
                      ? 'border-brand bg-brand text-brand-fg shadow-sm'
                      : 'border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-200 hover:border-brand/40'
                  }`}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* PASSO 2: SELECIONAR SETOR / PESSOA / PERFIL */}
          <div className="space-y-1.5">
            {targetType === 'department' && (
              <>
                <div className="flex items-center justify-between">
                  <label htmlFor="acl-dept-input" className="text-[11px] font-bold text-slate-600 dark:text-zinc-300">
                    Escolha o setor / departamento
                  </label>
                  {knownDepartments.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomTargetMode((v) => !v);
                        setTargetValue('');
                      }}
                      className="text-[11px] font-bold text-brand-aa hover:underline"
                    >
                      {customTargetMode ? 'Escolher da lista' : 'Digitar outro nome'}
                    </button>
                  )}
                </div>
                {knownDepartments.length > 0 && !customTargetMode ? (
                  <select
                    id="acl-dept-input"
                    aria-label="Valor do Alvo ACL"
                    value={targetValue}
                    onChange={(e) => setTargetValue(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-xs font-semibold"
                  >
                    <option value="">Selecione um setor…</option>
                    {knownDepartments.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="acl-dept-input"
                    type="text"
                    aria-label="Valor do Alvo ACL"
                    value={targetValue}
                    onChange={(e) => setTargetValue(e.target.value)}
                    placeholder="Ex: Financeiro, Vendas, Pós-Vendas…"
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-xs"
                  />
                )}
              </>
            )}

            {targetType === 'user' && (
              <>
                <div className="flex items-center justify-between">
                  <label htmlFor="acl-user-input" className="text-[11px] font-bold text-slate-600 dark:text-zinc-300">
                    Escolha o colaborador
                  </label>
                  {knownPeople.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomTargetMode((v) => !v);
                        setTargetValue('');
                      }}
                      className="text-[11px] font-bold text-brand-aa hover:underline"
                    >
                      {customTargetMode ? 'Escolher da lista' : 'Digitar e-mail manualmente'}
                    </button>
                  )}
                </div>
                {knownPeople.length > 0 && !customTargetMode ? (
                  <div className="space-y-1.5">
                    {knownPeople.length > 6 && (
                      <input
                        type="search"
                        value={userFilter}
                        onChange={(e) => setUserFilter(e.target.value)}
                        placeholder="Filtrar pessoa por nome, e-mail ou setor…"
                        className="w-full min-h-[34px] rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 text-xs"
                      />
                    )}
                    <select
                      id="acl-user-input"
                      aria-label="Valor do Alvo ACL"
                      value={targetValue}
                      onChange={(e) => setTargetValue(e.target.value)}
                      className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-xs font-semibold"
                    >
                      <option value="">Selecione um colaborador…</option>
                      {filteredPeople.map((p) => (
                        <option key={p.email} value={p.email}>
                          {p.name} ({p.email}){p.department ? ` — ${p.department}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <input
                    id="acl-user-input"
                    type="email"
                    aria-label="Valor do Alvo ACL"
                    value={targetValue}
                    onChange={(e) => setTargetValue(e.target.value)}
                    placeholder="colaborador@empresa.com.br"
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-xs"
                  />
                )}
              </>
            )}

            {targetType === 'role' && (
              <>
                <label htmlFor="acl-role-input" className="block text-[11px] font-bold text-slate-600 dark:text-zinc-300">
                  Escolha o perfil de usuários
                </label>
                <select
                  id="acl-role-input"
                  aria-label="Valor do Alvo ACL"
                  value={targetValue || 'collaborator'}
                  onChange={(e) => setTargetValue(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-xs font-semibold"
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} — {opt.hint}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          {/* PASSO 3: NÍVEL DE PERMISSÃO COM CHECKLIST VISUAL */}
          <div className="space-y-1.5">
            <span className="block text-[11px] font-bold text-slate-600 dark:text-zinc-300">
              O que poderá fazer nesta pasta?
            </span>
            <div className="grid grid-cols-1 gap-1.5" role="radiogroup" aria-label="Nível de Acesso ACL">
              {ACCESS_LEVEL_DEFINITIONS.map((lvl) => {
                const LvlIcon = lvl.Icon;
                const selected = accessLevel === lvl.id;
                return (
                  <button
                    key={lvl.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setAccessLevel(lvl.id)}
                    className={`w-full text-left rounded-xl border px-3 py-2.5 transition-all flex items-start gap-2.5 ${
                      selected
                        ? `${lvl.ringClass} ring-1 ring-inset ring-current/15`
                        : 'border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-slate-300 dark:hover:border-zinc-700'
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${lvl.badgeClass}`}>
                      <LvlIcon size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-black text-slate-900 dark:text-white">
                          {lvl.label}
                        </span>
                        {selected && <Check size={14} className="text-brand-aa shrink-0" />}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5 leading-snug">
                        {lvl.description}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[10px] font-bold">
                        <span className={lvl.capabilities.view ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 line-through'}>
                          Ver
                        </span>
                        <span className="text-slate-300 dark:text-zinc-700">•</span>
                        <span className={lvl.capabilities.download ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 line-through'}>
                          Baixar
                        </span>
                        <span className="text-slate-300 dark:text-zinc-700">•</span>
                        <span className={lvl.capabilities.write ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 line-through'}>
                          Enviar/Editar
                        </span>
                        <span className="text-slate-300 dark:text-zinc-700">•</span>
                        <span className={lvl.capabilities.deleteAny ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 line-through'}>
                          Apagar tudo
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="submit"
            disabled={saving || !String(targetValue || '').trim()}
            className="w-full min-h-[42px] rounded-xl bg-brand text-brand-fg text-xs font-black flex items-center justify-center gap-2 shadow-sm hover:opacity-95 disabled:opacity-50"
          >
            <ShieldCheck size={15} />
            <span>{saving ? 'Salvando permissão…' : 'Salvar Permissão na Pasta'}</span>
          </button>
        </form>
      )}
    </div>
  );
}
