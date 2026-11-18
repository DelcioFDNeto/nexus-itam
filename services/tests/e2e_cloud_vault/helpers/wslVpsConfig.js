// services/tests/e2e_cloud_vault/helpers/wslVpsConfig.js
// =============================================================================
// Zero-Secret Dynamic Reference VPS Config Resolver (Test-Only)
// =============================================================================
// - Zero external dependencies (node:fs, node:os, node:path only)
// - Checks NEXUS_TEST_VPS_* env vars first, falls back to WSL ~/.ssh/config
// - Never hardcodes any IP, hostname, username, port, or SSH key material
// - Strictly blocks /opt/shineray in disposable test root creation
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_WSL_SSH_CONFIG = '\\\\wsl.localhost\\Ubuntu\\home\\shineray\\.ssh\\config';
export const DEFAULT_WSL_SSH_DIR = '\\\\wsl.localhost\\Ubuntu\\home\\shineray\\.ssh';
export const FORBIDDEN_ROOT_PREFIXES = ['/opt/shineray'];

function stripQuotes(val) {
  const s = String(val || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseSshConfigHostBlock(configText, hostAlias) {
  const lines = String(configText || '').split(/\r?\n/);
  let inMatchingHost = false;
  let found = false;
  const parsed = {};

  for (const rawLine of lines) {
    const cleaned = rawLine.replace(/#.*$/, '').trim();
    if (!cleaned) continue;

    const match = /^([a-zA-Z0-9_-]+)\s*(?:=|\s+)\s*(.+)$/.exec(cleaned);
    if (!match) continue;

    const key = match[1].toLowerCase();
    const val = stripQuotes(match[2]);

    if (key === 'host') {
      const patterns = val.split(/\s+/).filter(Boolean);
      inMatchingHost = patterns.includes(hostAlias);
      if (inMatchingHost) found = true;
      continue;
    }

    if (!inMatchingHost) continue;

    if (key === 'hostname' && !parsed.host) parsed.host = val;
    else if (key === 'user' && !parsed.username) parsed.username = val;
    else if (key === 'port' && !parsed.port) parsed.port = Number(val) || 22;
    else if (key === 'identityfile' && !parsed.identityFile) parsed.identityFile = val;
  }

  return found ? parsed : null;
}

function resolveIdentityFilePath(rawIdentityFile, wslSshDir) {
  if (!rawIdentityFile) return null;
  const raw = stripQuotes(rawIdentityFile);

  if (raw.startsWith('~/.ssh/') || raw.startsWith('~/.ssh\\')) {
    const rest = raw.slice('~/.ssh/'.length).replace(/\//g, path.sep);
    return path.join(wslSshDir, rest);
  }

  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    const rest = raw.slice(2).replace(/\//g, path.sep);
    const homeBase = path.dirname(wslSshDir) || os.homedir();
    return path.join(homeBase, rest);
  }

  if (process.platform === 'win32' && raw.startsWith('/home/')) {
    // Map POSIX /home/... to WSL UNC root when wslSshDir is UNC
    const uncMatch = /^(\\\\wsl\.localhost\\[^\\]+)\\home\\/i.exec(wslSshDir);
    if (uncMatch) {
      return path.join(uncMatch[1], raw.replace(/\//g, '\\'));
    }
  }

  return raw;
}

export function resolveReferenceVpsConfig({
  hostAlias = 'shineray-vps',
  env = process.env,
  configPath = DEFAULT_WSL_SSH_CONFIG,
  wslSshDir = DEFAULT_WSL_SSH_DIR,
} = {}) {
  const envHost = env?.NEXUS_TEST_VPS_HOST ? String(env.NEXUS_TEST_VPS_HOST).trim() : '';
  const envUser = env?.NEXUS_TEST_VPS_USER ? String(env.NEXUS_TEST_VPS_USER).trim() : '';
  const envPort = env?.NEXUS_TEST_VPS_PORT ? Number(env.NEXUS_TEST_VPS_PORT) : null;
  const envPrivateKey = env?.NEXUS_TEST_VPS_PRIVATE_KEY ? String(env.NEXUS_TEST_VPS_PRIVATE_KEY) : '';
  const envKeyPath = env?.NEXUS_TEST_VPS_KEY_PATH ? String(env.NEXUS_TEST_VPS_KEY_PATH).trim() : '';
  const envPassword = env?.NEXUS_TEST_VPS_PASSWORD ? String(env.NEXUS_TEST_VPS_PASSWORD) : '';

  if (envHost && envUser) {
    let privateKey = envPrivateKey || undefined;
    if (!privateKey && envKeyPath) {
      try {
        privateKey = fs.readFileSync(envKeyPath, 'utf8');
      } catch {
        return null;
      }
    }
    if (privateKey || envPassword) {
      return {
        source: 'env',
        host: envHost,
        port: Number.isFinite(envPort) && envPort > 0 ? envPort : 22,
        username: envUser,
        ...(envKeyPath ? { keyPath: envKeyPath } : {}),
        ...(privateKey ? { privateKey } : {}),
        ...(envPassword ? { password: envPassword } : {}),
      };
    }
  }

  let configText;
  try {
    if (!fs.existsSync(configPath)) return null;
    configText = fs.readFileSync(configPath, 'utf8');
  } catch {
    return null;
  }

  const block = parseSshConfigHostBlock(configText, hostAlias);
  if (!block || !block.host || !block.username) {
    return null;
  }

  const keyPath = envKeyPath || resolveIdentityFilePath(block.identityFile, wslSshDir);
  let privateKey = envPrivateKey || undefined;
  if (!privateKey && keyPath) {
    try {
      privateKey = fs.readFileSync(keyPath, 'utf8');
    } catch {
      return null;
    }
  }

  if (!privateKey && !envPassword) {
    return null;
  }

  return {
    source: 'wsl-ssh-config',
    hostAlias,
    host: envHost || block.host,
    port: Number.isFinite(envPort) && envPort > 0 ? envPort : block.port || 22,
    username: envUser || block.username,
    ...(keyPath ? { keyPath } : {}),
    ...(privateKey ? { privateKey } : {}),
    ...(envPassword ? { password: envPassword } : {}),
  };
}

export function assertSafeVpsTestRoot(rootPath) {
  const normalized = path.posix.normalize(String(rootPath || '').trim().replace(/\\/g, '/'));
  if (!normalized || normalized.includes('..')) {
    throw new Error('Unsafe VPS test root path: traversal not allowed');
  }
  for (const forbidden of FORBIDDEN_ROOT_PREFIXES) {
    if (normalized === forbidden || normalized.startsWith(`${forbidden}/`)) {
      throw new Error(`Forbidden VPS test root path: ${forbidden} must never be touched`);
    }
  }
  if (!normalized.startsWith('/tmp/nexus-vault-e2e-')) {
    throw new Error('VPS test root must reside under /tmp/nexus-vault-e2e-*');
  }
  return normalized;
}

export function createDisposableVpsRoot(configOrRunId, maybeRunId) {
  const rawRunId =
    typeof configOrRunId === 'string' && maybeRunId === undefined ? configOrRunId : maybeRunId;
  const sanitized = String(rawRunId || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 48);
  const safeRunId = sanitized || `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const candidate = path.posix.normalize(`/tmp/nexus-vault-e2e-${safeRunId}`);
  return assertSafeVpsTestRoot(candidate);
}
