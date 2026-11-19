// src/components/portal/CollaboratorAccessWorkspace.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { microservicesApi, resolvePortalUrl } from '../../services/microservicesClient';
import { generateRandomSecurePassword } from '../../utils/passwords';
import { buildBrandedPortalUrl } from '../../utils/portalBranding';
import { isMatchingHolder } from '../../utils/employeeMatching';
import { useConfirm } from '../ConfirmDialog';
import {
  captureFocusTarget,
  getFocusableElements,
  restoreFocusSafely,
  trapFocusWithin,
} from '../../utils/focusTrap';
import { isTopmostModal } from '../../utils/modalStack';

const PORTAL_VISIBLE_ROLES = new Set(['collaborator', 'owner', 'admin', 'manager']);

const EMPTY_FORM = () => ({
  name: '',
  email: '',
  department: '',
  jobTitle: '',
  password: generateRandomSecurePassword(14),
});

/**
 * Workspace compartilhado para provisionamento e gestao de acessos do Portal do Colaborador.
 * Reutilizado tanto na pagina dedicada `/portal-colaboradores` quanto na aba de acessos em `/employees`.
 */
const CollaboratorAccessWorkspace = ({
  currentUser,
  portalUsers = [],
  portalLoading = false,
  portalError = '',
  employees = [],
  sectors = [],
  onRefreshUsers,
  onPortalUsersChange,
  preselectedEmployee = null,
}) => {
  const confirm = useConfirm();
  const [form, setForm] = useState(() => ({
    name: preselectedEmployee?.name || '',
    email: preselectedEmployee?.email || '',
    department: preselectedEmployee?.sector || '',
    jobTitle: preselectedEmployee?.role || '',
    password: generateRandomSecurePassword(14),
  }));
  const [showPassword, setShowPassword] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyUserId, setBusyUserId] = useState(null);
  const [credsModal, setCredsModal] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [statusAnnouncement, setStatusAnnouncement] = useState('');
  const credsModalRef = useRef(null);
  const credsReturnFocusRef = useRef(null);
  const isCredsModalOpen = Boolean(credsModal);

  useEffect(() => {
    const dialogEl = credsModalRef.current;
    if (!isCredsModalOpen || !dialogEl) return undefined;

    credsReturnFocusRef.current = captureFocusTarget(dialogEl);
    const focusables = getFocusableElements(dialogEl);
    (focusables[0] || dialogEl).focus();

    const handleKeyDown = (event) => {
      if (!isTopmostModal(dialogEl)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setCredsModal(null);
        return;
      }
      if (event.key === 'Tab') {
        trapFocusWithin(event, dialogEl);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const previous = credsReturnFocusRef.current;
      credsReturnFocusRef.current = null;
      restoreFocusSafely(previous, null, dialogEl);
    };
  }, [isCredsModalOpen]);

  const rawPortalUrl = resolvePortalUrl();
  const brandedPortalUrl = useMemo(
    () => buildBrandedPortalUrl(rawPortalUrl, currentUser),
    [rawPortalUrl, currentUser],
  );

  const portalEmails = useMemo(
    () => new Set((portalUsers || []).map((u) => String(u.email || '').toLowerCase().trim())),
    [portalUsers],
  );

  const hasPortalAccount = (emp) => {
    if (!emp) return false;
    const empEmail = String(emp.email || '').toLowerCase().trim();
    if (empEmail && portalEmails.has(empEmail)) return true;
    return Boolean(
      emp.name &&
        (portalUsers || []).some((u) => u?.name && isMatchingHolder(u.name, emp.name)),
    );
  };

  const unprovisionedEmployees = useMemo(
    () => (employees || []).filter((emp) => emp.email && !hasPortalAccount(emp)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employees, portalEmails, portalUsers],
  );

  const selectableHrEmployees = useMemo(
    () =>
      (employees || []).filter((emp) => {
        if (!emp.email) return false;
        const cleanEmail = String(emp.email).toLowerCase().trim();
        if (portalEmails.has(cleanEmail)) return true;
        return !hasPortalAccount(emp);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employees, portalEmails, portalUsers],
  );

  const collaboratorsOnly = useMemo(
    () => (portalUsers || []).filter((u) => PORTAL_VISIBLE_ROLES.has(u.role)),
    [portalUsers],
  );

  const filteredPortalUsers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return collaboratorsOnly.filter((u) => {
      if (statusFilter === 'active' && u.active === false) return false;
      if (statusFilter === 'inactive' && u.active !== false) return false;
      if (!q) return true;
      const hay = `${u.name || ''} ${u.email || ''} ${u.department || ''} ${u.job_title || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [collaboratorsOnly, searchTerm, statusFilter]);

  const fillFromEmployee = (emp) => {
    if (!emp) return;
    setForm((prev) => ({
      ...prev,
      name: emp.name || prev.name,
      email: emp.email || prev.email,
      department: emp.sector || prev.department,
      jobTitle: emp.role || prev.jobTitle,
    }));
    const msg = `Dados de ${emp.name} preenchidos no formulário.`;
    setStatusAnnouncement(msg);
    toast.info(msg);
  };

  const regeneratePassword = () => {
    setForm((prev) => ({ ...prev, password: generateRandomSecurePassword(14) }));
    setStatusAnnouncement('Nova senha aleatória gerada no formulário.');
  };

  const copyText = async (text, msg) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatusAnnouncement(msg);
      toast.success(msg);
    } catch {
      const errMsg = 'Não foi possível copiar para a área de transferência.';
      setStatusAnnouncement(errMsg);
      toast.error(errMsg);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    const cleanEmail = String(form.email || '').trim().toLowerCase();
    const cleanName = String(form.name || '').trim();
    const createdPassword = form.password;
    if (!cleanName || !cleanEmail || !createdPassword) {
      toast.error('Preencha nome, e-mail corporativo e senha.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await microservicesApi.createUser({
        name: cleanName,
        email: cleanEmail,
        password: createdPassword,
        role: 'collaborator',
        department: String(form.department || '').trim() || 'Geral',
        jobTitle: String(form.jobTitle || '').trim() || 'Colaborador',
        active: true,
      });

      const created = res?.user;
      if (onRefreshUsers) {
        try {
          await onRefreshUsers();
        } catch (refreshErr) {
          console.warn('Acesso criado, mas falhou ao atualizar a lista:', refreshErr);
          if (created && onPortalUsersChange) {
            onPortalUsersChange((prev) => [created, ...prev.filter((x) => x.id !== created.id)]);
          }
          (toast.warning || toast.info)(
            refreshErr?.message || 'Acesso criado, mas não foi possível atualizar a lista de contas.',
          );
        }
      } else if (created && onPortalUsersChange) {
        onPortalUsersChange((prev) => [created, ...prev.filter((x) => x.id !== created.id)]);
      }

      setCredsModal({
        mode: 'created',
        name: cleanName,
        email: cleanEmail,
        password: createdPassword,
        portalUrl: brandedPortalUrl || rawPortalUrl,
      });

      setForm(EMPTY_FORM());
      const successMsg = `Acesso ao Portal liberado para ${cleanName}!`;
      setStatusAnnouncement(successMsg);
      toast.success(successMsg);
    } catch (err) {
      console.error('Erro ao cadastrar acesso do colaborador:', err);
      const errMsg = err?.message || 'Não foi possível criar o acesso ao portal.';
      setStatusAnnouncement(errMsg);
      toast.error(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (user) => {
    const nextActive = user.active === false;
    const actionLabel = nextActive ? 'Reativar' : 'Suspender';
    const ok = await confirm({
      title: `${actionLabel} Acesso ao Portal`,
      message: `${actionLabel} o login de ${user.name} (${user.email}) no Portal do Colaborador?`,
      danger: !nextActive,
      confirmLabel: actionLabel,
    });
    if (!ok) return;

    setBusyUserId(user.id);
    try {
      const res = await microservicesApi.updateUser(user.id, { active: nextActive });
      const updated = res?.user || { ...user, active: nextActive };
      onPortalUsersChange?.((prev) => prev.map((x) => (x.id === user.id ? updated : x)));
      const msg = nextActive ? `Acesso de ${user.name} reativado.` : `Acesso de ${user.name} suspenso.`;
      setStatusAnnouncement(msg);
      toast.success(msg);
    } catch (err) {
      toast.error(err?.message || `Falha ao ${actionLabel.toLowerCase()} acesso.`);
    } finally {
      setBusyUserId(null);
    }
  };

  const handleResetPassword = async (user) => {
    const newPassword = generateRandomSecurePassword(14);
    const ok = await confirm({
      title: 'Redefinir Senha do Colaborador',
      message: `Gerar uma nova senha forte aleatória para ${user.name} (${user.email})? A senha anterior deixará de funcionar imediatamente.`,
      danger: false,
      confirmLabel: 'Gerar e Aplicar',
    });
    if (!ok) return;

    setBusyUserId(user.id);
    try {
      await microservicesApi.updateUser(user.id, { password: newPassword });
      setCredsModal({
        mode: 'reset',
        name: user.name,
        email: user.email,
        password: newPassword,
        portalUrl: brandedPortalUrl || rawPortalUrl,
      });
      const msg = `Nova senha gerada para ${user.name}!`;
      setStatusAnnouncement(msg);
      toast.success(msg);
    } catch (err) {
      toast.error(err?.message || 'Não foi possível redefinir a senha.');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRevoke = async (user) => {
    const ok = await confirm({
      title: 'Revogar Acesso ao Portal',
      message: `Deseja remover permanentemente a conta de ${user.name} (${user.email})? O colaborador perderá o acesso imediato ao portal.`,
      danger: true,
      confirmLabel: 'Revogar Acesso',
    });
    if (!ok) return;

    setBusyUserId(user.id);
    try {
      await microservicesApi.deleteUser(user.id);
      onPortalUsersChange?.((prev) => prev.filter((x) => x.id !== user.id));
      const msg = `Acesso de ${user.name} revogado com sucesso.`;
      setStatusAnnouncement(msg);
      toast.success(msg);
    } catch (err) {
      toast.error(err?.message || 'Não foi possível revogar o acesso.');
    } finally {
      setBusyUserId(null);
    }
  };

  const formatCredentialsText = (creds, isWhatsapp = false) => {
    if (!creds) return '';
    if (isWhatsapp) {
      return [
        `Olá ${creds.name}!`,
        `Seu acesso ao *Portal do Colaborador (${currentUser?.companyName || 'Nexus ITAM'})* foi liberado:`,
        ``,
        `🔗 *Portal:* ${creds.portalUrl}`,
        `📧 *E-mail:* ${creds.email}`,
        `🔑 *Senha provisória:* ${creds.password}`,
        ``,
        `Por segurança, utilize a opção de troca de senha após o primeiro login caso necessário.`,
      ].join('\n');
    }
    return `Portal do Colaborador — ${currentUser?.companyName || 'Nexus ITAM'}\nLink: ${creds.portalUrl}\nE-mail: ${creds.email}\nSenha: ${creds.password}`;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div role="status" aria-live="polite" className="sr-only">
        {statusAnnouncement}
      </div>

      {/* Banner LGPD */}
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-2xl p-4 sm:p-5 flex items-start gap-3">
        <ShieldCheck size={20} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900 dark:text-amber-200 space-y-1">
          <p className="font-black uppercase tracking-wider text-amber-800 dark:text-amber-300">
            Aderência às Normas LGPD (Lei 13.709/2018 - Art. 6º e 46)
          </p>
          <p className="leading-relaxed">
            As credenciais criadas aqui são pessoais, criptografadas e restritas à consulta de equipamentos em custódia, assinatura digital de termos (Art. 462 CLT) e abertura de chamados N1/N2. Ao cadastrar, entregue a senha em canal seguro diretamente ao colaborador.
          </p>
        </div>
      </div>

      {/* Sugestão rápida de colaboradores da base ainda sem acesso */}
      {unprovisionedEmployees.length > 0 && (
        <div className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200 dark:border-zinc-800 p-4 shadow-sm space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
              <Sparkles size={14} className="text-brand-aa" />
              Colaboradores da Base sem Acesso ao Portal ({unprovisionedEmployees.length})
            </p>
            <span className="text-xs text-slate-500 dark:text-zinc-400">Clique para preencher automaticamente</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {unprovisionedEmployees.slice(0, 8).map((emp) => (
              <button
                key={emp.id}
                type="button"
                onClick={() => fillFromEmployee(emp)}
                className="inline-flex min-h-[44px] items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-[#18181b] hover:border-brand/60 hover:bg-brand/5 text-left transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <UserPlus size={13} className="text-brand-aa shrink-0" />
                <div className="text-xs">
                  <span className="font-bold text-slate-800 dark:text-[#fafafa]">{emp.name}</span>
                  <span className="text-slate-500 dark:text-zinc-400 ml-1.5 text-xs">({emp.email})</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* FORMULÁRIO DE CADASTRO */}
        <form
          onSubmit={handleCreate}
          className="lg:col-span-5 bg-white dark:bg-[#111113] rounded-2xl border border-slate-200 dark:border-zinc-800 p-6 shadow-sm space-y-4"
        >
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-zinc-800">
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
                <UserPlus size={17} className="text-brand-aa" />
                Cadastro de Acesso ao Portal do Colaborador
              </h2>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                Provisionamento imediato no API Gateway (JWT Isolado).
              </p>
            </div>
          </div>

          {selectableHrEmployees.length > 0 && (
            <div>
              <label htmlFor="portal-emp-picker" className="block text-xs font-bold uppercase text-slate-500 dark:text-zinc-400 mb-1">
                Importar rapidamente da equipe cadastrada
              </label>
              <select
                id="portal-emp-picker"
                name="employeePicker"
                defaultValue=""
                onChange={(e) => {
                  const found = selectableHrEmployees.find((emp) => emp.id === e.target.value);
                  if (found) fillFromEmployee(found);
                }}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-[#18181b] text-xs font-semibold text-slate-800 dark:text-[#fafafa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <option value="">Selecionar colaborador com e-mail cadastrado…</option>
                {selectableHrEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} — {emp.email} {hasPortalAccount(emp) ? '(Já possui acesso)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="portal-name" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
              Nome Completo
            </label>
            <input
              id="portal-name"
              name="name"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex: Roberto Souza"
              className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-[#18181b] text-sm font-medium text-slate-900 dark:text-[#fafafa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </div>

          <div>
            <label htmlFor="portal-email" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
              E-mail Corporativo (Login)
            </label>
            <div className="relative">
              <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" aria-hidden="true" />
              <input
                id="portal-email"
                name="email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="colaborador@empresa.com.br"
                className="w-full min-h-[44px] pl-9 pr-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-[#18181b] text-sm font-medium text-slate-900 dark:text-[#fafafa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="portal-dept" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                Departamento / Setor
              </label>
              <input
                id="portal-dept"
                name="department"
                type="text"
                list="portal-sectors-datalist"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
                placeholder="Ex: Operações / Vendas"
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-[#18181b] text-sm font-medium text-slate-900 dark:text-[#fafafa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
              {sectors.length > 0 && (
                <datalist id="portal-sectors-datalist">
                  {sectors.map((s) => (
                    <option key={s.id || s.name} value={s.name} />
                  ))}
                </datalist>
              )}
            </div>

            <div>
              <label htmlFor="portal-job" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                Cargo / Função
              </label>
              <input
                id="portal-job"
                name="jobTitle"
                type="text"
                value={form.jobTitle}
                onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
                placeholder="Ex: Consultor Comercial"
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-[#18181b] text-sm font-medium text-slate-900 dark:text-[#fafafa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
            </div>
          </div>

          {/* Geração de Senha Aleatória Segura */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#18181b] border border-slate-200 dark:border-zinc-800 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="portal-password" className="text-xs font-black text-slate-700 dark:text-zinc-200 flex items-center gap-1.5">
                <Lock size={13} className="text-brand-aa" />
                Geração de Senha Aleatória Segura
              </label>
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar senha gerada' : 'Mostrar senha gerada'}
                className="min-h-[44px] px-2 rounded-lg text-xs font-bold text-slate-600 dark:text-zinc-300 hover:text-brand-aa flex items-center gap-1 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                <span>{showPassword ? 'Ocultar' : 'Mostrar'}</span>
              </button>
            </div>

            <div className="flex gap-2">
              <input
                id="portal-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="flex-1 min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-[#111113] font-mono text-xs font-bold text-slate-900 dark:text-[#fafafa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={regeneratePassword}
                className="inline-flex min-h-[44px] items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-[#111113] text-xs font-bold text-slate-700 dark:text-zinc-200 hover:border-brand/50 hover:text-brand-aa transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <RefreshCw size={13} /> Gerar Outra Senha
              </button>
              <button
                type="button"
                onClick={() => copyText(form.password, 'Senha copiada para a área de transferência!')}
                className="inline-flex min-h-[44px] items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-[#111113] text-xs font-bold text-slate-700 dark:text-zinc-200 hover:border-brand/50 hover:text-brand-aa transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <Copy size={13} /> Copiar Senha
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[44px] py-3 px-4 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-md shadow-brand/20 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
          >
            <CheckCircle2 size={16} />
            <span>{submitting ? 'Provisionando…' : 'Cadastrar e Liberar Acesso ao Portal'}</span>
          </button>
        </form>

        {/* LISTA DE ACESSOS EXISTENTES */}
        <div className="lg:col-span-7 bg-white dark:bg-[#111113] rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 dark:border-zinc-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
                  <Users size={16} className="text-brand-aa" />
                  Contas Provisionadas no Gateway (<span className="tabular-nums">{filteredPortalUsers.length}</span>)
                </h2>
                <p className="text-xs text-slate-500 dark:text-zinc-400">
                  Gerencie logins ativos, suspensões temporárias ou redefinição de senhas.
                </p>
              </div>
              {onRefreshUsers && (
                <button
                  type="button"
                  onClick={onRefreshUsers}
                  aria-label="Atualizar lista de contas"
                  title="Atualizar lista de contas"
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-2 rounded-xl border border-slate-200 dark:border-zinc-700 text-slate-500 dark:text-zinc-300 hover:text-brand-aa hover:border-brand/40 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <RefreshCw size={15} className={portalLoading ? 'animate-spin' : ''} />
                </button>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <label htmlFor="portal-users-search" className="sr-only">
                  Filtrar contas provisionadas por nome, e-mail ou setor
                </label>
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" aria-hidden="true" />
                <input
                  id="portal-users-search"
                  name="portalUsersSearch"
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Filtrar por nome, e-mail ou setor…"
                  className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-[#18181b] text-xs font-medium text-slate-900 dark:text-[#fafafa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>
              <div className="flex rounded-xl border border-slate-200 dark:border-zinc-700 overflow-hidden bg-slate-50 dark:bg-[#18181b] text-xs font-bold">
                {[
                  { id: 'all', label: 'Todos' },
                  { id: 'active', label: 'Ativos' },
                  { id: 'inactive', label: 'Suspensos' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={statusFilter === f.id}
                    onClick={() => setStatusFilter(f.id)}
                    className={`min-h-[44px] px-3 py-2 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${
                      statusFilter === f.id
                        ? 'bg-brand text-brand-fg'
                        : 'text-slate-600 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-[#fafafa]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {portalLoading ? (
            <div role="status" aria-live="polite" className="p-6 space-y-3">
              <div className="h-14 rounded-xl bg-slate-100 dark:bg-[#18181b] animate-pulse" />
              <div className="h-14 rounded-xl bg-slate-100 dark:bg-[#18181b] animate-pulse" />
              <div className="h-14 rounded-xl bg-slate-100 dark:bg-[#18181b] animate-pulse" />
              <p className="text-xs text-center font-medium text-slate-500 dark:text-zinc-400">
                Consultando contas no API Gateway…
              </p>
            </div>
          ) : portalError ? (
            <div role="alert" className="p-8 text-center space-y-3">
              <AlertCircle size={26} className="mx-auto text-rose-500" />
              <div className="space-y-1">
                <p className="text-sm font-black text-slate-900 dark:text-[#fafafa]">
                  Falha ao carregar contas do portal
                </p>
                <p className="text-xs text-rose-600 dark:text-rose-400">
                  {portalError}
                </p>
              </div>
              {onRefreshUsers && (
                <button
                  type="button"
                  onClick={onRefreshUsers}
                  className="inline-flex min-h-[44px] items-center gap-2 px-4 py-2 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <RefreshCw size={14} /> Tentar novamente
                </button>
              )}
            </div>
          ) : filteredPortalUsers.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <AlertCircle size={24} className="mx-auto text-slate-400 dark:text-zinc-500" />
              <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400">
                Nenhuma conta encontrada para os filtros aplicados.
              </p>
              {(searchTerm.trim() || statusFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setStatusFilter('all');
                  }}
                  className="inline-flex min-h-[44px] items-center px-3.5 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-bold text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-[#18181b] transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  Limpar filtros
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-zinc-800 max-h-[560px] overflow-y-auto overscroll-contain">
              {filteredPortalUsers.map((u) => {
                const isActive = u.active !== false;
                const isCollaborator = u.role === 'collaborator';
                const busy = busyUserId === u.id;
                return (
                  <div
                    key={u.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-[#18181b]/70 transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 text-brand-aa flex items-center justify-center font-black text-sm shrink-0">
                        {(u.name || u.email || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-bold text-slate-900 dark:text-[#fafafa] truncate">
                            {u.name}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-black uppercase ${
                              isActive
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                                : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {isActive ? 'Ativo' : 'Suspenso'}
                          </span>
                          <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300">
                            {isCollaborator ? 'Colaborador' : u.role}
                          </span>
                        </div>
                        <p className="text-xs font-mono text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                          {u.email}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                          {u.department || 'Geral'} • {u.job_title || 'Colaborador'}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => copyText(u.email, `E-mail ${u.email} copiado!`)}
                        className="min-h-[44px] px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-700 text-xs font-bold text-brand-aa hover:bg-brand/5 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        Copiar E-mail
                      </button>

                      {u.role !== 'owner' && (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleResetPassword(u)}
                            title="Gerar nova senha para este colaborador"
                            aria-label={`Redefinir senha de ${u.name || u.email}`}
                            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-2 rounded-lg border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:text-brand-aa hover:border-brand/40 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                          >
                            <KeyRound size={15} />
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleToggleActive(u)}
                            title={isActive ? 'Suspender acesso temporariamente' : 'Reativar acesso'}
                            aria-label={
                              isActive
                                ? `Suspender acesso temporariamente de ${u.name || u.email}`
                                : `Reativar acesso de ${u.name || u.email}`
                            }
                            className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-2 rounded-lg border transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 ${
                              isActive
                                ? 'border-amber-200 dark:border-amber-900/50 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                                : 'border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                            }`}
                          >
                            {isActive ? <Pause size={15} /> : <Play size={15} />}
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleRevoke(u)}
                            className="inline-flex min-h-[44px] items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 dark:border-rose-900/50 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50"
                            title="Revogar acesso deste colaborador"
                          >
                            <Trash2 size={14} />
                            <span>Revogar</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* MODAL DE CREDENCIAIS GERADAS / REDEFINIDAS */}
      {credsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            aria-hidden="true"
            className="fixed inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
            onClick={() => setCredsModal(null)}
          />
          <div
            ref={credsModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="creds-modal-title"
            tabIndex={-1}
            className="relative bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto overscroll-contain p-6 shadow-2xl space-y-4 animate-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <button
              type="button"
              onClick={() => setCredsModal(null)}
              aria-label="Fechar modal de credenciais"
              className="absolute top-3 right-3 min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-2 rounded-lg text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-[#fafafa] hover:bg-slate-100 dark:hover:bg-[#18181b] transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-3 pr-10">
              <div className="w-11 h-11 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Check size={22} />
              </div>
              <div>
                <h3 id="creds-modal-title" className="text-base font-black text-slate-900 dark:text-[#fafafa]">
                  {credsModal.mode === 'reset' ? 'Senha Redefinida com Sucesso!' : 'Acesso Criado com Sucesso!'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-zinc-400">
                  Entregue estas credenciais diretamente ao colaborador.
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-[#18181b] border border-slate-200 dark:border-zinc-800 p-4 space-y-2.5 text-xs">
              <div>
                <span className="text-xs font-bold uppercase text-slate-500 dark:text-zinc-400 block">Colaborador</span>
                <span className="font-bold text-slate-900 dark:text-[#fafafa]">{credsModal.name}</span>
              </div>
              <div>
                <span className="text-xs font-bold uppercase text-slate-500 dark:text-zinc-400 block">Login (E-mail)</span>
                <span className="font-mono font-bold text-slate-800 dark:text-zinc-200">{credsModal.email}</span>
              </div>
              <div>
                <span className="text-xs font-bold uppercase text-slate-500 dark:text-zinc-400 block">Senha Gerada</span>
                <span className="font-mono font-black text-sm text-brand-aa select-all">{credsModal.password}</span>
              </div>
              <div>
                <span className="text-xs font-bold uppercase text-slate-500 dark:text-zinc-400 block">Link Whitelabel do Portal</span>
                <a
                  href={credsModal.portalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[44px] font-mono text-xs text-brand-aa hover:underline inline-flex items-center gap-1 break-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
                >
                  <span>{credsModal.portalUrl}</span>
                  <ExternalLink size={12} className="shrink-0" />
                </a>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => copyText(formatCredentialsText(credsModal, false), 'Credenciais completas copiadas!')}
                className="min-h-[44px] py-2.5 px-3 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-black flex items-center justify-center gap-1.5 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <Copy size={14} /> Copiar Credenciais Completas
              </button>
              <button
                type="button"
                onClick={() => copyText(formatCredentialsText(credsModal, true), 'Mensagem formatada para WhatsApp copiada!')}
                className="min-h-[44px] py-2.5 px-3 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-black flex items-center justify-center gap-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <MessageSquare size={14} /> Copiar p/ WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CollaboratorAccessWorkspace;
