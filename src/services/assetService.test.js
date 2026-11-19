import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  getAllAssets, createAsset, updateAsset, deleteAsset, 
  moveAsset, writeOffAsset, reactivateAsset, registerMaintenance,
  mapReactAssetToGateway, syncAssetsToPortalGateway
} from './assetService';
import { microservicesApi } from './microservicesClient';
import { getDocs, getDoc, writeBatch } from 'firebase/firestore';

const mockBatch = {
  set: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  commit: vi.fn().mockResolvedValue()
};

vi.mock('firebase/firestore', () => {
  return {
    collection: vi.fn(),
    doc: vi.fn((_col, id) => ({ id: id || '3' })),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    serverTimestamp: vi.fn(() => 'TIMESTAMP'),
    collectionGroup: vi.fn(),
    writeBatch: vi.fn(() => mockBatch),
    getFirestore: vi.fn()
  };
});

vi.mock('./firebase', () => {
  return {
    db: {}
  };
});

describe('assetService (atomic writeBatch)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBatch.set.mockClear();
    mockBatch.update.mockClear();
    mockBatch.delete.mockClear();
    mockBatch.commit.mockClear();
  });

  it('fetches assets successfully', async () => {
    const mockData = {
      docs: [
        { id: '1', data: () => ({ name: 'MacBook', tenantId: 'tenant1' }) },
        { id: '2', data: () => ({ name: 'Dell', tenantId: 'tenant1' }) }
      ]
    };
    getDocs.mockResolvedValueOnce(mockData);

    const assets = await getAllAssets('tenant1');
    
    expect(getDocs).toHaveBeenCalled();
    expect(assets.length).toBe(2);
    expect(assets[0].name).toBe('MacBook');
  });

  it('adds an asset and records history atomically via writeBatch', async () => {
    const newAsset = { name: 'Iphone 13', tenantId: 'tenant1' };

    const docRef = await createAsset(newAsset);
    
    expect(writeBatch).toHaveBeenCalled();
    expect(mockBatch.set).toHaveBeenCalledTimes(2);
    expect(mockBatch.set.mock.calls[0][1]).toMatchObject({ name: 'Iphone 13', tenantId: 'tenant1' });
    expect(mockBatch.set.mock.calls[1][1]).toMatchObject({
      assetId: '3',
      tenantId: 'tenant1',
      type: 'creation',
      action: 'Ativo Criado'
    });
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    expect(docRef.id).toBe('3');
  });

  it('throws error when creating asset without tenantId', async () => {
    await expect(createAsset({ name: 'Sem tenant' })).rejects.toThrow("tenantId");
  });

  it('updates an asset and records history atomically via writeBatch', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ tenantId: 'tenant1' }) });

    await updateAsset('1', { status: 'Ativo' });
    
    expect(mockBatch.update).toHaveBeenCalledTimes(1);
    expect(mockBatch.update.mock.calls[0][1]).toMatchObject({ status: 'Ativo' });
    expect(mockBatch.set).toHaveBeenCalledTimes(1);
    expect(mockBatch.set.mock.calls[0][1]).toMatchObject({
      assetId: '1',
      tenantId: 'tenant1',
      type: 'update'
    });
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('registra o historico com o tenant do ativo quando o chamador nao informa', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ tenantId: 'tenant9' }) });

    await updateAsset('1', { status: 'Disponível' }, { action: 'Alteração em Massa', user: 'a@b.com' });

    expect(mockBatch.set.mock.calls[0][1].tenantId).toBe('tenant9');
    expect(mockBatch.set.mock.calls[0][1].action).toBe('Alteração em Massa');
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('nao consulta o ativo quando o tenant ja foi informado', async () => {
    await updateAsset('1', { status: 'Disponível', tenantId: 'tenant1' }, { action: 'X' });

    expect(getDoc).not.toHaveBeenCalled();
    expect(mockBatch.set.mock.calls[0][1].tenantId).toBe('tenant1');
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('deletes an asset and records history atomically via writeBatch', async () => {
    await deleteAsset('1', 'tenant1', 'admin@example.com');
    
    // ativo + inventario do Agente ITAM, no mesmo lote
    expect(mockBatch.delete).toHaveBeenCalledTimes(2);
    expect(mockBatch.set).toHaveBeenCalledTimes(1);
    expect(mockBatch.set.mock.calls[0][1]).toMatchObject({
      assetId: '1',
      tenantId: 'tenant1',
      type: 'deletion',
      action: 'Ativo Excluído',
      user: 'admin@example.com'
    });
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('moves an asset and records history atomically via writeBatch', async () => {
    const currentData = { tenantId: 'tenant1', location: 'Matriz', assignedTo: 'João' };
    const moveData = { newLocation: 'Filial', newResponsible: 'Maria', reason: 'Transferência' };

    await moveAsset('1', currentData, moveData, 'admin@example.com');

    expect(mockBatch.update).toHaveBeenCalledTimes(1);
    expect(mockBatch.update.mock.calls[0][1]).toMatchObject({
      location: 'Filial',
      assignedTo: 'Maria',
      status: 'Em Uso'
    });
    expect(mockBatch.set).toHaveBeenCalledTimes(1);
    expect(mockBatch.set.mock.calls[0][1]).toMatchObject({
      assetId: '1',
      tenantId: 'tenant1',
      type: 'movimentacao',
      action: 'Transferência',
      newLocation: 'Filial',
      newHolder: 'Maria'
    });
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('movimentacao nao reativa baixado, nao mexe em transito e preserva o status', async () => {
    await expect(moveAsset('1', { tenantId: 't', status: 'Baixado' }, { newLocation: 'X' })).rejects.toThrow(/baixado/);
    await expect(moveAsset('1', { tenantId: 't', status: 'Em Trânsito', transit: { termId: 'tt', number: 'TT-2026-0001' } }, { newLocation: 'X' })).rejects.toThrow(/TT-2026-0001/);
    expect(mockBatch.commit).not.toHaveBeenCalled();

    await moveAsset('1', { tenantId: 't', status: 'Manutenção', assignedTo: 'Ana' }, { newLocation: 'Oficina', newResponsible: 'Ana' });
    expect(mockBatch.update.mock.calls[0][1]).toMatchObject({ status: 'Manutenção', location: 'Oficina' });

    mockBatch.update.mockClear();
    await moveAsset('1', { tenantId: 't', status: 'Em Uso', assignedTo: 'Ana', clientCpf: '1' }, { newLocation: 'Estoque', newResponsible: '' });
    expect(mockBatch.update.mock.calls[0][1]).toMatchObject({ status: 'Disponível', assignedTo: '', clientCpf: '' });
  });

  it('baixa e manutencao recusam ativo em transito', async () => {
    const inTransit = { tenantId: 't', status: 'Em Trânsito', transit: { termId: 'tt', number: 'TT-2026-0002' } };
    await expect(writeOffAsset('1', inTransit, { date: '2026-10-01', reason: 'Perda' })).rejects.toThrow(/trânsito/);
    await expect(registerMaintenance('1', { tenantId: 't', asset: inTransit })).rejects.toThrow(/trânsito/);
  });

  it('writes off an asset and records history atomically via writeBatch', async () => {
    const currentData = { tenantId: 'tenant1', status: 'Em Uso' };
    const writeOff = { date: '2026-09-28', reason: 'Danificado sem conserto', residualValue: '100' };

    await writeOffAsset('1', currentData, writeOff, 'tecnico@example.com');

    expect(mockBatch.update).toHaveBeenCalledTimes(1);
    expect(mockBatch.update.mock.calls[0][1]).toMatchObject({
      status: 'Baixado',
      writeOffDate: '2026-09-28',
      writeOffReason: 'Danificado sem conserto'
    });
    expect(mockBatch.set).toHaveBeenCalledTimes(1);
    expect(mockBatch.set.mock.calls[0][1]).toMatchObject({
      assetId: '1',
      tenantId: 'tenant1',
      type: 'baixa',
      action: 'Baixa Patrimonial'
    });
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('reactivates an asset atomically via writeBatch', async () => {
    const currentData = { tenantId: 'tenant1', status: 'Baixado', writeOffReason: 'Antigo' };

    await reactivateAsset('1', currentData, 'admin@example.com', 'Disponível');

    expect(mockBatch.update).toHaveBeenCalledTimes(1);
    expect(mockBatch.update.mock.calls[0][1]).toMatchObject({
      status: 'Disponível',
      writeOffDate: '',
      writeOffReason: ''
    });
    expect(mockBatch.set).toHaveBeenCalledTimes(1);
    expect(mockBatch.set.mock.calls[0][1]).toMatchObject({
      assetId: '1',
      tenantId: 'tenant1',
      type: 'reativacao'
    });
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('registers maintenance atomically via writeBatch', async () => {
    const maintenanceData = { tenantId: 'tenant1', cost: '150,00', defect: 'Tela piscando' };

    await registerMaintenance('1', maintenanceData, 'tecnico@example.com');

    expect(mockBatch.update).toHaveBeenCalledTimes(1);
    expect(mockBatch.update.mock.calls[0][1]).toMatchObject({
      status: 'Manutenção'
    });
    expect(mockBatch.set).toHaveBeenCalledTimes(1);
    expect(mockBatch.set.mock.calls[0][1]).toMatchObject({
      assetId: '1',
      tenantId: 'tenant1',
      type: 'manutencao',
      action: 'Manutenção Iniciada',
      defect: 'Tela piscando'
    });
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('mapReactAssetToGateway preserva marca/modelo, resolve e-mail pelo colaborador e limpa custódia de baixados', () => {
    const employees = [
      { id: 'emp-1', name: 'Délcio Farias', email: 'ti@shineraybysabel.com.br' },
    ];

    const mapped = mapReactAssetToGateway(
      {
        internalId: 'shl-bel-ntb-001',
        type: 'Notebook',
        brand: 'Samsung',
        model: 'Galaxy Book 2',
        serialNumber: '0AC49QCX407574M',
        status: 'Em Uso',
        assignedTo: 'Délcio Farias',
        valor: '3.500,50',
      },
      employees,
    );

    expect(mapped.internalId).toBe('SHL-BEL-NTB-001');
    expect(mapped.brand).toBe('Samsung');
    expect(mapped.model).toBe('Galaxy Book 2');
    expect(mapped.assignedToName).toBe('Délcio Farias');
    expect(mapped.assignedToEmail).toBe('ti@shineraybysabel.com.br');
    expect(mapped.purchaseValue).toBe(3500.5);

    const retired = mapReactAssetToGateway(
      {
        internalId: 'SHL-BEL-NTB-002',
        model: 'Dell Latitude',
        status: 'Baixado',
        assignedTo: 'Délcio Farias',
        assignedToEmail: 'ti@shineraybysabel.com.br',
      },
      employees,
    );
    expect(retired.assignedToName).toBeNull();
    expect(retired.assignedToEmail).toBeNull();
  });

  it('syncAssetsToPortalGateway envia lote mapeado para microservicesApi.syncAssetsBatch', async () => {
    const syncSpy = vi
      .spyOn(microservicesApi, 'syncAssetsBatch')
      .mockResolvedValueOnce({ synced: 1 });

    const res = await syncAssetsToPortalGateway(
      [
        {
          id: 'doc-1',
          internalId: 'SHL-BEL-NTB-001',
          type: 'Notebook',
          model: 'Galaxy Book 2',
          assignedTo: 'Délcio Farias',
        },
      ],
      [{ id: 'emp-1', name: 'Délcio Farias', email: 'ti@shineraybysabel.com.br' }],
      { silent: false },
    );

    expect(res.synced).toBe(1);
    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(syncSpy.mock.calls[0][0][0]).toMatchObject({
      internalId: 'SHL-BEL-NTB-001',
      assignedToName: 'Délcio Farias',
      assignedToEmail: 'ti@shineraybysabel.com.br',
    });
    syncSpy.mockRestore();
  });
});
