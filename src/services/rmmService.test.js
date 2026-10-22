import { describe, it, expect, vi, beforeEach } from 'vitest';

const batch = { set: vi.fn(), commit: vi.fn().mockResolvedValue() };

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ name })),
  doc: vi.fn((_db, name, id) => ({ path: `${name}/${id}`, id })),
  deleteDoc: vi.fn(),
  deleteField: vi.fn(() => '__delete__'),
  getDocs: vi.fn().mockResolvedValue({ docs: [], size: 0 }),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  serverTimestamp: vi.fn(() => '__now__'),
  setDoc: vi.fn().mockResolvedValue(),
  updateDoc: vi.fn().mockResolvedValue(),
  where: vi.fn(),
  writeBatch: vi.fn(() => batch),
}));
vi.mock('./firebase', () => ({ db: {} }));

const { updateDoc } = await import('firebase/firestore');
const {
  MAX_COMMAND_LENGTH,
  dispatchRemoteCommand,
  isDeviceOnline,
  resolveRuntimePolicy,
  startRemoteSession,
} = await import('./rmmService');

const user = { uid: 'u-gestor', name: 'Gestora TI' };
const writes = () => Object.fromEntries(batch.set.mock.calls.map(([ref, data]) => [ref.path, data]));

describe('rmmService', () => {
  beforeEach(() => {
    batch.set.mockClear();
    batch.commit.mockClear();
    updateDoc.mockClear();
  });

  it('comando vai no mesmo batch da auditoria, com o mesmo ID, autor e hora do servidor', async () => {
    const sent = await dispatchRemoteCommand({ tenantId: 'acme', deviceKey: 'k1', hostname: 'PC-01', type: 'powershell', command: 'ipconfig', user });
    const all = writes();
    expect(batch.commit).toHaveBeenCalledTimes(1);
    expect(all[`agentAudit/${sent.id}`]).toMatchObject({ tenantId: 'acme', deviceKey: 'k1', action: 'command', byUid: 'u-gestor', at: '__now__', detail: 'powershell: ipconfig' });
    expect(all['agentControl/acme_k1'].pendingCommand).toMatchObject({ id: sent.id, requestedByUid: 'u-gestor', issuedAt: '__now__' });
    // Acorda a maquina para ela consultar o canal.
    expect(updateDoc).toHaveBeenCalledWith({ path: 'agentDevices/acme_k1', id: 'acme_k1' }, { consoleWakeAt: '__now__' });
  });

  it('recusa comando maior que o limite do agente', async () => {
    await expect(dispatchRemoteCommand({ tenantId: 'acme', deviceKey: 'k1', type: 'powershell', command: 'x'.repeat(MAX_COMMAND_LENGTH + 1), user }))
      .rejects.toThrow(/longo demais/);
    expect(batch.commit).not.toHaveBeenCalled();
  });

  it('sessao remota pede consentimento por padrao e nasce auditada', async () => {
    const sessionId = await startRemoteSession({ tenantId: 'acme', deviceKey: 'k1', user });
    const all = writes();
    expect(all['agentControl/acme_k1'].remoteSession).toMatchObject({ sessionId, status: 'requesting', mode: 'attended', requestedByUid: 'u-gestor' });
    expect(all[`agentAudit/${sessionId}`]).toMatchObject({ action: 'remote_request', mode: 'attended', byUid: 'u-gestor' });
  });

  it('online respeita o intervalo do sinal da politica e o status final da maquina', () => {
    const now = Date.parse('2026-10-22T12:00:00Z');
    const seen = (secondsAgo, extra = {}) => ({ lastSeenAt: new Date(now - secondsAgo * 1000).toISOString(), ...extra });
    expect(isDeviceOnline(seen(60), now)).toBe(true);
    expect(isDeviceOnline(seen(120), now)).toBe(false);
    expect(isDeviceOnline(seen(280, { heartbeatSeconds: 120 }), now)).toBe(true);
    expect(isDeviceOnline(seen(310, { heartbeatSeconds: 120 }), now)).toBe(false);
    expect(isDeviceOnline(seen(5, { status: 'revoked' }), now)).toBe(false);
  });

  it('politica: padrao com consentimento e limites do intervalo', () => {
    expect(resolveRuntimePolicy({})).toEqual({ remoteAccess: 'consent', commandsEnabled: true, heartbeatSeconds: 120 });
    expect(resolveRuntimePolicy({ remoteAccess: 'sempre', heartbeatSeconds: 5 })).toMatchObject({ remoteAccess: 'consent', heartbeatSeconds: 30 });
    expect(resolveRuntimePolicy({ remoteAccess: 'disabled', commandsEnabled: false, heartbeatSeconds: 5000 })).toEqual({ remoteAccess: 'disabled', commandsEnabled: false, heartbeatSeconds: 900 });
  });
});
