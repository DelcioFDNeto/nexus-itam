// src/utils/agentScripts.js
// -----------------------------------------------------------------------------
// Monta os scripts do Agente ITAM a partir dos arquivos em src/agent/.
// Os scripts sao arquivos de verdade (.ps1/.sh) — antes viviam dentro de
// strings JavaScript, onde barras invertidas e "${}" quebravam o codigo gerado.
// -----------------------------------------------------------------------------
import windowsAgent from '../agent/windows/nexus-agent.ps1?raw';
import windowsInstaller from '../agent/windows/install.ps1?raw';
import linuxAgent from '../agent/linux/nexus-agent.sh?raw';
import linuxInstaller from '../agent/linux/install.sh?raw';
import macAgent from '../agent/mac/nexus-agent.sh?raw';
import macInstaller from '../agent/mac/install.sh?raw';
import { AGENT_VERSION } from './agentInventory';

export const AGENT_TARGETS = {
  windows: { label: 'Windows', ext: '.ps1' },
  linux: { label: 'Linux', ext: '.sh' },
  mac: { label: 'macOS', ext: '.sh' },
};

export const AGENT_MODES = {
  portable: 'Coleta única',
  service: 'Instalar (automático)',
  uninstall: 'Desinstalar',
};

export const DEFAULT_FIRESTORE_BASE = 'https://firestore.googleapis.com/v1';

// O valor vai para dentro de aspas no script: so caracteres inofensivos.
const SAFE_VALUE = /^[A-Za-z0-9_.:-]+$/;
const SAFE_URL = /^https?:\/\/[A-Za-z0-9_.:/-]+$/;

const assertSafe = (name, value, pattern = SAFE_VALUE) => {
  if (!pattern.test(String(value ?? ''))) {
    throw new Error(`Parâmetro inválido para o script do agente: ${name}.`);
  }
};

const lf = (code) => code.replace(/\r\n/g, '\n');
const crlf = (code) => lf(code).replace(/\n/g, '\r\n');

// split/join e nao replace(): o codigo tem "$$" e "$'", que o replace() com string interpretaria.
const fill = (template, values) =>
  Object.entries(values).reduce((code, [key, value]) => code.split(`__${key}__`).join(String(value)), template);

const toBase64Utf8 = (value) => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const UNINSTALL = {
  windows: `#Requires -RunAsAdministrator
# Nexus ITAM - remove o agente deste computador
Unregister-ScheduledTask -TaskName 'NexusITAM_AgentSync' -Confirm:$false -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $env:ProgramData 'NexusITAM') -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'Agente Nexus ITAM removido.'
`,
  linux: `#!/usr/bin/env bash
# Nexus ITAM - remove o agente deste computador (rode com sudo)
rm -f /etc/cron.d/nexus-itam
rm -rf /opt/nexus-itam
echo 'Agente Nexus ITAM removido.'
`,
  mac: `#!/bin/bash
# Nexus ITAM - remove o agente deste computador (rode com sudo)
launchctl bootout system /Library/LaunchDaemons/com.nexusitam.agent.plist 2>/dev/null || true
rm -f /Library/LaunchDaemons/com.nexusitam.agent.plist
rm -rf /usr/local/nexus-itam
echo 'Agente Nexus ITAM removido.'
`,
};

/**
 * @param {{ os: 'windows'|'linux'|'mac', mode: 'portable'|'service'|'uninstall',
 *           projectId: string, apiKey: string, tenantId: string, agentToken: string,
 *           firestoreBase?: string }} options
 * @returns {{ content: string, filename: string, mime: string }}
 */
export const buildAgentScript = ({ os = 'windows', mode = 'portable', projectId, apiKey, tenantId, agentToken, firestoreBase = DEFAULT_FIRESTORE_BASE }) => {
  const target = AGENT_TARGETS[os];
  if (!target) throw new Error(`Sistema não suportado: ${os}.`);
  if (!AGENT_MODES[mode]) throw new Error(`Modo não suportado: ${mode}.`);
  const filename = `nexus-agente-${os}-${mode === 'portable' ? 'coleta' : mode === 'service' ? 'instalar' : 'remover'}${target.ext}`;
  const finish = (code) => ({
    // BOM: o PowerShell 5.1 le .ps1 sem BOM como ANSI.
    content: os === 'windows' ? `\uFEFF${crlf(code)}` : lf(code),
    filename,
    mime: 'text/plain;charset=utf-8',
  });

  if (mode === 'uninstall') return finish(UNINSTALL[os]);

  assertSafe('projectId', projectId);
  assertSafe('apiKey', apiKey);
  assertSafe('tenantId', tenantId);
  assertSafe('token', agentToken);
  assertSafe('endpoint', firestoreBase, SAFE_URL);

  const values = { AGENT_VERSION, PROJECT_ID: projectId, API_KEY: apiKey, TENANT_ID: tenantId, AGENT_TOKEN: agentToken, FIRESTORE_BASE: firestoreBase.replace(/\/+$/, '') };
  const agent = fill({ windows: windowsAgent, linux: linuxAgent, mac: macAgent }[os], values);
  if (mode === 'portable') return finish(agent);

  if (os === 'windows') {
    return finish(fill(windowsInstaller, { AGENT_VERSION, AGENT_CODE_BASE64: toBase64Utf8(crlf(agent)) }));
  }
  const installer = os === 'linux' ? linuxInstaller : macInstaller;
  return finish(fill(installer, { AGENT_VERSION, AGENT_CODE: lf(agent).trimEnd() }));
};

// Assinaturas antigas (mantidas para quem ainda chama assim).
const legacy = (os) => (projectId, apiKey, tenantId, agentToken, mode = 'portable') =>
  buildAgentScript({ os, mode, projectId, apiKey, tenantId, agentToken }).content;
export const buildWindowsScript = legacy('windows');
export const buildLinuxScript = legacy('linux');
export const buildMacScript = legacy('mac');
