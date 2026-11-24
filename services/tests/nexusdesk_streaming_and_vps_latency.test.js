// services/tests/nexusdesk_streaming_and_vps_latency.test.js
// =============================================================================
// Validação E2E de Baixa Latência VPS (Keep-Alive + mkdir-batch + Fast Quota)
// e Streaming Full-Duplex 60 FPS NexusDesk (WebSocket Agent <-> Viewer)
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startAllMicroservices } from '../orchestrator.js';
import { startNexusStorageNodeAgent } from '../service-storage/src/agent/nexusStorageNodeServer.js';
import { createAgentNodeDriver } from '../service-storage/src/drivers/agentNodeDriver.js';
import { resetMemoryStoreWithSeed } from '../shared/db.js';
import { signJwt } from '../shared/security.js';

function waitForWsEvent(frames, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const foundNow = frames.find(predicate);
    if (foundNow) {
      resolve(foundNow);
      return;
    }
    const deadline = setTimeout(() => {
      clearInterval(timer);
      reject(new Error('Timeout aguardando frame WebSocket esperado.'));
    }, timeoutMs);
    const timer = setInterval(() => {
      const match = frames.find(predicate);
      if (match) {
        clearInterval(timer);
        clearTimeout(deadline);
        resolve(match);
      }
    }, 15);
  });
}

