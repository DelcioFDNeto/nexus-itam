import { describe, it, expect } from 'vitest';
import {
  agentHealth,
  diffInventory,
  evaluateAgentAlerts,
  findAgentAsset,
  hostnameAssetTag,
  inferAssetType,
  ipInNetwork,
  isUsableId,
  vendorName,
  locationForIp,
  matchEmployeeByLogin,
  normalizeInventory,
  normalizeLogin,
  reconcileLicenses,
  resolveAgentPolicy,
  softwareMatches,
  summarizeFleet,
} from './agentInventory';

const v2 = (extra = {}) => ({
  agentVersion: '2.0.0',
  deviceId: '6f1c2a3b-1111-2222-3333-444455556666',
  hostname: 'LOJA-CAST-PDV01',
  loggedUser: 'SHINERAY\\joao.silva',
  serialNumber: 'Default string',
  os: { name: 'Microsoft Windows 11 Pro', build: '22631', lastBoot: '2026-10-20T08:00:00Z' },
  hardware: { manufacturer: 'To Be Filled By O.E.M.', processor: 'Intel Core i5-10400', ramGb: 16, pc_system_type: 1 },
  network: [{ name: 'Ethernet', mac: 'aa:bb:cc:00:00:01', ip: '10.20.1.15', gateway: '10.20.1.1' }],
  volumes: [{ drive: 'C:', sizeGb: 237.9, freeGb: 120.4, encrypted: false }],
  security: { antivirus: [{ name: 'Windows Defender', enabled: true, upToDate: true }], firewall: 'Domain, Private, Public', localAdmins: ['Administrador', 'SHINERAY\\joao.silva'], lastUpdate: '2026-10-01T00:00:00Z' },
  software: [{ name: 'Google Chrome', version: '130' }, { name: 'Microsoft Office Professional Plus 2019', version: '16' }],
  ...extra,
});

describe('fabricante', () => {
  it('limpa o nome juridico e ignora placa generica', () => {
    expect(vendorName('SAMSUNG ELECTRONICS CO., LTD.')).toBe('Samsung');
    expect(vendorName('Dell Inc.')).toBe('Dell');
    expect(vendorName('Hewlett-Packard')).toBe('HP');
    expect(vendorName('Positivo Tecnologia SA')).toBe('Positivo');
    expect(vendorName('Contoso Systems Inc.')).toBe('Contoso Systems');
    expect(vendorName('To Be Filled By O.E.M.')).toBe('');
  });

  it('tela integrada do notebook nao conta como monitor', () => {
    const inv = normalizeInventory({ monitors: [{ manufacturer: 'KDB', model: '', serial: '0' }, { manufacturer: 'DEL', model: 'DELL P2422H', serial: 'CN0ABC123' }] });
    expect(inv.monitors).toEqual([{ manufacturer: 'DEL', model: 'DELL P2422H', serial: 'CN0ABC123' }]);
  });
});

describe('identificadores de fabrica', () => {
  it('descarta textos genericos de placas montadas', () => {
    ['Default string', 'To Be Filled By O.E.M.', 'System Serial Number', '0000000000', 'FFFFFFFF', 'N/A', '', '123456789', '03000200-0400-0500-0006-000700080009']
      .forEach((value) => expect(isUsableId(value), value).toBe(false));
    expect(isUsableId('5CG1234XYZ')).toBe(true);
    expect(isUsableId('VMware-56 4d 12 34')).toBe(true);
  });
});

