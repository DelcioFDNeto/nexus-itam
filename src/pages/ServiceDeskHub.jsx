// src/pages/ServiceDeskHub.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  ExternalLink,
  FileSignature,
  Lock,
  MessageSquare,
  Network,
  Play,
  Radio,
  RefreshCw,
  Send,
  Server,
  ShieldCheck,
  Tag,
  Terminal,
  Ticket,
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
  open: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  in_progress: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
  resolved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  closed: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30',
};

const STATUS_NAMES = {
  open: 'Aberto',
  in_progress: 'Em Atendimento',
  resolved: 'Resolvido',
  closed: 'Encerrado',
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
          setWsFeed((prev) => [frame, ...prev].slice(0, 12));
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
            ? 'Atendimento concluído pela Engenharia de TI via Console React 19.'
            : 'Chamado assumido pela fila de operações N2.',
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
      toast.success('Mensagem enviada e sincronizada com o Portal Vue 3 via WebSocket!');
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
      toast.success('Novo Termo CLT emitido e transmitido ao Portal Vue 3 via WebSocket!');
      loadDomainData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleVerifySingleTerm = async (termId) => {
    try {
      const res = await microservicesApi.verifyTerm(termId);
      if (res.valid) {
        toast.success(`Termo validado: HMAC SHA-256 íntegro e assinado digitalmente.`);
      } else {
        toast.error(`Atenção: Hash divergente do registro original.`);
      }
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDispatchRemoteCommand = async (deviceKey, commandType) => {
    try {
      await microservicesApi.dispatchRemoteCommand(deviceKey, commandType, 'Console React 19 trigger');
      toast.success(`Comando "${commandType}" despachado via API 4 (service-nexusdesk)!`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleQuickNextTag = async () => {
    try {
      const res = await microservicesApi.suggestNextTag('Notebook');
      toast.success(`API 1 (Assets): Próxima Tag sugerida: ${res.suggestedTag} (Sequência ${res.nextSequence})`);
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
    toast.success(`Pulso WebSocket enviado (CPU ${cpu}% | RAM ${ram}%)`);
  };

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-brand font-bold">
            <Network size={14} />
            <span>Malha Distribuída • Fastify + PostgreSQL 16 + WebSocket RFC 6455</span>
          </div>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            Service Desk & Orquestração de Microsserviços
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Console integrado às 5 APIs corporativas e sincronizado em tempo real com o Portal do Colaborador (Vue 3).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href={`${gatewayUrl}/docs`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:border-brand transition-colors"
          >
            <span>OpenAPI 3.1 Docs</span>
            <ExternalLink size={13} />
          </a>

          <a
            href={portalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-white px-3.5 py-2 text-xs font-bold text-white dark:text-slate-900 hover:opacity-90 transition-opacity"
          >
            <span>Abrir Portal Colaborador (Vue 3)</span>
            <ExternalLink size={13} />
          </a>

          <button
            type="button"
            onClick={loadDomainData}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {healthError && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs font-medium text-amber-800 dark:text-amber-200">
          {healthError}
        </div>
      )}

      {/* Cluster Health Topology */}
      {clusterHealth && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="surface-card p-4">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400">
              <span>BANCO DE DADOS</span>
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
            </div>
            <p className="mt-1.5 text-sm font-black text-slate-900 dark:text-white">
              {clusterHealth.database?.engine}
            </p>
            <p className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
              Latência: {clusterHealth.database?.latencyMs}ms
            </p>
          </div>

          {(clusterHealth.microservices || []).map((svc) => (
            <div key={svc.service} className="surface-card p-4">
              <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                <span className="truncate">{svc.service}</span>
                <span
                  className={`h-2 w-2 rounded-full ${
                    svc.status === 'healthy' ? 'bg-emerald-500' : 'bg-red-500'
                  }`}
                />
              </div>
              <p className="mt-1.5 text-sm font-bold text-slate-900 dark:text-white capitalize">
                {svc.status}
              </p>
              <p className="text-[11px] font-mono text-slate-500">
                RTT: {svc.latencyMs}ms
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Gateway JWT Session Handshake */}
      {!gatewaySession?.token ? (
        <form onSubmit={handleConnectGateway} className="surface-card p-6 max-w-xl space-y-4">
          <div className="flex items-center gap-2 text-brand font-bold text-xs uppercase tracking-wider">
            <Lock size={15} />
            <span>Autenticação Zero-Trust no API Gateway (JWT HS256 + Scrypt)</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Autentique sua sessão operacional no Gateway para gerenciar chamados recebidos do Portal Vue 3, auditar a Hash-Chain e abrir o streaming WebSocket.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="email"
              value={credentials.email}
              onChange={(e) => setCredentials((p) => ({ ...p, email: e.target.value }))}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
              placeholder="E-mail"
              required
            />
            <input
              type="password"
              value={credentials.password}
              onChange={(e) => setCredentials((p) => ({ ...p, password: e.target.value }))}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
              placeholder="Senha"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-white hover:bg-brand-dark transition-colors"
          >
            {loading ? 'Autenticando...' : 'Conectar ao Cluster de Microsserviços'}
          </button>
        </form>
      ) : (
        <>
          {/* Active Security & WebSocket Strip */}
          <div className="surface-card p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 font-mono font-bold text-emerald-700 dark:text-emerald-300">
                <Radio size={13} />
                API 5 WebSocket: {wsStatus.toUpperCase()}
              </span>

              {chainReport && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/15 px-3 py-1 font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                  <ShieldCheck size={13} />
                  Hash-Chain SHA-256: {chainReport.intact ? `ÍNTEGRA (${chainReport.checkedRecords} blocos)` : 'ALERTA'}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleQuickNextTag}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand/30 bg-brand/10 px-3 py-1.5 text-xs font-bold text-brand hover:bg-brand/20 transition-colors"
                title="Calcula a próxima tag patrimonial sequencial pela API 1"
              >
                <Tag size={12} />
                <span>API 1: Gerar Tag</span>
              </button>
              <button
                type="button"
                onClick={handleSimulateWsPulse}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-white px-3 py-1.5 text-xs font-bold text-white dark:text-slate-900"
              >
                <Play size={12} />
                <span>Emitir Pulso WebSocket</span>
              </button>
              <button
                type="button"
                onClick={handleIssueQuickTerm}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200"
              >
                <FileSignature size={13} />
                <span>Emitir Termo CLT p/ Portal Vue</span>
              </button>
              <button
                type="button"
                onClick={handleDisconnectGateway}
                className="text-xs font-semibold text-slate-400 hover:text-red-500 px-2"
              >
                Desconectar
              </button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            {/* Tickets Queue from Vue 3 Portal */}
            <div className="lg:col-span-7 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-2">
                  <Ticket size={15} className="text-brand" />
                  <span>Fila de Chamados — API 2 REST ({tickets.length})</span>
                </h2>
              </div>

              <div className="space-y-2.5">
                {tickets.map((tk) => (
                  <div key={tk.id} className="surface-card p-4 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="badge-mono">{tk.protocol}</span>
                        {tk.asset_tag && <span className="badge-mono">{tk.asset_tag}</span>}
                        <span className="text-xs text-slate-500">{tk.requester_name}</span>
                      </div>
                      <span
                        className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                          STATUS_BADGES[tk.status] || STATUS_BADGES.open
                        }`}
                      >
                        {STATUS_NAMES[tk.status] || tk.status}
                      </span>
                    </div>

                    <p className="text-sm font-bold text-slate-900 dark:text-white">{tk.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{tk.description}</p>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                      <div className="flex items-center gap-2">
                        {tk.status !== 'resolved' && tk.status !== 'closed' && (
                          <>
                            {tk.status === 'open' && (
                              <button
                                type="button"
                                onClick={() => handleResolveTicket(tk.id, 'in_progress')}
                                className="rounded-lg border border-indigo-500/40 px-2.5 py-1 text-xs font-bold text-indigo-600 dark:text-indigo-300"
                              >
                                Assumir Atendimento
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleResolveTicket(tk.id, 'resolved')}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700"
                            >
                              <CheckCircle2 size={12} />
                              <span>Concluir & Notificar Vue 3</span>
                            </button>
                          </>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => setActiveTicketCommentId(activeTicketCommentId === tk.id ? null : tk.id)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-brand transition-colors"
                      >
                        <MessageSquare size={13} />
                        <span>Comentar ({tk.comments_count ?? 0})</span>
                      </button>
                    </div>

                    {activeTicketCommentId === tk.id && (
                      <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 flex gap-2">
                        <input
                          type="text"
                          value={ticketCommentText}
                          onChange={(e) => setTicketCommentText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSendTicketComment(tk.id);
                          }}
                          placeholder="Digite uma mensagem técnica para o solicitante..."
                          className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100"
                        />
                        <button
                          type="button"
                          onClick={() => handleSendTicketComment(tk.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-dark transition-colors"
                        >
                          <Send size={12} />
                          <span>Enviar</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column: Live WebSocket Feed + RMM Fleet + Signed Terms */}
            <div className="lg:col-span-5 space-y-5">
              <div className="surface-card p-4 space-y-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-2">
                  <Activity size={14} className="text-emerald-500" />
                  <span>Stream Bidirecional Ao Vivo (API 5 • WebSocket)</span>
                </h3>
                <div className="max-h-48 overflow-y-auto space-y-1.5 font-mono text-[11px]">
                  {wsFeed.length === 0 ? (
                    <p className="text-slate-400">Aguardando eventos no canal /ws/nexusdesk...</p>
                  ) : (
                    wsFeed.map((item, idx) => (
                      <div
                        key={idx}
                        className="rounded bg-slate-950 text-emerald-300 px-2.5 py-1.5 border border-slate-800 truncate"
                      >
                        [{item.event}] {JSON.stringify(item.data || item.role || 'ok')}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="surface-card p-4 space-y-2.5">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-2">
                  <Server size={14} className="text-brand" />
                  <span>Telemetria da Frota — API 4 REST ({fleet.devices?.length || 0})</span>
                </h3>
                {(fleet.devices || []).map((dev) => (
                  <div
                    key={dev.id || dev.device_key}
                    className="surface-subtle p-2.5 flex items-center justify-between text-xs"
                  >
                    <div>
                      <p className="font-mono font-bold text-slate-800 dark:text-slate-100">
                        {dev.hostname}
                      </p>
                      <p className="text-[11px] text-slate-500">{dev.os_version}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right font-mono text-[11px]">
                        <div>CPU {dev.cpu_percent}%</div>
                        <div>RAM {dev.ram_percent}%</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDispatchRemoteCommand(dev.device_key || 'WKS-ENG-PF4X92K1', 'force_inventory')}
                        className="p-1 rounded bg-slate-200 dark:bg-slate-700 hover:text-brand transition-colors text-[10px] font-mono"
                        title="Despachar comando de inventário forçado (API 4)"
                      >
                        <Terminal size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="surface-card p-4 space-y-2">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
                  Termos CLT Criptografados — API 3 ({terms.length})
                </h3>
                {terms.slice(0, 4).map((tm) => (
                  <div
                    key={tm.id}
                    className="surface-subtle p-2.5 flex items-center justify-between text-xs"
                  >
                    <div>
                      <p className="font-semibold text-slate-800 dark:text-slate-200">
                        {tm.employee_name}
                      </p>
                      <p className="font-mono text-[10px] text-slate-400 truncate max-w-[170px]">
                        SHA256: {tm.document_hash}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                          tm.status === 'signed'
                            ? 'bg-emerald-500/15 text-emerald-600'
                            : 'bg-amber-500/15 text-amber-600'
                        }`}
                      >
                        {tm.status === 'signed' ? 'HMAC Assinado' : 'Pendente'}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleVerifySingleTerm(tm.id)}
                        className="p-1 rounded text-slate-400 hover:text-emerald-500 transition-colors"
                        title="Auditar assinatura HMAC e integridade SHA-256 (API 3)"
                      >
                        <ShieldCheck size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ServiceDeskHub;
