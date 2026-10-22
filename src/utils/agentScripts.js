// src/utils/agentScripts.js
// -----------------------------------------------------------------------------
// Monta os scripts e pacotes instaladores do Agente ITAM (incluindo o executavel
// nativo NexusAgent.exe com Acesso Remoto e RMM no Windows) a partir de src/agent/.
//
// Windows instalado (3.1): o token da empresa vai so para o config.json, que o
// NexusAgent.exe usa UMA vez para matricular a maquina e depois apaga. O coletor
// PowerShell instalado nao carrega token. Scripts de coleta unica (Windows,
// Linux, macOS) seguem com o token embutido: eles enviam sozinhos.
// -----------------------------------------------------------------------------
import windowsAgent from '../agent/windows/nexus-agent.ps1?raw';
import windowsInstaller from '../agent/windows/install.ps1?raw';
import windowsAgentCs from '../agent/windows/NexusAgent.cs?raw';
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
  service: 'Instalar Agente + Acesso Remoto (.exe)',
  portable: 'Coleta única (Inventário)',
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
# Nexus ITAM - remove o agente deste computador. O NexusAgent.exe 3.1 tambem
# cancela a matricula da maquina: ela deixa de ter acesso a empresa na hora.
$dir = Join-Path $env:ProgramData 'NexusITAM'
$exe = Join-Path $dir 'NexusAgent.exe'
if (Test-Path $exe) { Start-Process -FilePath $exe -ArgumentList '--uninstall' -Wait -WindowStyle Hidden }
Stop-Service -Name 'NexusITAMAgent' -Force -ErrorAction SilentlyContinue
& sc.exe delete NexusITAMAgent | Out-Null
Get-Process -Name 'NexusAgent' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'NexusITAM_AgentSync' -Confirm:$false -ErrorAction SilentlyContinue
Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'NexusITAMAgent' -ErrorAction SilentlyContinue
$pubDesk = [Environment]::GetFolderPath('CommonDesktopDirectory')
if ($pubDesk) {
  foreach ($name in @('Nexus ITAM - Suporte.lnk', 'Nexus ITAM - Suporte e Agente.lnk')) { Remove-Item -Path (Join-Path $pubDesk $name) -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 4
Remove-Item -Path $dir -Recurse -Force -ErrorAction SilentlyContinue
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
    // Coletor instalado: so coleta (-OutFile) para o NexusAgent.exe enviar.
    const collector = fill(windowsAgent, { ...values, TENANT_ID: '', AGENT_TOKEN: '' });
    return finish(fill(windowsInstaller, {
      AGENT_VERSION,
      PROJECT_ID: projectId,
      API_KEY: apiKey,
      TENANT_ID: tenantId,
      AGENT_TOKEN: agentToken,
      AGENT_CODE_BASE64: toBase64Utf8(crlf(collector)),
      AGENT_CS_BASE64: toBase64Utf8(crlf(buildAgentSource({ projectId, apiKey }))),
    }));
  }
  const installer = os === 'linux' ? linuxInstaller : macInstaller;
  return finish(fill(installer, { AGENT_VERSION, AGENT_CODE: lf(agent).trimEnd() }));
};

/**
 * Gera um instalador Windows .cmd de clique duplo que solicita elevação UAC
 * automaticamente e instala o NexusAgent.exe + bandeja + acesso remoto + inventário.
 */
export const buildWindowsCmdInstaller = ({ projectId, apiKey, tenantId, agentToken, firestoreBase = DEFAULT_FIRESTORE_BASE }) => {
  const ps1 = buildAgentScript({ os: 'windows', mode: 'service', projectId, apiKey, tenantId, agentToken, firestoreBase }).content.replace(/^\uFEFF/, '');
  const ps1Base64 = toBase64Utf8(ps1);
  const cmd = crlf(`@echo off
chcp 65001 >nul
title Instalador Nexus ITAM - Agente & Acesso Remoto
echo ============================================================================
echo   NEXUS ITAM - Instalando Agente Nativo (NexusAgent.exe) e Acesso Remoto...
echo ============================================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$b64 = '${ps1Base64}'; $code = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($b64)); $tmp = Join-Path $env:TEMP 'nexus-agent-setup.ps1'; [System.IO.File]::WriteAllText($tmp, $code, (New-Object System.Text.UTF8Encoding($true))); Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File ' + [char]34 + $tmp + [char]34); Remove-Item $tmp -Force -ErrorAction SilentlyContinue"
echo.
echo Instalacao concluida! O icone do Nexus ITAM ja esta ativo perto do relogio.
timeout /t 4
`);
  return {
    content: cmd,
    filename: 'nexus-agente-windows-instalar.cmd',
    mime: 'application/x-bat;charset=utf-8',
  };
};

/** Codigo-fonte C# do NexusAgent.exe com o projeto e a chave de API do Firebase. */
export const buildAgentSource = ({ projectId, apiKey }) => {
  assertSafe('projectId', projectId);
  assertSafe('apiKey', apiKey);
  return fill(windowsAgentCs, { PROJECT_ID: projectId, API_KEY: apiKey });
};

/**
 * config.json para colocar ao lado do NexusAgent.exe avulso (.zip). O token so
 * vale ate a matricula: o executavel o apaga do arquivo ao instalar.
 */
export const buildAgentConfigJson = ({ projectId = 'itam-nexus', apiKey, tenantId, agentToken, patrimony = '' }) => {
  assertSafe('projectId', projectId);
  assertSafe('apiKey', apiKey);
  assertSafe('tenantId', tenantId);
  assertSafe('token', agentToken);
  const payload = {
    projectId,
    apiKey,
    tenantId,
    agentToken,
    patrimony,
  };
  return {
    content: JSON.stringify(payload, null, 2),
    filename: 'config.json',
    mime: 'application/json;charset=utf-8',
  };
};

// Assinaturas antigas (mantidas para quem ainda chama assim).
const legacy = (os) => (projectId, apiKey, tenantId, agentToken, mode = 'portable') =>
  buildAgentScript({ os, mode, projectId, apiKey, tenantId, agentToken }).content;
export const buildWindowsScript = legacy('windows');
export const buildLinuxScript = legacy('linux');
export const buildMacScript = legacy('mac');