describe('normalizeInventory', () => {
  it('entende o payload 2.x e ignora serial generico', () => {
    const inv = normalizeInventory(v2());
    expect(inv.serialNumber).toBe('');
    expect(inv.deviceId).toBe('6f1c2a3b-1111-2222-3333-444455556666');
    expect(inv.ip).toBe('10.20.1.15');
    expect(inv.mac).toBe('AA:BB:CC:00:00:01');
    expect(inv.type).toBe('Computador');
    expect(inv.software[0].name).toBe('Google Chrome');
  });

  it('continua aceitando o formato 1.x (campos em portugues e listas com ||)', () => {
    const inv = normalizeInventory({
      hostname: 'PC-01', usuario_logado: 'maria', sistema_operacional: 'Windows 10 Pro', ip_address: '192.168.0.5',
      software: 'Chrome||Office||Chrome', monitors: 'Dell P2219H',
      security: { antivirus: 'Nenhum detectado', firewall: 'Desativado' },
      hardware: { bios_serial: 'ABC12345', processador: 'i3', ram_gb: 8, chassis_types: '|10' },
    });
    expect(inv).toMatchObject({ hostname: 'PC-01', loggedUser: 'maria', serialNumber: 'ABC12345', ip: '192.168.0.5', type: 'Notebook' });
    expect(inv.software.map((s) => s.name)).toEqual(['Chrome', 'Office']);
    expect(inv.security.antivirus).toEqual([]);
  });

  it('nao registra SYSTEM nem conta de maquina como usuario', () => {
    expect(normalizeInventory({ usuario_logado: 'SYSTEM' }).loggedUser).toBe('');
    expect(normalizeInventory({ usuario_logado: 'PDV01$' }).loggedUser).toBe('');
  });

  it('infere servidor pelo sistema e notebook pela bateria', () => {
    expect(inferAssetType({ os: { name: 'Windows Server 2022 Standard' } })).toBe('Servidor');
    expect(inferAssetType({ battery: { designCapacity: 45000 } })).toBe('Notebook');
  });
});

describe('findAgentAsset', () => {
  const assets = [
    { id: 'a1', internalId: 'SHL-BEL-CPU-001', serialNumber: 'Default string', agent: { deviceId: '6f1c2a3b-1111-2222-3333-444455556666', mac: 'AA:BB:CC:00:00:01', hostname: 'LOJA-CAST-PDV01' } },
    { id: 'a2', internalId: 'SHL-BEL-NTB-002', serialNumber: '5CG1234XYZ' },
  ];

  it('acha pela identidade do dispositivo', () => {
    expect(findAgentAsset(normalizeInventory(v2()), assets)).toMatchObject({ asset: { id: 'a1' }, matchField: 'deviceId' });
  });

  it('NAO funde dois PCs genericos com o mesmo "Default string"', () => {
    const other = normalizeInventory(v2({ deviceId: '99999999-aaaa-bbbb-cccc-000000000000', hostname: 'LOJA-ANAN-PDV02', network: [{ mac: 'AA:BB:CC:00:00:99', ip: '10.30.1.9', gateway: '10.30.1.1' }] }));
    expect(findAgentAsset(other, assets)).toBeNull();
  });

  it('imagem clonada (mesmo MachineGuid) com MAC diferente vira outro ativo', () => {
    const clone = normalizeInventory(v2({ network: [{ mac: 'AA:BB:CC:00:00:77', ip: '10.20.1.16', gateway: '10.20.1.1' }] }));
    expect(findAgentAsset(clone, assets)).toBeNull();
  });

  it('hostname no padrao de patrimonio identifica a maquina', () => {
    expect(hostnameAssetTag('shl-bel-ntb-001')).toBe('SHL-BEL-NTB-001');
    expect(hostnameAssetTag('DESKTOP-7F3K2LQ')).toBe('');
    expect(hostnameAssetTag('LOJA-CAST-PDV01')).toBe('');
    const tagged = [{ id: 'n1', internalId: 'SHL-BEL-NTB-001', serialNumber: '' }];
    expect(findAgentAsset(normalizeInventory({ hostname: 'SHL-BEL-NTB-001', deviceId: 'GUID-NOVO-1234' }), tagged)).toMatchObject({ asset: { id: 'n1' }, matchField: 'hostname' });
  });

  it('maquina substituta que herdou o hostname NAO assume o ativo antigo', () => {
    const old = [{ id: 'n1', internalId: 'SHL-BEL-NTB-001', serialNumber: 'Default string', agent: { deviceId: 'GUID-ANTIGO-9999' } }];
    expect(findAgentAsset(normalizeInventory({ hostname: 'SHL-BEL-NTB-001', deviceId: 'GUID-NOVO-1234' }), old)).toBeNull();
  });

  it('usa patrimonio gravado na BIOS e serial util', () => {
    expect(findAgentAsset(normalizeInventory({ assetTag: 'shl-bel-ntb-002' }), assets)).toMatchObject({ asset: { id: 'a2' }, matchField: 'internalId' });
    expect(findAgentAsset(normalizeInventory({ serialNumber: '5CG1234XYZ' }), assets)).toMatchObject({ asset: { id: 'a2' }, matchField: 'serialNumber' });
  });
});

