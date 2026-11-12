// src/components/portal/CollaboratorAccessWorkspace.jsx
import React, { useMemo, useState } from 'react';
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
import { useConfirm } from '../ConfirmDialog';

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

  const rawPortalUrl = resolvePortalUrl();
  const brandedPortalUrl = useMemo(
    () => buildBrandedPortalUrl(rawPortalUrl, currentUser),
    [rawPortalUrl, currentUser],
  );

  const portalEmails = useMemo(
    () => new Set((portalUsers || []).map((u) => String(u.email || '').toLowerCase().trim())),
    [portalUsers],
  );

  const unprovisionedEmployees = useMemo(
    () =>
      (employees || []).filter(
        (emp) => emp.email && !portalEmails.has(String(emp.email).toLowerCase().trim()),
      ),
    [employees, portalEmails],
  );

  const collaboratorsOnly = useMemo(
    () => (portalUsers || []).filter((u) => u.role === 'collaborator' || u.role === 'owner' || u.role === 'admin' || u.role === 'manager' || u.role),
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
    toast.info(`Dados de ${emp.name} preenchidos no formulário.`);
  };

  const regeneratePassword = () => {
    setForm((prev) => ({ ...prev, password: generateRandomSecurePassword(14) }));
  };

  const copyText = async (text, msg) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(msg);
    } catch {
      toast.error('Não foi possível copiar para a área de transferência.');
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    const cleanEmail = String(form.email || '').trim().toLowerCase();
    const cleanName = String(form.name || '').trim();
    if (!cleanName || !cleanEmail || !form.password) {
      toast.error('Preencha nome, e-mail corporativo e senha.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await microservicesApi.createUser({
        name: cleanName,
        email: cleanEmail,
        password: form.password,
        role: 'collaborator',
        department: String(form.department || '').trim() || 'Geral',
        jobTitle: String(form.jobTitle || '').trim() || 'Colaborador',
        active: true,
      });

      const created = res?.user;
      if (onRefreshUsers) {
        await onRefreshUsers();
      } else if (created && onPortalUsersChange) {
        onPortalUsersChange((prev) => [created, ...prev.filter((x) => x.id !== created.id)]);
      }

      setCredsModal({
        mode: 'created',
        name: cleanName,
        email: cleanEmail,
        password: form.password,
        portalUrl: brandedPortalUrl || rawPortalUrl,
      });

      setForm(EMPTY_FORM());
      toast.success(`Acesso ao Portal liberado para ${cleanName}!`);
    } catch (err) {
      console.error('Erro ao cadastrar acesso do colaborador:', err);
      toast.error(err?.message || 'Não foi possível criar o acesso ao portal.');
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
      toast.success(nextActive ? `Acesso de ${user.name} reativado.` : `Acesso de ${user.name} suspenso.`);
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
      toast.success(`Nova senha gerada para ${user.name}!`);
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
      toast.success(`Acesso de ${user.name} revogado com sucesso.`);
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
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Sparkles size={14} className="text-brand" />
              Colaboradores da Base sem Acesso ao Portal ({unprovisionedEmployees.length})
            </p>
            <span className="text-[11px] text-slate-400">Clique para preencher automaticamente</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {unprovisionedEmployees.slice(0, 8).map((emp) => (
              <button
                key={emp.id}
                type="button"
                onClick={() => fillFromEmployee(emp)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:border-brand/60 hover:bg-brand/5 text-left transition-all"
              >
                <UserPlus size={13} className="text-brand shrink-0" />
                <div className="text-xs">
                  <span className="font-bold text-slate-800 dark:text-slate-100">{emp.name}</span>
                  <span className="text-slate-400 ml-1.5 text-[11px]">({emp.email})</span>
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
          className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-4"
        >
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <UserPlus size={17} className="text-brand" />
                Cadastro de Acesso ao Portal do Colaborador
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Provisionamento imediato no API Gateway (JWT Isolado).
              </p>
            </div>
          </div>

          {employees.some((emp) => emp.email) && (
            <div>
              <label htmlFor="portal-emp-picker" className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
                Importar rapidamente da equipe cadastrada
              </label>
              <select
                id="portal-emp-picker"
                defaultValue=""
                onChange={(e) => {
                  const found = employees.find((emp) => emp.id === e.target.value);
                  if (found) fillFromEmployee(found);
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-brand"
              >
                <option value="">Selecionar colaborador com e-mail cadastrado...</option>
                {employees
                  .filter((emp) => emp.email)
                  .map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} — {emp.email} {portalEmails.has(emp.email.toLowerCase()) ? '(Já possui acesso)' : ''}
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="portal-name" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Nome Completo
            </label>
            <input
              id="portal-name"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex: Roberto Souza"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:border-brand"
            />
          </div>

          <div>
            <label htmlFor="portal-email" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              E-mail Corporativo (Login)
            </label>
            <div className="relative">
              <Mail size={15} className="absolute left-3.5 top-3 text-slate-400" />
              <input
                id="portal-email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="colaborador@shineraybysabel.com.br"
                className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:border-brand"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="portal-dept" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Departamento / Setor
              </label>
              <input
                id="portal-dept"
                type="text"
                list="portal-sectors-datalist"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
                placeholder="Ex: Vendas Concessionária"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:border-brand"
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
              <label htmlFor="portal-job" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Cargo / Função
              </label>
              <input
                id="portal-job"
                type="text"
                value={form.jobTitle}
                onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
                placeholder="Ex: Consultor Comercial"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:border-brand"
              />
            </div>
          </div>

          {/* Geração de Senha Aleatória Segura */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="portal-password" className="text-xs font-black text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                <Lock size={13} className="text-brand" />
                Geração de Senha Aleatória Segura
              </label>
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="text-[11px] font-bold text-slate-500 hover:text-brand flex items-center gap-1"
              >
                {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                <span>{showPassword ? 'Ocultar' : 'Mostrar'}</span>
              </button>
            </div>

            <div className="flex gap-2">
              <input
                id="portal-password"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-brand"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={regeneratePassword}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-700 dark:text-slate-200 hover:border-brand/50 hover:text-brand transition-colors"
              >
                <RefreshCw size={13} /> Gerar Outra Senha
              </button>
              <button
                type="button"
                onClick={() => copyText(form.password, 'Senha copiada para a área de transferência!')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-700 dark:text-slate-200 hover:border-brand/50 hover:text-brand transition-colors"
              >
                <Copy size={13} /> Copiar Senha
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 px-4 rounded-xl bg-brand hover:bg-brand-dark text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-md shadow-brand/20 transition-all disabled:opacity-60"
          >
            <CheckCircle2 size={16} />
            <span>{submitting ? 'Provisionando...' : 'Cadastrar e Liberar Acesso ao Portal'}</span>
          </button>
        </form>

        {/* LISTA DE ACESSOS EXISTENTES */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <Users size={16} className="text-brand" />
                  Contas Provisionadas no Gateway ({filteredPortalUsers.length})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Gerencie logins ativos, suspensões temporárias ou redefinição de senhas.
                </p>
              </div>
              {onRefreshUsers && (
                <button
                  type="button"
                  onClick={onRefreshUsers}
                  className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-brand"
                  title="Atualizar lista de contas"
                >
                  <RefreshCw size={14} className={portalLoading ? 'animate-spin' : ''} />
                </button>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Filtrar por nome, e-mail ou setor..."
                  className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-brand"
                />
              </div>
              <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-50 dark:bg-slate-950 text-xs font-bold">
                {[
                  { id: 'all', label: 'Todos' },
                  { id: 'active', label: 'Ativos' },
                  { id: 'inactive', label: 'Suspensos' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setStatusFilter(f.id)}
                    className={`px-3 py-2 transition-colors ${
                      statusFilter === f.id
                        ? 'bg-brand text-white'
                        : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {portalLoading ? (
            <div className="p-10 text-center text-xs text-slate-400 animate-pulse">
              Consultando contas no API Gateway...
            </div>
          ) : filteredPortalUsers.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <AlertCircle size={24} className="mx-auto text-slate-300 dark:text-slate-600" />
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Nenhuma conta encontrada para os filtros aplicados.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[560px] overflow-y-auto">
              {filteredPortalUsers.map((u) => {
                const isActive = u.active !== false;
                const isCollaborator = u.role === 'collaborator';
                const busy = busyUserId === u.id;
                return (
                  <div
                    key={u.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-950/50 transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 text-brand flex items-center justify-center font-black text-sm shrink-0">
                        {(u.name || u.email || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {u.name}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase ${
                              isActive
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {isActive ? 'Ativo' : 'Suspenso'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                            {isCollaborator ? 'Colaborador' : u.role}
                          </span>
                        </div>
                        <p className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {u.email}
                        </p>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
                          {u.department || 'Geral'} • {u.job_title || 'Colaborador'}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => copyText(u.email, `E-mail ${u.email} copiado!`)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-brand hover:bg-brand/5 transition-colors"
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
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-brand hover:border-brand/40 transition-colors disabled:opacity-50"
                          >
                            <KeyRound size={14} />
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleToggleActive(u)}
                            title={isActive ? 'Suspender acesso temporariamente' : 'Reativar acesso'}
                            className={`p-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
                              isActive
                                ? 'border-amber-200 dark:border-amber-900/50 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                                : 'border-emerald-200 dark:border-emerald-900/50 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                            }`}
                          >
                            {isActive ? <Pause size={14} /> : <Play size={14} />}
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleRevoke(u)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900/50 text-[11px] font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors disabled:opacity-50"
                            title="Revogar acesso deste colaborador"
                          >
                            <Trash2 size={13} />
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
        <div
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCredsModal(null);
          }}
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 relative">
            <button
              type="button"
              onClick={() => setCredsModal(null)}
              aria-label="Fechar modal de credenciais"
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Check size={22} />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white">
                  {credsModal.mode === 'reset' ? 'Senha Redefinida com Sucesso!' : 'Acesso Criado com Sucesso!'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Entregue estas credenciais diretamente ao colaborador.
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 space-y-2 text-xs">
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Colaborador</span>
                <span className="font-bold text-slate-900 dark:text-white">{credsModal.name}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Login (E-mail)</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{credsModal.email}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Senha Gerada</span>
                <span className="font-mono font-black text-sm text-brand select-all">{credsModal.password}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Link Whitelabel do Portal</span>
                <a
                  href={credsModal.portalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11px] text-brand hover:underline inline-flex items-center gap-1 break-all"
                >
                  <span>{credsModal.portalUrl}</span>
                  <ExternalLink size={11} className="shrink-0" />
                </a>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => copyText(formatCredentialsText(credsModal, false), 'Credenciais completas copiadas!')}
                className="py-2.5 px-3 rounded-xl bg-brand hover:bg-brand-dark text-white text-xs font-black flex items-center justify-center gap-1.5 transition-colors"
              >
                <Copy size={14} /> Copiar Credenciais Completas
              </button>
              <button
                type="button"
                onClick={() => copyText(formatCredentialsText(credsModal, true), 'Mensagem formatada para WhatsApp copiada!')}
                className="py-2.5 px-3 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-black flex items-center justify-center gap-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
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