describe('Otimizações VPS Keep-Alive & NexusDesk Full-Duplex 60 FPS WebSocket', () => {
  let tmpDir;
  let storageNode;
  let cluster;
  let ownerToken;

  beforeAll(async () => {
    process.env.NEXUS_DB_MODE = 'memory';
    resetMemoryStoreWithSeed();
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-fast-vps-'));
    cluster = await startAllMicroservices({ host: '127.0.0.1', basePort: 18420, logger: false });
    ownerToken = signJwt({
      sub: '11111111-2222-4333-8444-555555555555',
      email: 'ti@shineraybysabel.com.br',
      name: 'Gestor TI',
      role: 'owner',
      tenantId: 'tenant-ap3htf6',
      department: 'TI',
    });
  }, 45_000);

  afterAll(async () => {
    try {
      if (storageNode) await storageNode.stop();
    } finally {
      try {
        if (cluster) await cluster.closeAll();
      } finally {
        if (tmpDir && fs.existsSync(tmpDir)) {
          await fsp.rm(tmpDir, { recursive: true, force: true });
        }
      }
    }
  }, 45_000);

  it('1. Nexus Storage Node + agentNodeDriver reutilizam socket TCP Keep-Alive, criam pastas em lote (/mkdir-batch) e atualizam cota em memória O(1)', async () => {
    const hmacToken = `nsn_${crypto.randomBytes(24).toString('hex')}`;
    storageNode = await startNexusStorageNodeAgent({
      rootDir: tmpDir,
      quotaBytes: 1_048_576,
      hmacToken,
      host: '127.0.0.1',
      port: 0,
    });

    const driver = createAgentNodeDriver(
      { endpointUrl: storageNode.url, rootPath: '/' },
      { hmacToken },
    );

    const health = await driver.testConnection();
    expect(health.ok).toBe(true);
    expect(health.status).toBe('connected');
    expect(health.transportDetails?.keepAlive).toBe(true);
    expect(health.transportDetails?.reusedSocket).toBe(true);
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);

    const batchRes = await driver.mkdirBatch([
      '/Corporativo-Publico',
      '/TI/Scripts',
      '/Financeiro/2026',
      '/RH/Termos',
    ]);
    expect(batchRes.ok).toBe(true);

    const dirEntries = await fsp.readdir(tmpDir, { withFileTypes: true });
    const dirNames = dirEntries.filter((e) => e.isDirectory()).map((e) => e.name);
    expect(dirNames).toEqual(expect.arrayContaining(['Corporativo-Publico', 'TI', 'Financeiro', 'RH']));
    expect(fs.existsSync(path.join(tmpDir, 'TI', 'Scripts'))).toBe(true);

    const payload = Buffer.alloc(2048, 0x42);
    await driver.writeFile('/TI/Scripts/deploy.sh', payload);
    const statAfterWrite = await driver.statfs();
    expect(statAfterWrite.usedBytes).toBe(2048);

    await driver.copy('/TI/Scripts/deploy.sh', '/TI/Scripts/deploy-backup.sh');
    const statAfterCopy = await driver.statfs();
    expect(statAfterCopy.usedBytes).toBe(4096);

    await driver.remove('/TI/Scripts/deploy-backup.sh');
    const statAfterRemove = await driver.statfs();
    expect(statAfterRemove.usedBytes).toBe(2048);
  });

  it('2. NexusDesk WebSocket transmite frames 60 FPS (ultra + sharp) e inputs push em tempo real isolando viewers e outros agentes', async () => {
    const tenantId = 'tenant-ap3htf6';
    const sessionId = 'rem-ultra-60fps-test';

    const agent1Frames = [];
    const agent2Frames = [];
    const viewer1Frames = [];
    const viewer2Frames = [];

    const agent1Ws = new WebSocket(
      `${cluster.wsUrl}?tenantId=${tenantId}&deviceKey=dev-win-01&client=nexusdesk-agent`,
    );
    const agent2Ws = new WebSocket(
      `${cluster.wsUrl}?tenantId=${tenantId}&deviceKey=dev-win-02&client=nexusdesk-agent`,
    );
    const viewer1Ws = new WebSocket(
      `${cluster.wsUrl}?token=${encodeURIComponent(ownerToken)}&tenantId=${tenantId}&deviceKey=dev-win-01&client=nexusdesk-viewer`,
    );
    const viewer2Ws = new WebSocket(
      `${cluster.wsUrl}?token=${encodeURIComponent(ownerToken)}&tenantId=${tenantId}&deviceKey=dev-win-02&client=nexusdesk-viewer`,
    );

    const bindCollector = (ws, bucket) => {
      ws.on('message', (raw) => {
        bucket.push(JSON.parse(String(raw)));
      });
    };

    bindCollector(agent1Ws, agent1Frames);
    bindCollector(agent2Ws, agent2Frames);
    bindCollector(viewer1Ws, viewer1Frames);
    bindCollector(viewer2Ws, viewer2Frames);

    try {
      await Promise.all([
        waitForWsEvent(agent1Frames, (f) => f.event === 'welcome'),
        waitForWsEvent(agent2Frames, (f) => f.event === 'welcome'),
        waitForWsEvent(viewer1Frames, (f) => f.event === 'welcome'),
        waitForWsEvent(viewer2Frames, (f) => f.event === 'welcome'),
      ]);

      expect(agent1Frames[0].role).toBe('agent');

      // Agente 1 envia quadro de movimento + quadro progressivo nítido (sharp: true, quality: 'ultra')
      agent1Ws.send(
        JSON.stringify({
          action: 'remote.frame',
          deviceKey: 'dev-win-01',
          sessionId,
          ackInputSeq: 0,
          frame: {
            sessionId,
            seq: 1,
            width: 1920,
            height: 1080,
            quality: 'ultra',
            sharp: false,
            mime: 'image/jpeg',
            data: '/9j/4AAQSkZJRgABAQAAAQABAAD/',
          },
        }),
      );
      agent1Ws.send(
        JSON.stringify({
          action: 'remote.frame',
          deviceKey: 'dev-win-01',
          sessionId,
          ackInputSeq: 0,
          frame: {
            sessionId,
            seq: 2,
            width: 2560,
            height: 1440,
            quality: 'ultra',
            sharp: true,
            mime: 'image/jpeg',
            data: '/9j/4AAQSkZJRgABAQEASABIAAD/',
          },
        }),
      );

      const sharpFrame = await waitForWsEvent(
        viewer1Frames,
        (f) => f.event === 'remote.frame' && f.data?.frame?.seq === 2,
      );
      expect(sharpFrame.data.deviceKey).toBe('dev-win-01');
      expect(sharpFrame.data.frame.quality).toBe('ultra');
      expect(sharpFrame.data.frame.sharp).toBe(true);
      expect(sharpFrame.data.frame.width).toBe(2560);

      // Operador envia arraste de mouse em tempo real + qualidade ultra 60 FPS pelo WebSocket
      viewer1Ws.send(
        JSON.stringify({
          action: 'remote.control',
          data: {
            deviceKey: 'dev-win-01',
            sessionId,
            status: 'active',
            mode: 'unattended',
            quality: 'ultra',
            targetFps: 60,
            monitorIndex: 0,
            inputEvents: [
              { seq: 1, type: 'mousedown', button: 'left', x: 0.25, y: 0.4 },
              { seq: 2, type: 'mousedrag', button: 'left', x: 0.55, y: 0.65 },
              { seq: 3, type: 'mouseup', button: 'left', x: 0.55, y: 0.65 },
            ],
          },
        }),
      );

      const pushedControl = await waitForWsEvent(
        agent1Frames,
        (f) => f.event === 'remote.control' && f.data?.sessionId === sessionId,
      );
      expect(pushedControl.data.quality).toBe('ultra');
      expect(pushedControl.data.targetFps).toBe(60);
      expect(pushedControl.data.inputEvents).toHaveLength(3);
      expect(pushedControl.data.inputEvents[1].type).toBe('mousedrag');

      // Dispara evento de domínio (heartbeat) e aguarda propagação curta para provar isolamento
      await fetch(`${cluster.gatewayUrl}/api/v1/telemetry/heartbeat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          deviceKey: 'dev-win-01',
          hostname: 'NEXUS-WS-01',
          cpuPercent: 18,
          ramPercent: 42,
          diskPercent: 50,
        }),
      });
      await waitForWsEvent(viewer1Frames, (f) => f.event === 'telemetry.heartbeat');

      // Isolamento de banda e segurança Zero-Trust:
      // Viewer 2 (assistindo dev-win-02) não recebe frames JPEG de dev-win-01
      expect(viewer2Frames.some((f) => f.event === 'remote.frame')).toBe(false);
      // Agente 2 nunca recebe frames de vídeo, controles de dev-win-01 nem eventos de domínio do tenant
      expect(agent2Frames.filter((f) => f.event !== 'welcome')).toHaveLength(0);
      expect(agent1Frames.some((f) => f.event === 'telemetry.heartbeat')).toBe(false);
    } finally {
      agent1Ws.close();
      agent2Ws.close();
      viewer1Ws.close();
      viewer2Ws.close();
    }
  });
});