describe('diffInventory', () => {
  it('aponta troca de hardware, sistema e programas', () => {
    const before = normalizeInventory(v2());
    const after = normalizeInventory(v2({
      hardware: { processor: 'Intel Core i5-10400', ramGb: 8 },
      os: { name: 'Microsoft Windows 11 Pro', build: '26100' },
      software: [{ name: 'Google Chrome' }, { name: 'uTorrent' }],
    }));
    const changes = diffInventory(before, after);
    expect(changes.map((c) => c.label)).toEqual(expect.arrayContaining(['Memória RAM', 'Sistema operacional', '1 programa(s) instalado(s)', '1 programa(s) removido(s)']));
    expect(changes.find((c) => c.label === 'Memória RAM')).toMatchObject({ from: '16 GB', to: '8 GB' });
  });

  it('primeira coleta nao gera mudancas', () => {
    expect(diffInventory(null, normalizeInventory(v2()))).toEqual([]);
  });
});

describe('rede e colaborador', () => {
  it('entende CIDR, prefixo e IP exato', () => {
    expect(ipInNetwork('10.20.1.15', '10.20.1.0/24')).toBe(true);
    expect(ipInNetwork('10.20.2.15', '10.20.1.0/24')).toBe(false);
    expect(ipInNetwork('192.168.0.9', '192.168.0.')).toBe(true);
    expect(ipInNetwork('172.16.5.4', '172.16.0.0/12')).toBe(true);
    expect(ipInNetwork('lixo', '10.0.0.0/8')).toBe(false);
  });

  it('escolhe a faixa mais especifica', () => {
    const locations = [{ name: 'Matriz', networks: '10.0.0.0/8' }, { name: 'Loja Castanhal', networks: '10.20.1.0/24' }];
    expect(locationForIp('10.20.1.15', locations).name).toBe('Loja Castanhal');
    expect(locationForIp('10.9.9.9', locations).name).toBe('Matriz');
    expect(locationForIp('192.168.1.1', locations)).toBeNull();
  });

  it('casa login com colaborador por login, e-mail ou nome', () => {
    const employees = [
      { id: 'e1', name: 'João da Silva', email: 'joao.silva@shineray.com.br' },
      { id: 'e2', name: 'Maria Souza', login: 'msouza' },
      { id: 'e3', name: 'Ana Lima' },
      { id: 'e4', name: 'Ana Lopes' },
    ];
    expect(normalizeLogin('SHINERAY\\Joao.Silva')).toBe('joao.silva');
    expect(matchEmployeeByLogin('SHINERAY\\joao.silva', employees)?.id).toBe('e1');
    expect(matchEmployeeByLogin('msouza', employees)?.id).toBe('e2');
    expect(matchEmployeeByLogin('alima', employees)?.id).toBe('e3');
    // ambiguo: nao chuta
    expect(matchEmployeeByLogin('ana', employees)).toBeNull();
  });
});

