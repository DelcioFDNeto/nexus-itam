// src/pages/ServiceDeskHub.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  ExternalLink,
  FileSignature,
  Filter,
  HardDrive,
  Inbox,
  Laptop,
  Lock,
  MessageSquare,
  Network,
  Play,
  Radio,
  RefreshCw,
  Search,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  Tag,
  Terminal,
  Ticket,
  TrendingUp,
  User,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  clearGatewaySession,
  getGatewayBaseUrl,
  getGatewaySession,
  microservicesApi,
  onGatewaySessionChange,
  resolvePortalUrl,
} from '../services/microservicesClient';

const STATUS_BADGES = {
  open: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  in_progress: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
  resolved: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  closed: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
};

const STATUS_NAMES = {
  open: 'Aberto',
  in_progress: 'Em Atendimento',
  resolved: 'Resolvido',
  closed: 'Encerrado',
};

const PRIORITY_BADGES = {
  critical: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  high: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
  medium: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
  low: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
};

const PRIORITY_NAMES = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Normal',
  low: 'Baixa',
};

const ServiceDeskHub = () => {
  const [gatewaySession, setGatewaySessionState] = useState(() => getGatewaySession());
  const [clusterHealth, setClusterHealth] = useState(null);
  const [healthError, setHealthError] = useState('');
  const [wsStatus, setWsStatus] = useState('disconnected');
  const [wsFeed, setWsFeed] = useState([]);

  const [tickets, setTickets] = useState([]);
  const [terms, setTerms] = useState([]);
  const [fleet, setFleet] = useState({ summary: {}, devices: [] });
  const [chainReport, setChainReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTicketCommentId, setActiveTicketCommentId] = useState(null);
  const [ticketCommentText, setTicketCommentText] = useState('');
  const [ticketFilter, setTicketFilter] = useState('all');
  const [ticketSearch, setTicketSearch] = useState('');
  const [showDevDrawer, setShowDevDrawer] = useState(false);

  const [credentials, setCredentials] = useState({
    email: 'admin@nexuscorp.com.br',
    password: 'Nexus@2026!',
  });

  const wsRef = useRef(null);
  const gatewayUrl = getGatewayBaseUrl();
  const portalUrl = resolvePortalUrl();

  useEffect(() => {
    return onGatewaySessionChange((session) => {
      setGatewaySessionState(session);
    });
  }, []);

  const loadDomainData = useCallback(async () => {
    try {
      const health = await microservicesApi.probeClusterHealth();
      setClusterHealth(health);
      setHealthError('');
    } catch (err) {
      setHealthError(
        `API Gateway offline em ${gatewayUrl}. Inicie a malha com "npm run dev:microservices" ou "docker compose up". (${err.message})`,
      );
      return;
    }

    if (!getGatewaySession()?.token) return;

    setLoading(true);
    try {
      const [tkRes, tmRes, flRes, chRes] = await Promise.all([
        microservicesApi.listTickets(),
        microservicesApi.listTerms(),
        microservicesApi.getFleetTelemetry(),
        microservicesApi.verifyAuditChain(),
      ]);
      setTickets(tkRes.items || []);
      setTerms(tmRes.items || []);
      setFleet(flRes || { summary: {}, devices: [] });
      setChainReport(chRes);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [gatewayUrl]);

  useEffect(() => {
    let active = true;
    microservicesApi
      .probeClusterHealth()
      .then((h) => {
        if (active) {
          setClusterHealth(h);
          setHealthError('');
        }
      })
      .catch((err) => {
        if (active) {
          setHealthError(
            `Gateway não detectado em ${gatewayUrl} (${err.message}). Execute "npm run dev:microservices" ou "docker compose up -d".`,
          );
        }
      });

    if (gatewaySession?.token) {
      Promise.all([
        microservicesApi.listTickets(),
        microservicesApi.listTerms(),
        microservicesApi.getFleetTelemetry(),
        microservicesApi.verifyAuditChain(),
      ])
        .then(([tkRes, tmRes, flRes, chRes]) => {
          if (!active) return;
          setTickets(tkRes.items || []);
          setTerms(tmRes.items || []);
          setFleet(flRes || { summary: {}, devices: [] });
          setChainReport(chRes);
        })
        .catch(() => {});

      const handle = microservicesApi.openNexusDeskSocket(gatewaySession.token, {
        onStatus: (st) => {
          if (active) setWsStatus(st);
        },
        onFrame: (frame) => {
          if (!active) return;
          setWsFeed((prev) => [frame, ...prev].slice(0, 15));
          if (frame.event && frame.event !== 'welcome' && frame.event !== 'pong') {
            loadDomainData();
          }
        },
      });
      wsRef.current = handle;
    }

    return () => {
      active = false;
      wsRef.current?.close();
    };
  }, [gatewaySession?.token, gatewayUrl, loadDomainData]);

  const handleConnectGateway = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const auth = await microservicesApi.authenticate(credentials.email, credentials.password);
      setGatewaySessionState({ token: auth.accessToken, user: auth.user });
      toast.success(`Autenticado no API Gateway como ${auth.user.name}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnectGateway = () => {
    wsRef.current?.close();
    clearGatewaySession();
    setGatewaySessionState(null);
    setWsStatus('disconnected');
  };

  const handleResolveTicket = async (ticketId, nextStatus) => {
    try {
      await microservicesApi.updateTicketStatus(ticketId, {
        status: nextStatus,
        resolutionNotes:
          nextStatus === 'resolved'
            ? 'Atendimento técnico concluído. Solicitação atendida de acordo com os padrões corporativos de SLA.'
            : 'Chamado assumido pela Engenharia de Suporte N2.',
      });
      toast.success(`Status do chamado atualizado para ${STATUS_NAMES[nextStatus]}.`);
      loadDomainData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleSendTicketComment = async (ticketId) => {
    const text = ticketCommentText.trim();
    if (!text) return;
    try {
      await microservicesApi.addTicketComment(ticketId, text);
      toast.success('Mensagem enviada e sincronizada instantaneamente com o colaborador.');
      setTicketCommentText('');
      setActiveTicketCommentId(null);
      loadDomainData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleIssueQuickTerm = async () => {
    try {
      await microservicesApi.issueTerm({
        termType: 'entrega',
        employeeName: 'Mariana Costa',
        employeeEmail: 'mariana.costa@nexuscorp.com.br',
        department: 'Engenharia de Produto',
        assetsSnapshot: [
          {
            internalId: 'NEX-NB-0001',
            model: 'Lenovo ThinkPad T14 Gen 4',
            serialNumber: 'PF4X92K1',
          },
        ],
      });
      toast.success('Novo Termo de Custódia CLT emitido e transmitido para assinatura do colaborador.');
      loadDomainData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleVerifySingleTerm = async (termId) => {
    try {
      const res = await microservicesApi.verifyTerm(termId);
      if (res.valid) {
        toast.success(`Termo validado: Selo digital HMAC-SHA256 íntegro e assinado juridicamente.`);
      } else {
        toast.error(`Atenção: Hash divergente do registro original.`);
      }
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDispatchRemoteCommand = async (deviceKey, commandType) => {
    try {
      await microservicesApi.dispatchRemoteCommand(deviceKey, commandType, 'Console de Gestão ITAM');
      toast.success(`Comando "${commandType}" despachado com sucesso para a estação.`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleQuickNextTag = async () => {
    try {
      const res = await microservicesApi.suggestNextTag('Notebook');
      toast.success(`Próxima Etiqueta Sequencial: ${res.suggestedTag} (Sequência ${res.nextSequence})`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleSimulateWsPulse = () => {
    if (!wsRef.current) {
      toast.error('Conecte-se primeiro ao API Gateway.');
      return;
    }
    const cpu = Number((18 + Math.random() * 55).toFixed(1));
    const ram = Number((44 + Math.random() * 35).toFixed(1));
    wsRef.current.pushLiveTelemetry({
      deviceKey: 'WKS-ENG-PF4X92K1',
      hostname: 'NEX-ENG-MCOSTA',
      cpuPercent: cpu,
      ramPercent: ram,
      diskPercent: 44.2,
    });
    toast.success(`Pulso de telemetria RMM transmitido (CPU ${cpu}% | RAM ${ram}%)`);
  };

  // KPIs calculados
  const activeTickets = useMemo(() => {
    return tickets.filter((t) => t.status === 'open' || t.status === 'in_progress');
  }, [tickets]);

  const signedTerms = useMemo(() => {
    return terms.filter((t) => t.status === 'signed');
  }, [terms]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      const matchesFilter = ticketFilter === 'all' || t.status === ticketFilter;
      const matchesSearch =
        !ticketSearch ||
        t.title?.toLowerCase().includes(ticketSearch.toLowerCase()) ||
        t.protocol?.toLowerCase().includes(ticketSearch.toLowerCase()) ||
        t.requester_name?.toLowerCase().includes(ticketSearch.toLowerCase()) ||
        t.asset_tag?.toLowerCase().includes(ticketSearch.toLowerCase());
      return matchesFilter && matchesSearch;
    });
  }, [tickets, ticketFilter, ticketSearch]);

  return (
    <div className="space-y-6 pb-12">
      {/* Enterprise Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-slate-200/80 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-brand">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>ITSM & Service Operations • Enterprise Suite</span>
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Service Desk & Orquestração de Microsserviços
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-3xl">
            Centro unificado de resolução de incidentes N1/N2, custódia patrimonial com assinatura digital CLT e telemetria de frotas em tempo real.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          <button
            type="button"
            onClick={() => setShowDevDrawer((p) => !p)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:border-brand dark:hover:border-brand transition-colors"
            title="Exibir topologia técnica dos microsserviços e documentação"
          >
            <Server size={13} className="text-brand" />
            <span>Topologia & APIs</span>
            {showDevDrawer ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          <a
            href={portalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-brand to-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:opacity-95 transition-all"
          >
            <Laptop size={13} />
            <span>Portal do Colaborador</span>
            <ExternalLink size={12} />
          </a>

          <button
            type="button"
            onClick={loadDomainData}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin text-brand' : ''} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* Offline Alert */}
      {healthError && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs font-medium text-amber-800 dark:text-amber-200 flex items-start gap-3">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-bold">Aviso de Conectividade do Cluster</p>
            <p className="mt-0.5">{healthError}</p>
          </div>
        </div>
      )}

      {/* Executive SaaS KPI Cards */}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {/* SLA Compliance KPI */}
        <div className="surface-card p-4 flex flex-col justify-between relative overflow-hidden border-l-4 border-l-emerald-500">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>SLA Operacional (MTTR)</span>
            <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Clock size={15} />
            </span>
          </div>
          <div className="mt-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white">99.4%</span>
              <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center">
                <TrendingUp size={12} className="mr-0.5" /> +0.6%
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Meta contratual ≥ 98% • Tempo médio: 14 min
            </p>
          </div>
        </div>

        {/* Active Ticket Desk KPI */}
        <div className="surface-card p-4 flex flex-col justify-between relative overflow-hidden border-l-4 border-l-brand">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Fila de Atendimento</span>
            <span className="p-1.5 rounded-lg bg-brand/10 text-brand">
              <Ticket size={15} />
            </span>
          </div>
          <div className="mt-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white">
                {activeTickets.length}
              </span>
              <span className="text-xs font-medium text-slate-500">chamados em aberto</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {tickets.filter((t) => t.status === 'open').length} novos • {tickets.filter((t) => t.status === 'in_progress').length} em andamento
            </p>
          </div>
        </div>

        {/* CLT Legal Compliance KPI */}
        <div className="surface-card p-4 flex flex-col justify-between relative overflow-hidden border-l-4 border-l-indigo-500">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Conformidade Jurídica CLT</span>
            <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <ShieldCheck size={15} />
            </span>
          </div>
          <div className="mt-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white">
                {signedTerms.length} / {terms.length || 1}
              </span>
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                100% Selados
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Art. 462 CLT com assinatura digital HMAC-SHA256
            </p>
          </div>
        </div>

        {/* Fleet Telemetry (RMM) KPI */}
        <div className="surface-card p-4 flex flex-col justify-between relative overflow-hidden border-l-4 border-l-cyan-500">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Estações Conectadas (RMM)</span>
            <span className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
              <Laptop size={15} />
            </span>
          </div>
          <div className="mt-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white">
                {fleet.devices?.length || 1}
              </span>
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Ativas
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Telemetria contínua via WebSocket RFC 6455
            </p>
          </div>
        </div>
      </div>

      {/* Cluster Infrastructure Status Ribbon */}
      {clusterHealth && (
        <div className="surface-card p-3 sm:p-4 bg-slate-50/70 dark:bg-slate-900/60 border border-slate-200/90 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              <Network size={14} className="text-brand" />
              <span>Infraestrutura da Malha & Microsserviços</span>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`${gatewayUrl}/docs`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:underline"
              >
                <span>Catálogo OpenAPI 3.1</span>
                <ExternalLink size={10} />
              </a>
            </div>
          </div>

          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            <div className="surface-card p-2.5 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                <span>BANCO DE DADOS</span>
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
              </div>
              <p className="mt-1 text-xs font-bold text-slate-900 dark:text-white">
                {clusterHealth.database?.engine}
              </p>
              <p className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                Latência: {clusterHealth.database?.latencyMs}ms
              </p>
            </div>

            {(clusterHealth.microservices || []).map((svc) => (
              <div
                key={svc.service}
                className="surface-card p-2.5 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
              >
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span className="truncate">{svc.service}</span>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      svc.status === 'healthy' ? 'bg-emerald-500' : 'bg-red-500'
                    }`}
                  />
                </div>
                <p className="mt-1 text-xs font-bold text-slate-900 dark:text-white capitalize">
                  {svc.status}
                </p>
                <p className="text-[10px] font-mono text-slate-500">
                  RTT: {svc.latencyMs}ms
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Collapsible Architecture & Cluster Diagnostics Drawer */}
      {showDevDrawer && (
        <div className="surface-card p-5 space-y-4 border border-brand/30 bg-slate-50/50 dark:bg-slate-900/40 animate-in fade-in duration-200">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Terminal size={16} className="text-brand" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                Ferramentas de Engenharia & Diagnóstico Rápido
              </h3>
            </div>
            <span className="text-[11px] text-slate-500">
              Gateway: <code className="font-mono text-brand">{gatewayUrl}</code>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={handleQuickNextTag}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-brand shadow-2xs"
            >
              <Tag size={13} className="text-brand" />
              <span>Gerar Próxima Tag (API 1)</span>
            </button>
            <button
              type="button"
              onClick={handleSimulateWsPulse}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-brand shadow-2xs"
            >
              <Play size={13} className="text-emerald-500" />
              <span>Simular Pulso Telemetria RMM</span>
            </button>
            <button
              type="button"
              onClick={handleIssueQuickTerm}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-brand shadow-2xs"
            >
              <FileSignature size={13} className="text-indigo-500" />
              <span>Emitir Termo CLT de Teste</span>
            </button>
          </div>
        </div>
      )}

      {/* Gateway Authentication Card (When not signed in) */}
      {!gatewaySession?.token ? (
        <div className="surface-card p-6 sm:p-8 max-w-xl mx-auto shadow-xl space-y-5 border-slate-200/90 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-brand/10 text-brand">
              <Lock size={22} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                Autenticação no Gateway de Operações
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sessão com criptografia Scrypt e tokens assinados JWT HS256.
              </p>
            </div>
          </div>

          <form onSubmit={handleConnectGateway} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                E-mail de Operador / Gestor de TI
              </label>
              <input
                type="email"
                value={credentials.email}
                onChange={(e) => setCredentials((p) => ({ ...p, email: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:border-brand focus:outline-none"
                placeholder="operador@nexuscorp.com.br"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Senha de Acesso
              </label>
              <input
                type="password"
                value={credentials.password}
                onChange={(e) => setCredentials((p) => ({ ...p, password: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:border-brand focus:outline-none"
                placeholder="••••••••••••"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-brand hover:bg-brand-dark py-2.5 text-xs font-bold text-white uppercase tracking-wider transition-colors shadow-sm disabled:opacity-50"
            >
              {loading ? 'Validando Credenciais...' : 'Conectar ao Cluster de Microsserviços'}
            </button>
          </form>
        </div>
      ) : (
        <>
          {/* Active Status Bar */}
          <div className="surface-card p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 font-mono font-bold text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                API 5 WebSocket: {wsStatus.toUpperCase()}
              </span>

              {chainReport && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/15 px-3 py-1 font-mono font-semibold text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
                  <ShieldCheck size={13} />
                  Hash-Chain SHA-256: {chainReport.intact ? `ÍNTEGRA (${chainReport.checkedRecords} blocos)` : 'ALERTA'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {gatewaySession.user?.name || 'Gestor de TI'}
                </p>
                <p className="text-[10px] text-slate-500 font-mono">
                  {gatewaySession.user?.role?.toUpperCase()} • {gatewaySession.user?.tenantId}
                </p>
              </div>
              <button
                type="button"
                onClick={handleDisconnectGateway}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:border-red-300 transition-colors"
              >
                Desconectar
              </button>
            </div>
          </div>

          {/* Main 2-Column Command Workspace */}
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Left Column: Tickets Queue */}
            <div className="lg:col-span-7 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Ticket size={17} className="text-brand" />
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
                    Fila Operacional de Chamados ({filteredTickets.length})
                  </h2>
                </div>

                {/* Filter Tabs */}
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs">
                  <button
                    type="button"
                    onClick={() => setTicketFilter('all')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      ticketFilter === 'all'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-bold'
                        : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Todos ({tickets.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTicketFilter('open')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      ticketFilter === 'open'
                        ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-xs font-bold'
                        : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Abertos
                  </button>
                  <button
                    type="button"
                    onClick={() => setTicketFilter('in_progress')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      ticketFilter === 'in_progress'
                        ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs font-bold'
                        : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Em Atendimento
                  </button>
                  <button
                    type="button"
                    onClick={() => setTicketFilter('resolved')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      ticketFilter === 'resolved'
                        ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs font-bold'
                        : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Resolvidos
                  </button>
                </div>
              </div>

              {/* Search input */}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  value={ticketSearch}
                  onChange={(e) => setTicketSearch(e.target.value)}
                  placeholder="Pesquisar por protocolo, solicitante, tag ou assunto..."
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pl-9 pr-4 py-2 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:border-brand focus:outline-none"
                />
              </div>

              {/* Ticket Cards */}
              <div className="space-y-3">
                {filteredTickets.length === 0 ? (
                  <div className="surface-card p-10 text-center space-y-2">
                    <Inbox size={32} className="mx-auto text-slate-300 dark:text-slate-600" />
                    <p className="text-xs font-medium text-slate-500">
                      Nenhum chamado encontrado com os filtros selecionados.
                    </p>
                  </div>
                ) : (
                  filteredTickets.map((tk) => (
                    <div
                      key={tk.id}
                      className="surface-card p-4 space-y-3 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-900 text-white dark:bg-slate-800">
                            {tk.protocol}
                          </span>
                          {tk.asset_tag && (
                            <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1">
                              <Laptop size={11} />
                              {tk.asset_tag}
                            </span>
                          )}
                          <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 font-medium">
                            <User size={12} />
                            <span>{tk.requester_name}</span>
                            {tk.department && (
                              <span className="text-[11px] text-slate-400">({tk.department})</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {tk.priority && (
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                PRIORITY_BADGES[tk.priority] || PRIORITY_BADGES.medium
                              }`}
                            >
                              {PRIORITY_NAMES[tk.priority] || tk.priority}
                            </span>
                          )}
                          <span
                            className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                              STATUS_BADGES[tk.status] || STATUS_BADGES.open
                            }`}
                          >
                            {STATUS_NAMES[tk.status] || tk.status}
                          </span>
                        </div>
                      </div>

                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                          {tk.title}
                        </h3>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                          {tk.description}
                        </p>
                      </div>

                      {tk.resolution_notes && (
                        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-2.5 text-xs text-emerald-900 dark:text-emerald-300">
                          <span className="font-bold">Parecer Técnico:</span> {tk.resolution_notes}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                        <div className="flex items-center gap-2">
                          {tk.status !== 'resolved' && tk.status !== 'closed' && (
                            <>
                              {tk.status === 'open' && (
                                <button
                                  type="button"
                                  onClick={() => handleResolveTicket(tk.id, 'in_progress')}
                                  className="rounded-lg border border-indigo-500/40 bg-indigo-50/50 dark:bg-indigo-950/30 px-3 py-1 text-xs font-bold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 transition-colors"
                                >
                                  Assumir Chamado
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleResolveTicket(tk.id, 'resolved')}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1 text-xs font-bold text-white shadow-xs transition-colors"
                              >
                                <CheckCircle2 size={13} />
                                <span>Concluir Atendimento</span>
                              </button>
                            </>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setActiveTicketCommentId(
                              activeTicketCommentId === tk.id ? null : tk.id,
                            )
                          }
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-brand transition-colors"
                        >
                          <MessageSquare size={13} />
                          <span>Diálogo Técnico ({tk.comments_count ?? 0})</span>
                        </button>
                      </div>

                      {/* Technical Dialog Drawer */}
                      {activeTicketCommentId === tk.id && (
                        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={ticketCommentText}
                              onChange={(e) => setTicketCommentText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSendTicketComment(tk.id);
                              }}
                              placeholder="Digite uma mensagem técnica para o solicitante..."
                              className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:border-brand focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleSendTicketComment(tk.id)}
                              className="inline-flex items-center gap-1 rounded-lg bg-brand px-3.5 py-1.5 text-xs font-bold text-white hover:bg-brand-dark transition-colors"
                            >
                              <Send size={12} />
                              <span>Enviar</span>
                            </button>
                          </div>
                          <p className="text-[10px] text-slate-400">
                            A mensagem é transmitida imediatamente ao Portal do Colaborador.
                          </p>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Right Column: Telemetry Fleet, Terms, Live Feed */}
            <div className="lg:col-span-5 space-y-5">
              {/* Fleet Telemetry (RMM) */}
              <div className="surface-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <Laptop size={15} className="text-cyan-500" />
                    <span>Telemetria de Frotas ({fleet.devices?.length || 0})</span>
                  </h3>
                  <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Ao Vivo
                  </span>
                </div>

                <div className="space-y-2">
                  {(fleet.devices || []).length === 0 ? (
                    <p className="text-xs text-slate-400 italic py-2">
                      Nenhuma estação enviando telemetria no momento.
                    </p>
                  ) : (
                    (fleet.devices || []).map((dev) => (
                      <div
                        key={dev.id || dev.device_key}
                        className="surface-subtle p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div>
                            <p className="font-mono font-bold text-slate-800 dark:text-slate-100">
                              {dev.hostname}
                            </p>
                            <p className="text-[11px] text-slate-500">{dev.os_version}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              handleDispatchRemoteCommand(
                                dev.device_key || 'WKS-ENG-PF4X92K1',
                                'force_inventory',
                              )
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 hover:text-brand hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors text-[10px] font-semibold"
                            title="Despachar comando de inventário imediato"
                          >
                            <Terminal size={11} />
                            <span>Inventariar</span>
                          </button>
                        </div>

                        {/* Resource Meters */}
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div>
                            <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                              <span>CPU</span>
                              <span className="font-mono font-bold">{dev.cpu_percent}%</span>
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                  dev.cpu_percent > 80
                                    ? 'bg-rose-500'
                                    : dev.cpu_percent > 60
                                    ? 'bg-amber-500'
                                    : 'bg-emerald-500'
                                }`}
                                style={{ width: `${Math.min(dev.cpu_percent, 100)}%` }}
                              />
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                              <span>RAM</span>
                              <span className="font-mono font-bold">{dev.ram_percent}%</span>
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                  dev.ram_percent > 85
                                    ? 'bg-rose-500'
                                    : dev.ram_percent > 70
                                    ? 'bg-amber-500'
                                    : 'bg-indigo-500'
                                }`}
                                style={{ width: `${Math.min(dev.ram_percent, 100)}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Legal Custody Terms (CLT Passports) */}
              <div className="surface-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <FileSignature size={15} className="text-indigo-500" />
                    <span>Custódia & Termos CLT ({terms.length})</span>
                  </h3>
                  <button
                    type="button"
                    onClick={handleIssueQuickTerm}
                    className="text-[11px] font-bold text-brand hover:underline"
                  >
                    + Novo Termo
                  </button>
                </div>

                <div className="space-y-2">
                  {terms.slice(0, 4).map((tm) => (
                    <div
                      key={tm.id}
                      className="surface-subtle p-2.5 flex items-center justify-between text-xs"
                    >
                      <div className="space-y-0.5">
                        <p className="font-semibold text-slate-800 dark:text-slate-200">
                          {tm.employee_name}
                        </p>
                        <p className="font-mono text-[10px] text-slate-400 truncate max-w-[170px]">
                          Doc: {tm.document_hash}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                            tm.status === 'signed'
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                              : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {tm.status === 'signed' ? 'HMAC Assinado' : 'Pendente'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleVerifySingleTerm(tm.id)}
                          className="p-1 rounded text-slate-400 hover:text-emerald-500 transition-colors"
                          title="Auditar integridade da assinatura criptográfica"
                        >
                          <ShieldCheck size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Live Operational Audit Log */}
              <div className="surface-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <Activity size={14} className="text-emerald-500" />
                    <span>Auditoria de Eventos em Tempo Real</span>
                  </h3>
                  <span className="text-[10px] font-mono text-slate-400">WebSocket Ativo</span>
                </div>

                <div className="max-h-48 overflow-y-auto space-y-1.5 font-mono text-[11px] custom-scrollbar">
                  {wsFeed.length === 0 ? (
                    <p className="text-xs text-slate-400 py-3 text-center">
                      Aguardando eventos operacionais na malha...
                    </p>
                  ) : (
                    wsFeed.map((item, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg bg-slate-900 text-slate-200 px-3 py-1.5 border border-slate-800 flex items-center justify-between text-[11px]"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-emerald-400 font-bold">[{item.event}]</span>
                          <span className="text-slate-300 truncate">
                            {typeof item.data === 'string'
                              ? item.data
                              : item.data?.title || item.data?.message || item.role || 'Evento processado'}
                          </span>
                        </div>
                        <span className="text-[9px] text-slate-500 uppercase shrink-0 ml-2">
                          Live
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ServiceDeskHub;
