// services/service-storage/src/services/installScriptBuilder.js
// =============================================================================
// Construtor do Script 1-Click Linux — Nexus Storage Node (HTTP + HMAC-SHA256)
// =============================================================================

import fs from 'node:fs';
import { normalizeVirtualVaultPath } from '../../../shared/security.js';

const AGENT_SERVER_PATH = new URL('../agent/nexusStorageNodeServer.js', import.meta.url);
let cachedAgentServerSource = null;

function getAgentServerSource() {
  if (!cachedAgentServerSource) {
    cachedAgentServerSource = fs.readFileSync(AGENT_SERVER_PATH, 'utf8').replace(/\r\n/g, '\n');
  }
  return cachedAgentServerSource;
}

const UNSAFE_SHELL_CHARS_RE = /[`$"\\;|&<>()\r\n\0']/;

export function buildAgentInstallScript({
  rootPath = '/srv/nexus-vault',
  quotaBytes = 53_687_091_200,
  hmacToken,
  port = 9443,
} = {}) {
  const rawRoot = String(rootPath || '/srv/nexus-vault').trim();
  if (!rawRoot || UNSAFE_SHELL_CHARS_RE.test(rawRoot) || rawRoot.includes('..') || /\s/.test(rawRoot)) {
    const err = new Error('rootPath inválido ou contém caracteres não permitidos.');
    err.code = 'INVALID_ROOT_PATH';
    err.statusCode = 400;
    throw err;
  }
  const normalizedRoot = normalizeVirtualVaultPath(rawRoot);
  if (normalizedRoot === '/') {
    const err = new Error('rootPath dedicado para o agente não pode ser "/". Use um diretório como /srv/nexus-vault.');
    err.code = 'INVALID_ROOT_PATH';
    err.statusCode = 400;
    throw err;
  }

  const parsedQuota = Number(quotaBytes);
  if (!Number.isFinite(parsedQuota) || parsedQuota <= 0) {
    const err = new Error('quotaBytes inválido.');
    err.code = 'INVALID_QUOTA';
    err.statusCode = 400;
    throw err;
  }
  const safeQuota = Math.trunc(parsedQuota);

  const parsedPort = Number(port ?? 9443);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    const err = new Error('Porta do Nexus Storage Node inválida (1-65535).');
    err.code = 'INVALID_PORT';
    err.statusCode = 400;
    throw err;
  }

  const safeToken = String(hmacToken || '').trim();
  if (!/^[a-zA-Z0-9._-]{12,256}$/.test(safeToken)) {
    const err = new Error('hmacToken inválido para geração do script.');
    err.code = 'INVALID_HMAC_TOKEN';
    err.statusCode = 400;
    throw err;
  }

  const agentSource = getAgentServerSource();
  if (agentSource.includes('__NEXUS_NODE_JS__') || agentSource.includes('__NEXUS_INSTALLER_EOF__')) {
    throw new Error('Código do agente contém delimitador reservado.');
  }

  const lines = [
    '#!/usr/bin/env bash',
    `export NEXUS_VAULT_ROOT="${normalizedRoot}"`,
    `export NEXUS_VAULT_QUOTA_BYTES="${safeQuota}"`,
    `export NEXUS_NODE_HMAC_TOKEN="${safeToken}"`,
    `export NEXUS_NODE_PORT="${parsedPort}"`,
    '',
    "bash -euo pipefail <<'__NEXUS_INSTALLER_EOF__'",
    'if [ "$(id -u)" -ne 0 ]; then',
    '  echo "[Nexus Storage Node] Erro: execute como root ou com sudo." >&2',
    '  exit 1',
    'fi',
    '',
    'echo "[Nexus Storage Node] Verificando runtime Node.js (>= 18)..."',
    'NEED_NODE=0',
    'if command -v node >/dev/null 2>&1; then',
    '  NODE_MAJOR="$(node -p \'process.versions.node.split(".")[0]\' 2>/dev/null || echo 0)"',
    '  if [ "${NODE_MAJOR:-0}" -lt 18 ]; then NEED_NODE=1; fi',
    'else',
    '  NEED_NODE=1',
    'fi',
    '',
    'if [ "$NEED_NODE" -eq 1 ]; then',
    '  echo "[Nexus Storage Node] Instalando Node.js 20 LTS..."',
    '  if command -v apt-get >/dev/null 2>&1; then',
    '    export DEBIAN_FRONTEND=noninteractive',
    '    apt-get update -qq',
    '    apt-get install -y -qq curl ca-certificates gnupg',
    '    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -',
    '    apt-get install -y -qq nodejs',
    '  elif command -v dnf >/dev/null 2>&1; then',
    '    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -',
    '    dnf install -y -q nodejs',
    '  elif command -v yum >/dev/null 2>&1; then',
    '    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -',
    '    yum install -y -q nodejs',
    '  elif command -v apk >/dev/null 2>&1; then',
    '    apk add --no-cache nodejs',
    '  else',
    '    echo "[Nexus Storage Node] Instale Node.js >= 18 manualmente e execute novamente." >&2',
    '    exit 1',
    '  fi',
    'fi',
    '',
    'NODE_BIN="$(command -v node)"',
    'if [ -z "$NODE_BIN" ]; then',
    '  echo "[Nexus Storage Node] Erro: binário node não encontrado após instalação." >&2',
    '  exit 1',
    'fi',
    '',
    'if ! id -u nexusnode >/dev/null 2>&1; then',
    '  if command -v getent >/dev/null 2>&1 && command -v groupadd >/dev/null 2>&1; then',
    '    getent group nexusnode >/dev/null 2>&1 || groupadd --system nexusnode || true',
    '  fi',
    '  if command -v useradd >/dev/null 2>&1; then',
    '    useradd --system --gid nexusnode --no-create-home --shell /usr/sbin/nologin nexusnode 2>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin nexusnode || true',
    '  elif command -v adduser >/dev/null 2>&1; then',
    '    adduser -S -D -H nexusnode 2>/dev/null || adduser --system --no-create-home --disabled-login nexusnode || true',
    '  fi',
    'fi',
    'SVC_USER="$(id -un nexusnode 2>/dev/null || echo root)"',
    'SVC_GROUP="$(id -gn nexusnode 2>/dev/null || echo root)"',
    '',
    'mkdir -p "$NEXUS_VAULT_ROOT"/{Corporativo-Publico,Setores,Cofre-TI-Infra/Termos,Chamados,Espaco-Pessoal,.nexus_versions,.nexus_trash}',
    'mkdir -p /opt/nexus-storage-node /etc/nexus-storage-node',
    'chmod 750 "$NEXUS_VAULT_ROOT"',
    '',
    "cat <<'__NEXUS_NODE_JS__' > /opt/nexus-storage-node/server.mjs",
    agentSource.trimEnd(),
    '__NEXUS_NODE_JS__',
    'chmod 644 /opt/nexus-storage-node/server.mjs',
    '',
    'cat <<EOF_ENV > /etc/nexus-storage-node/agent.env',
    'NEXUS_VAULT_ROOT=${NEXUS_VAULT_ROOT}',
    'NEXUS_VAULT_QUOTA_BYTES=${NEXUS_VAULT_QUOTA_BYTES}',
    'NEXUS_NODE_HMAC_TOKEN=${NEXUS_NODE_HMAC_TOKEN}',
    'NEXUS_NODE_PORT=${NEXUS_NODE_PORT}',
    'NEXUS_NODE_BIND=0.0.0.0',
    'EOF_ENV',
    'chmod 600 /etc/nexus-storage-node/agent.env',
    'chown -R "${SVC_USER}:${SVC_GROUP}" "$NEXUS_VAULT_ROOT" /opt/nexus-storage-node /etc/nexus-storage-node',
    '',
    'SERVICE_MODE="background"',
    'if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then',
    '  SERVICE_MODE="systemd"',
    '  cat <<EOF_SVC > /etc/systemd/system/nexus-storage-node.service',
    '[Unit]',
    'Description=Nexus ITAM Cloud Vault Storage Node Agent',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    'User=${SVC_USER}',
    'Group=${SVC_GROUP}',
    'EnvironmentFile=/etc/nexus-storage-node/agent.env',
    'ExecStart=${NODE_BIN} /opt/nexus-storage-node/server.mjs',
    'Restart=always',
    'RestartSec=3',
    'NoNewPrivileges=true',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    'EOF_SVC',
    '  systemctl daemon-reload',
    '  systemctl enable nexus-storage-node >/dev/null 2>&1 || true',
    '  systemctl restart nexus-storage-node',
    'else',
    '  if command -v pkill >/dev/null 2>&1; then',
    '    pkill -f "/opt/nexus-storage-node/server.mjs" >/dev/null 2>&1 || true',
    '  fi',
    '  set -a',
    '  . /etc/nexus-storage-node/agent.env',
    '  set +a',
    '  nohup "$NODE_BIN" /opt/nexus-storage-node/server.mjs >/var/log/nexus-storage-node.log 2>&1 &',
    'fi',
    '',
    'if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi "Status: active"; then',
    '  ufw allow "${NEXUS_NODE_PORT}/tcp" >/dev/null 2>&1 || true',
    'elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state 2>/dev/null | grep -qi "running"; then',
    '  firewall-cmd --permanent --add-port="${NEXUS_NODE_PORT}/tcp" >/dev/null 2>&1 || true',
    '  firewall-cmd --reload >/dev/null 2>&1 || true',
    'fi',
    '',
    'echo "[Nexus Storage Node] Validando handshake HMAC-SHA256 local..."',
    'if ! "$NODE_BIN" -e \'',
    '  const crypto = require("node:crypto");',
    '  const port = process.env.NEXUS_NODE_PORT;',
    '  const token = process.env.NEXUS_NODE_HMAC_TOKEN;',
    '  const bodyHash = crypto.createHash("sha256").update("").digest("hex");',
    '  (async () => {',
    '    for (let i = 0; i < 15; i++) {',
    '      try {',
    '        const ts = String(Date.now());',
    '        const sig = crypto.createHmac("sha256", token).update(`${ts}.GET./health.${bodyHash}`).digest("hex");',
    '        const r = await fetch(`http://127.0.0.1:${port}/health`, { headers: { "x-nexus-ts": ts, "x-nexus-sig": sig } });',
    '        if (r.ok) { const j = await r.json(); console.log("[Nexus Storage Node] Healthcheck OK:", JSON.stringify({ status: j.status, usedBytes: j.usedBytes, quotaBytes: j.quotaBytes })); process.exit(0); }',
    '      } catch {}',
    '      await new Promise((r) => setTimeout(r, 400));',
    '    }',
    '    console.error("[Nexus Storage Node] Erro: agente não respondeu ao /health local.");',
    '    process.exit(1);',
    '  })();',
    '\'; then',
    '  if [ "$SERVICE_MODE" = "systemd" ]; then',
    '    journalctl -u nexus-storage-node -n 25 --no-pager >&2 || true',
    '  else',
    '    tail -n 25 /var/log/nexus-storage-node.log >&2 || true',
    '  fi',
    '  exit 1',
    'fi',
    '',
    'PUBLIC_IP=""',
    'if command -v curl >/dev/null 2>&1; then',
    '  PUBLIC_IP="$(curl -4 -fsS --max-time 3 https://api.ipify.org 2>/dev/null || true)"',
    'fi',
    'if [ -z "$PUBLIC_IP" ]; then',
    '  PUBLIC_IP="$(hostname -I 2>/dev/null | awk \'{print $1}\' || echo "SEU_IP_VPS")"',
    'fi',
    '',
    'echo "=================================================================="',
    'echo "  [Nexus Storage Node] Agente ativo e pronto na VPS!"',
    'echo "  Modo          : $SERVICE_MODE"',
    'echo "  Endpoint URL  : http://${PUBLIC_IP}:${NEXUS_NODE_PORT}"',
    'echo "  Diretorio     : ${NEXUS_VAULT_ROOT}"',
    'echo "  Cota Maxima   : ${NEXUS_VAULT_QUOTA_BYTES} bytes"',
    'echo "  Firewall      : Libere ${NEXUS_NODE_PORT}/tcp no painel da VPS (Hostinger/Cloud)"',
    'echo "                  ou configure proxy reverso HTTPS para http://127.0.0.1:${NEXUS_NODE_PORT}"',
    'echo "=================================================================="',
    '__NEXUS_INSTALLER_EOF__',
  ];

  return lines.join('\n');
}