describe('alertas', () => {
  const policy = resolveAgentPolicy({ agentPolicy: { blockedSoftware: 'utorrent\n*crack*', requiredSoftware: 'Kaspersky', diskFreeMinPct: 10 } });
  const now = new Date('2026-10-21T12:00:00Z');

  it('software proibido (palavra inteira), obrigatorio ausente e admin local', () => {
    const inv = normalizeInventory(v2({ software: [{ name: 'uTorrent 3.6' }, { name: 'Office Crack Tool' }, { name: 'Google Chrome' }] }));
    const codes = evaluateAgentAlerts({ inventory: inv, policy, now }).map((a) => a.code);
    expect(codes).toEqual(expect.arrayContaining(['blocked_software', 'required_missing', 'user_is_admin']));
    expect(softwareMatches('LibreOffice 7', 'office')).toBe(false);
    expect(softwareMatches('Microsoft Office 2019', 'office')).toBe(true);
  });

  it('seguranca: antivirus desligado, disco cheio, sistema sem suporte', () => {
    const inv = normalizeInventory(v2({
      os: { name: 'Microsoft Windows 7 Professional', lastBoot: '2026-08-01T00:00:00Z' },
      security: { antivirus: [{ name: 'Avast', enabled: false }], firewall: 'Desativado', lastUpdate: '2026-01-01T00:00:00Z' },
      volumes: [{ drive: 'C:', sizeGb: 100, freeGb: 3 }],
    }));
    const alerts = evaluateAgentAlerts({ inventory: inv, policy, now });
    const codes = alerts.map((a) => a.code);
    expect(codes).toEqual(expect.arrayContaining(['av_missing', 'firewall_off', 'disk_full', 'updates_stale', 'os_unsupported', 'uptime_long']));
    expect(alerts[0].level).toBe('high');
  });

  it('local e responsavel divergentes viram sugestao; ativo baixado que reaparece e critico', () => {
    const inv = normalizeInventory(v2());
    const asset = { status: 'Baixado', location: 'Matriz - Belém', assignedTo: 'Carlos' };
    const alerts = evaluateAgentAlerts({
      inventory: inv, asset, now, policy: resolveAgentPolicy({}),
      locations: [{ name: 'Loja Castanhal', networks: '10.20.1.0/24' }],
      employees: [{ id: 'e1', name: 'João da Silva', email: 'joao.silva@x.com' }],
    });
    expect(alerts.find((a) => a.code === 'location_mismatch')?.data).toEqual({ suggested: 'Loja Castanhal' });
    expect(alerts.find((a) => a.code === 'user_mismatch')?.data).toMatchObject({ suggested: 'João da Silva' });
    expect(alerts[0].code).toBe('retired_reporting');
  });

  it('em transito nao acusa local divergente', () => {
    const inv = normalizeInventory(v2());
    const alerts = evaluateAgentAlerts({ inventory: inv, asset: { location: 'Matriz', transit: { termId: 't' } }, locations: [{ name: 'Loja', networks: '10.20.1.0/24' }], now });
    expect(alerts.some((a) => a.code === 'location_mismatch')).toBe(false);
  });
});

describe('licencas e frota', () => {
  it('atribui pelo software instalado e libera so o que o agente atribuiu', () => {
    const licenses = [
      { id: 'l1', softwareName: 'Microsoft Office', totalSeats: 5, assignedAssets: [] },
      { id: 'l2', softwareName: 'AutoCAD', totalSeats: 5, assignedAssets: [{ id: 'a1', source: 'agent' }] },
      { id: 'l3', softwareName: 'Photoshop', totalSeats: 5, assignedAssets: [{ id: 'a1' }] },
      { id: 'l4', softwareName: 'Office', totalSeats: 1, assignedAssets: [{ id: 'outro' }] },
    ];
    const { assign, release } = reconcileLicenses(licenses, [{ name: 'Microsoft Office Professional 2019' }], 'a1');
    expect(assign.map((l) => l.id)).toEqual(['l1']);
    expect(release.map((l) => l.id)).toEqual(['l2']);
  });

  it('resume a frota: online, sem comunicacao, alertas e sem agente', () => {
    const now = new Date('2026-10-21T12:00:00Z');
    const assets = [
      { type: 'Notebook', agent: { lastSeenAt: new Date('2026-10-21T08:00:00Z'), alerts: [{ level: 'high' }] } },
      { type: 'Computador', agent: { lastSeenAt: new Date('2026-09-01T08:00:00Z'), alerts: [] } },
      { type: 'Computador' },
      { type: 'Monitor' },
      { type: 'Computador', status: 'Baixado' },
    ];
    const isRetired = (s) => s === 'Baixado';
    expect(summarizeFleet(assets, { now, isRetired })).toEqual({ managed: 2, online24h: 1, stale: 1, withAlerts: 1, critical: 1, uncovered: 1 });
    expect(agentHealth(assets[1], { now }).state).toBe('stale');
    expect(agentHealth(assets[2], { now }).state).toBe('never');
  });
});
