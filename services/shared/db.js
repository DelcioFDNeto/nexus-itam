// services/shared/db.js
// =============================================================================
// Camada de Persistência Multi-Schema Resiliente — Nexus ITAM v3.0
// =============================================================================
// Opera nativamente contra PostgreSQL 16 (`DATABASE_URL`) com queries SQL
// parametrizadas ($1, $2...) em schemas isolados por microsserviço
// (`auth_svc`, `assets_svc`, `tickets_svc`, `compliance_svc`, `telemetry_svc`).
// Possui fallback transacional em memória (`NEXUS_DB_MODE=memory` ou ausência
// de `DATABASE_URL`) para execução instantânea de suítes de testes e demos locais.
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  GENESIS_HASH,
  computeAuditChainHash,
  computeTermDocumentHash,
  hashAgentToken,
  hashPassword,
  signResponsibilityTerm,
  verifyAgentToken,
} from './security.js';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const USE_PG =
  Boolean(process.env.DATABASE_URL) && process.env.NEXUS_DB_MODE !== 'memory';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (val) => UUID_RE.test(String(val || '').trim());

const toIso = (val) => {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  return String(val);
};

const cleanIp = (raw, fallback = '127.0.0.1') => {
  const first = String(raw || fallback).split(',')[0].trim();
  return (first || fallback).slice(0, 64);
};

export const canonicalTenantId = (raw) => {
  const t = String(raw || '').trim().toLowerCase();
  if (t === 'shineray' || t === 'shineray-by-sabel') return 'tenant-ap3htf6';
  return raw;
};

export const matchTenant = (itemTenant, requestedTenant) => {
  if (itemTenant === requestedTenant) return true;
  if (!itemTenant || !requestedTenant) return false;
  const c1 = canonicalTenantId(itemTenant);
  const c2 = canonicalTenantId(requestedTenant);
  return c1 === c2;
};

// Normalizadores de linha garantem paridade 100% exata entre `node-pg`
// (TIMESTAMPTZ -> Date, NUMERIC/BIGSERIAL -> string) e modo em memória.
const normalizeTenantRow = (r) =>
  r
    ? {
        ...r,
        created_at: toIso(r.created_at),
      }
    : null;

const normalizeUserRow = (r) =>
  r
    ? {
        ...r,
        created_at: toIso(r.created_at),
      }
    : null;

const normalizeAssetRow = (r) =>
  r
    ? {
        ...r,
        purchase_value: Number(r.purchase_value ?? 0),
        specs: r.specs && typeof r.specs === 'object' ? r.specs : {},
        created_at: toIso(r.created_at),
        updated_at: toIso(r.updated_at),
      }
    : null;

const normalizeHistoryRow = (r) =>
  r
    ? {
        ...r,
        created_at: toIso(r.created_at),
      }
    : null;

const normalizeTicketRow = (r) => {
  if (!r) return null;
  const out = {
    ...r,
    sla_due_at: toIso(r.sla_due_at),
    resolved_at: toIso(r.resolved_at),
    created_at: toIso(r.created_at),
    updated_at: toIso(r.updated_at),
  };
  if (r.comments_count !== undefined) {
    out.comments_count = Number(r.comments_count);
  }
  return out;
};

const normalizeCommentRow = (r) =>
  r
    ? {
        ...r,
        created_at: toIso(r.created_at),
      }
    : null;

const normalizeTermRow = (r) =>
  r
    ? {
        ...r,
        assets_snapshot: Array.isArray(r.assets_snapshot) ? r.assets_snapshot : [],
        signed_at: toIso(r.signed_at),
        created_at: toIso(r.created_at),
      }
    : null;

const normalizeAuditRow = (r) =>
  r
    ? {
        ...r,
        seq: Number(r.seq),
        payload: r.payload && typeof r.payload === 'object' ? r.payload : {},
        created_at: toIso(r.created_at),
      }
    : null;

const normalizeTelemetryRow = (r) =>
  r
    ? {
        ...r,
        cpu_percent: Number(r.cpu_percent ?? 0),
        ram_percent: Number(r.ram_percent ?? 0),
        disk_percent: Number(r.disk_percent ?? 0),
        last_seen_at: toIso(r.last_seen_at),
      }
    : null;

const normalizeCommandRow = (r) =>
  r
    ? {
        ...r,
        created_at: toIso(r.created_at),
      }
    : null;

let pool = null;
let initialized = false;

export const SHINERAY_AGENT_TOKEN = 'agt_shineray_2026_v3_secure_token';
export const DEFAULT_DEMO_AGENT_TOKEN = SHINERAY_AGENT_TOKEN;

// =============================================================================
// Estado em Memória (Fallback Determinístico / Suíte de Testes)
// =============================================================================
const mem = {
  tenants: [],
  users: [],
  assets: [],
  assetHistory: [],
  tickets: [],
  ticketComments: [],
  terms: [],
  auditChain: [],
  telemetry: [],
  remoteCommands: [],
  seqCounter: 0,
};

function buildSeedBundle() {
  const nowIso = new Date().toISOString();
  const yesterdayIso = new Date(Date.now() - 86_400_000).toISOString();
  const twoHoursAgoIso = new Date(Date.now() - 7_200_000).toISOString();

  const tenants = [
    {
      id: 'tenant-ap3htf6',
      name: 'Shineray By Sabel',
      cnpj: '14.412.308/0001-90',
      plan: 'enterprise',
      asset_prefix: 'SHL',
      agent_token_hash: hashAgentToken('agt_shineray_2026_v3_secure_token'),
      status: 'active',
      created_at: yesterdayIso,
    },
    {
      id: 'shineray',
      name: 'Shineray By Sabel',
      cnpj: '14.412.308/0001-90',
      plan: 'enterprise',
      asset_prefix: 'SHL',
      agent_token_hash: hashAgentToken('agt_shineray_2026_v3_secure_token'),
      status: 'active',
      created_at: yesterdayIso,
    },
  ];

  const users = [
    {
      id: '33333333-3333-4333-8333-333333333301',
      tenant_id: 'tenant-ap3htf6',
      name: 'TI & Gestão Shineray',
      email: 'ti@shineraybysabel.com.br',
      password_hash: hashPassword('Shineray@2026!'),
      role: 'owner',
      department: 'Tecnologia & Operações',
      job_title: 'Dono & Gestor de TI',
      active: true,
      created_at: yesterdayIso,
    },
    {
      id: '33333333-3333-4333-8333-333333333302',
      tenant_id: 'tenant-ap3htf6',
      name: 'João da Silva',
      email: 'joao.silva@shineray.com.br',
      password_hash: hashPassword('Colab@2026!'),
      role: 'collaborator',
      department: 'Vendas Concessionária',
      job_title: 'Consultor de Vendas',
      active: true,
      created_at: yesterdayIso,
    },
    {
      id: '33333333-3333-4333-8333-333333333303',
      tenant_id: 'tenant-ap3htf6',
      name: 'Délcio Farias',
      email: 'delcio.farias@shineraybysabel.com.br',
      password_hash: hashPassword('Nexus@2026!'),
      role: 'manager',
      department: 'TI & Operações',
      job_title: 'Gestor de TI & Sistemas',
      active: true,
      created_at: yesterdayIso,
    },
    {
      id: '33333333-3333-4333-8333-333333333304',
      tenant_id: 'tenant-ap3htf6',
      name: 'Karen Matos',
      email: 'karen.matos@shineraybysabel.com.br',
      password_hash: hashPassword('Colab@2026!'),
      role: 'collaborator',
      department: 'Vendas & Pós-Vendas',
      job_title: 'Consultora Comercial',
      active: true,
      created_at: yesterdayIso,
    },
  ];

  const assets = [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05',
      tenant_id: 'tenant-ap3htf6',
      internal_id: 'SHL-BEL-NTB-001',
      type: 'Notebook',
      brand: 'Samsung',
      model: 'Galaxy Book 2 Core i5',
      serial_number: 'NP550XED-KF2BR',
      status: 'Em Uso',
      location: 'Matriz Belém - TI',
      department: 'TI & Infraestrutura',
      assigned_to_name: 'Délcio Farias Dias Neto',
      assigned_to_email: 'delcio.farias@shineraybysabel.com.br',
      purchase_value: 4890.0,
      specs: {
        cpu: 'Intel Core i5-1235U',
        ram: '16 GB DDR4',
        storage: '512 GB NVMe SSD',
        os: 'Windows 11 Pro 24H2',
      },
      created_at: yesterdayIso,
      updated_at: twoHoursAgoIso,
    },
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06',
      tenant_id: 'tenant-ap3htf6',
      internal_id: 'SHL-BEL-NTB-016',
      type: 'Notebook',
      brand: 'Lenovo',
      model: 'Lenovo V15 G3 Core i7',
      serial_number: 'PF3Z881K',
      status: 'Em Uso',
      location: 'Matriz Belém - TI',
      department: 'Tecnologia & Operações',
      assigned_to_name: 'TI & Gestão Shineray',
      assigned_to_email: 'ti@shineraybysabel.com.br',
      purchase_value: 5490.0,
      specs: {
        cpu: 'Intel Core i7-1255U',
        ram: '16 GB DDR4',
        storage: '512 GB SSD',
        os: 'Windows 11 Pro',
      },
      created_at: yesterdayIso,
      updated_at: twoHoursAgoIso,
    },
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa07',
      tenant_id: 'tenant-ap3htf6',
      internal_id: 'SHL-BEL-NTB-007',
      type: 'Notebook',
      brand: 'Dell',
      model: 'Inspiron 15 3567 Core i5',
      serial_number: '8XYZ123',
      status: 'Em Uso',
      location: 'Matriz Belém - Comercial',
      department: 'Vendas & Pós-Vendas',
      assigned_to_name: 'Karen Matos',
      assigned_to_email: 'karen.matos@shineraybysabel.com.br',
      purchase_value: 3890.0,
      specs: {
        cpu: 'Intel Core i5-7200U',
        ram: '8 GB DDR4',
        storage: '256 GB SSD',
        os: 'Windows 11 Pro',
      },
      created_at: yesterdayIso,
      updated_at: twoHoursAgoIso,
    },
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa08',
      tenant_id: 'tenant-ap3htf6',
      internal_id: 'SHL-BEL-CEL-003',
      type: 'Smartphone',
      brand: 'Xiaomi',
      model: 'Redmi Note 13 128GB',
      serial_number: 'XM-RNOTE13-8812',
      status: 'Em Uso',
      location: 'Matriz Belém - Salão de Vendas',
      department: 'Vendas & Pós-Vendas',
      assigned_to_name: 'Karen Matos',
      assigned_to_email: 'karen.matos@shineraybysabel.com.br',
      purchase_value: 1399.0,
      specs: {
        storage: '128 GB',
        ram: '6 GB',
        os: 'Android 14 HyperOS',
        imei: '864920059128371',
      },
      created_at: yesterdayIso,
      updated_at: twoHoursAgoIso,
    },
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa09',
      tenant_id: 'tenant-ap3htf6',
      internal_id: 'SHL-BEL-PGT-004',
      type: 'PGT',
      brand: 'Rede Verifone',
      model: 'Laranjinha L400',
      serial_number: 'VERI-400-9921',
      status: 'Em Uso',
      location: 'Matriz Belém - TI & Operações',
      department: 'TI & Infraestrutura',
      assigned_to_name: 'Délcio Farias Dias Neto',
      assigned_to_email: 'delcio.farias@shineraybysabel.com.br',
      purchase_value: 850.0,
      specs: {
        connectivity: '4G + Wi-Fi',
        protocol: 'POS EMV Chip & Contactless',
      },
      created_at: yesterdayIso,
      updated_at: twoHoursAgoIso,
    },
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10',
      tenant_id: 'tenant-ap3htf6',
      internal_id: 'SHL-BEL-NTB-002',
      type: 'Notebook',
      brand: 'Lenovo',
      model: 'IdeaPad 3 Core i3',
      serial_number: 'PF2K884X',
      status: 'Em Uso',
      location: 'Matriz Belém - Showroom',
      department: 'Vendas Concessionária',
      assigned_to_name: 'João da Silva',
      assigned_to_email: 'joao.silva@shineray.com.br',
      purchase_value: 3200.0,
      specs: {
        cpu: 'Intel Core i3-1115G4',
        ram: '8 GB DDR4',
        storage: '256 GB SSD',
        os: 'Windows 11 Home',
      },
      created_at: yesterdayIso,
      updated_at: twoHoursAgoIso,
    },
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11',
      tenant_id: 'tenant-ap3htf6',
      internal_id: 'SHL-BEL-NTB-003',
      type: 'Notebook',
      brand: 'Dell',
      model: 'Latitude 3420 Core i5',
      serial_number: '8XYZ124',
      status: 'Disponível',
      location: 'Matriz Belém - TI',
      department: 'Estoque TI',
      assigned_to_name: null,
      assigned_to_email: null,
      purchase_value: 4690.0,
      specs: {
        cpu: 'Intel Core i5-1135G7',
        ram: '16 GB DDR4',
        storage: '512 GB SSD',
        os: 'Windows 11 Pro 24H2',
      },
      created_at: yesterdayIso,
      updated_at: yesterdayIso,
    },
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12',
      tenant_id: 'tenant-ap3htf6',
      internal_id: 'SHL-BEL-MON-001',
      type: 'Monitor',
      brand: 'Dell',
      model: 'Dell Professional P2422H 24"',
      serial_number: 'CN0M719Q881',
      status: 'Em Uso',
      location: 'Matriz Belém - Comercial',
      department: 'Vendas & Pós-Vendas',
      assigned_to_name: 'Karen Matos',
      assigned_to_email: 'karen.matos@shineraybysabel.com.br',
      purchase_value: 1290.0,
      specs: {
        panel: 'IPS FHD 1920x1080 60Hz',
        ports: 'HDMI 1.4, DP 1.2, VGA, USB 3.2 Hub',
      },
      created_at: yesterdayIso,
      updated_at: twoHoursAgoIso,
    },
  ];

  const legalClauseSigned =
    'Declaro, nos termos do Art. 462 §1º da CLT e da Política de Segurança da Informação Corporativa, ter recebido em perfeito estado de funcionamento o equipamento listado, comprometendo-me com sua guarda, conservação e uso estritamente profissional.';

  const signedAssets = [
    { internalId: 'SHL-BEL-NTB-007', model: 'Dell Inspiron 15 3567 Core i5', serialNumber: '8XYZ123' },
  ];
  const signedDocHash = computeTermDocumentHash({
    tenantId: 'tenant-ap3htf6',
    termType: 'entrega',
    employeeEmail: 'karen.matos@shineraybysabel.com.br',
    assetsSnapshot: signedAssets,
    legalClause: legalClauseSigned,
  });
  const signedTermId = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
  const signedAtIso = yesterdayIso;
  const sigHash = signResponsibilityTerm({
    termId: signedTermId,
    tenantId: 'tenant-ap3htf6',
    employeeEmail: 'karen.matos@shineraybysabel.com.br',
    documentHash: signedDocHash,
    signedAt: signedAtIso,
  });

  const pendingAssets = [
    { internalId: 'SHL-BEL-NTB-002', model: 'Lenovo IdeaPad 3 Core i3', serialNumber: 'PF2K884X' },
  ];
  const pendingDocHash = computeTermDocumentHash({
    tenantId: 'tenant-ap3htf6',
    termType: 'entrega',
    employeeEmail: 'joao.silva@shineray.com.br',
    assetsSnapshot: pendingAssets,
    legalClause: legalClauseSigned,
  });

  const terms = [
    {
      id: signedTermId,
      tenant_id: 'tenant-ap3htf6',
      term_type: 'entrega',
      employee_name: 'Karen Matos',
      employee_email: 'karen.matos@shineraybysabel.com.br',
      employee_cpf: '***.482.910-**',
      department: 'Vendas & Pós-Vendas',
      assets_snapshot: signedAssets,
      legal_clause: legalClauseSigned,
      status: 'signed',
      document_hash: signedDocHash,
      signature_hash: sigHash,
      signer_ip: '10.24.0.18',
      signer_user_agent: 'NexusSelfService/3.0 (Vue 3)',
      issued_by: 'TI & Gestão Shineray',
      signed_at: signedAtIso,
      created_at: yesterdayIso,
    },
    {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc02',
      tenant_id: 'tenant-ap3htf6',
      term_type: 'entrega',
      employee_name: 'João da Silva',
      employee_email: 'joao.silva@shineray.com.br',
      employee_cpf: '***.719.340-**',
      department: 'Vendas Concessionária',
      assets_snapshot: pendingAssets,
      legal_clause: legalClauseSigned,
      status: 'pending',
      document_hash: pendingDocHash,
      signature_hash: null,
      signer_ip: null,
      signer_user_agent: null,
      issued_by: 'Admin Shineray',
      signed_at: null,
      created_at: twoHoursAgoIso,
    },
  ];

  const tickets = [
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01',
      protocol: 'CHM-2026-0500',
      tenant_id: 'tenant-ap3htf6',
      requester_name: 'TI & Gestão Shineray',
      requester_email: 'ti@shineraybysabel.com.br',
      department: 'Tecnologia & Operações',
      asset_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06',
      asset_tag: 'SHL-BEL-NTB-016',
      category: 'Software & Acesso VPN',
      priority: 'high',
      status: 'in_progress',
      title: 'Renovação de certificado VPN WireGuard e link Matriz-Filiais',
      description:
        'Túnel de comunicação criptografado entre as concessionárias e Matriz requer renovação de chaves.',
      assigned_tech_name: 'Admin Shineray',
      resolution_notes: null,
      sla_due_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
      resolved_at: null,
      created_at: twoHoursAgoIso,
      updated_at: nowIso,
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02',
      protocol: 'CHM-2026-0501',
      tenant_id: 'tenant-ap3htf6',
      requester_name: 'TI & Gestão Shineray',
      requester_email: 'ti@shineraybysabel.com.br',
      department: 'Tecnologia & Operações',
      asset_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06',
      asset_tag: 'SHL-BEL-NTB-016',
      category: 'Hardware & Sistema',
      priority: 'high',
      status: 'in_progress',
      title: 'Upgrade de Sistema Operacional Windows 11 e lentidão no ERP Microwork',
      description:
        'Notebook Lenovo V15 (SHL-BEL-NTB-016) necessita de atualização do SO para Windows 11 Pro e otimização de performance para emissão de relatórios no ERP Microwork.',
      assigned_tech_name: 'Délcio Farias',
      resolution_notes: null,
      sla_due_at: new Date(Date.now() + 4 * 3_600_000).toISOString(),
      resolved_at: null,
      created_at: twoHoursAgoIso,
      updated_at: nowIso,
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03',
      protocol: 'CHM-2026-0502',
      tenant_id: 'tenant-ap3htf6',
      requester_name: 'Karen Matos',
      requester_email: 'karen.matos@shineraybysabel.com.br',
      department: 'Vendas & Pós-Vendas',
      asset_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa08',
      asset_tag: 'SHL-BEL-CEL-003',
      category: 'Acessos & Softwares',
      priority: 'medium',
      status: 'resolved',
      title: 'Liberação de perfil no Microwork ERP para módulo de seminovos filial Ananindeua',
      description:
        'Solicitação de permissão no módulo de estoque de motocicletas seminovas para fechamento de vendas comerciais.',
      assigned_tech_name: 'Admin Shineray',
      resolution_notes:
        'Perfil concedido no grupo VENDAS_SEMINOVOS no ERP Microwork. Validação efetuada com a consultora.',
      sla_due_at: yesterdayIso,
      resolved_at: twoHoursAgoIso,
      created_at: yesterdayIso,
      updated_at: twoHoursAgoIso,
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb04',
      protocol: 'CHM-2026-0503',
      tenant_id: 'tenant-ap3htf6',
      requester_name: 'Délcio Farias',
      requester_email: 'delcio.farias@shineraybysabel.com.br',
      department: 'TI & Infraestrutura',
      asset_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05',
      asset_tag: 'SHL-BEL-NTB-001',
      category: 'Periféricos & Acessórios',
      priority: 'medium',
      status: 'open',
      title: 'Solicitação de fonte carregador 65W Tipo-C e limpeza preventiva de hardware',
      description:
        'Carregador adicional para atendimento externo e manutenção preventiva no notebook Samsung Galaxy Book 2.',
      assigned_tech_name: null,
      resolution_notes: null,
      sla_due_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
      resolved_at: null,
      created_at: nowIso,
      updated_at: nowIso,
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05',
      protocol: 'CHM-2026-0504',
      tenant_id: 'tenant-ap3htf6',
      requester_name: 'João da Silva',
      requester_email: 'joao.silva@shineray.com.br',
      department: 'Vendas Concessionária',
      asset_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10',
      asset_tag: 'SHL-BEL-NTB-002',
      category: 'Hardware & Manutenção',
      priority: 'low',
      status: 'open',
      title: 'Envio de suprimentos de toner e revisão de impressora para filial Barcarena',
      description:
        'Demanda operacional de envio de toner Brother e alinhamento de impressão na filial Barcarena.',
      assigned_tech_name: null,
      resolution_notes: null,
      sla_due_at: new Date(Date.now() + 48 * 3_600_000).toISOString(),
      resolved_at: null,
      created_at: nowIso,
      updated_at: nowIso,
    },
  ];

  const ticketComments = [
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
      ticket_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01',
      tenant_id: 'tenant-ap3htf6',
      author_name: 'Admin Shineray',
      author_email: 'ti@shineraybysabel.com.br',
      author_role: 'admin',
      message:
        'Recebido pela equipe de infraestrutura Shineray. Validação de rotas e segurança em andamento.',
      created_at: nowIso,
    },
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd02',
      ticket_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02',
      tenant_id: 'tenant-ap3htf6',
      author_name: 'Délcio Farias',
      author_email: 'delcio.farias@shineraybysabel.com.br',
      author_role: 'manager',
      message:
        'Chamado assumido pela equipe técnica de TI Shineray By Sabel. Agendamos a troca da pasta térmica e limpeza física para o final do expediente hoje.',
      created_at: nowIso,
    },
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd03',
      ticket_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03',
      tenant_id: 'tenant-ap3htf6',
      author_name: 'Admin Shineray',
      author_email: 'ti@shineraybysabel.com.br',
      author_role: 'admin',
      message:
        'Acessos concedidos com sucesso e sincronizados com a filial Ananindeua.',
      created_at: twoHoursAgoIso,
    },
  ];

  const telemetry = [
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',
      tenant_id: 'tenant-ap3htf6',
      device_key: 'WKS-SHL-PF3Z881K',
      hostname: 'SHL-BEL-NTB-016',
      serial_number: 'PF3Z881K',
      os_version: 'Windows 11 Pro 24H2 (26100)',
      agent_version: '3.2.0',
      ip_address: '10.50.12.16',
      logged_user: 'SHINERAY\\ti',
      cpu_percent: 21.4,
      ram_percent: 54.0,
      disk_percent: 38.5,
      antivirus_active: true,
      firewall_active: true,
      last_seen_at: nowIso,
    },
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02',
      tenant_id: 'tenant-ap3htf6',
      device_key: 'WKS-SHL-NP550XED',
      hostname: 'SHL-BEL-NTB-001',
      serial_number: 'NP550XED-KF2BR',
      os_version: 'Windows 11 Pro 24H2 (26100)',
      agent_version: '3.2.0',
      ip_address: '10.50.12.10',
      logged_user: 'SHINERAY\\delcio.farias',
      cpu_percent: 17.5,
      ram_percent: 48.0,
      disk_percent: 32.1,
      antivirus_active: true,
      firewall_active: true,
      last_seen_at: nowIso,
    },
  ];

  const genesisPayload = { termId: signedTermId, tag: 'SHL-BEL-NTB-007' };
  const firstEntryHash = computeAuditChainHash({
    prevHash: GENESIS_HASH,
    tenantId: 'tenant-ap3htf6',
    actorEmail: 'karen.matos@shineraybysabel.com.br',
    actorRole: 'collaborator',
    action: 'TERM_SIGNED_HMAC',
    resourceType: 'responsibility_term',
    resourceId: signedTermId,
    payload: genesisPayload,
    createdAtIso: signedAtIso,
  });

  const auditChain = [
    {
      seq: 1,
      id: 'ffffffff-ffff-4fff-8fff-ffffffffff01',
      tenant_id: 'tenant-ap3htf6',
      actor_email: 'karen.matos@shineraybysabel.com.br',
      actor_role: 'collaborator',
      action: 'TERM_SIGNED_HMAC',
      resource_type: 'responsibility_term',
      resource_id: signedTermId,
      payload: genesisPayload,
      prev_hash: GENESIS_HASH,
      entry_hash: firstEntryHash,
      created_at: signedAtIso,
    },
  ];

  const assetHistory = [
    {
      id: '99999999-9999-4999-8999-999999999901',
      tenant_id: 'tenant-ap3htf6',
      asset_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06',
      action: 'CADASTRO_E_ALOCACAO',
      actor_name: 'Admin Shineray',
      actor_email: 'ti@shineraybysabel.com.br',
      details: 'Notebook Lenovo V15 cadastrado e alocado à Gestão & TI (ti@shineraybysabel.com.br).',
      created_at: yesterdayIso,
    },
  ];

  return {
    tenants,
    users,
    assets,
    assetHistory,
    tickets,
    ticketComments,
    terms,
    auditChain,
    telemetry,
  };
}

export function resetMemoryStoreWithSeed() {
  const seed = buildSeedBundle();
  mem.tenants = structuredClone(seed.tenants);
  mem.users = structuredClone(seed.users);
  mem.assets = structuredClone(seed.assets);
  mem.assetHistory = structuredClone(seed.assetHistory);
  mem.tickets = structuredClone(seed.tickets);
  mem.ticketComments = structuredClone(seed.ticketComments);
  mem.terms = structuredClone(seed.terms);
  mem.auditChain = structuredClone(seed.auditChain);
  mem.telemetry = structuredClone(seed.telemetry);
  mem.remoteCommands = [];
  mem.seqCounter = seed.auditChain.length;
}

/**
 * Reconcilia de forma idempotente volumes PostgreSQL já existentes caso tenham
 * sido criados antes da canonicalização de chaves `JSONB`, garantindo que
 * `verify-chain` e `terms/:id/verify` passem 100% sem perda de dados.
 */
async function reconcileCanonicalHashesIfNeeded(client) {
  const seedTermIds = [
    'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
    'cccccccc-cccc-4ccc-8ccc-cccccccccc02',
  ];
  const { rows: seedTerms } = await client.query(
    'SELECT * FROM compliance_svc.responsibility_terms WHERE id = ANY($1::uuid[])',
    [seedTermIds],
  );
  for (const tr of seedTerms) {
    const canonicalDocHash = computeTermDocumentHash({
      tenantId: tr.tenant_id,
      termType: tr.term_type,
      employeeEmail: tr.employee_email,
      assetsSnapshot: tr.assets_snapshot,
      legalClause: tr.legal_clause,
    });
    if (canonicalDocHash !== tr.document_hash) {
      const signedIso = toIso(tr.signed_at);
      const canonicalSig =
        tr.status === 'signed' && signedIso
          ? signResponsibilityTerm({
              termId: tr.id,
              tenantId: tr.tenant_id,
              employeeEmail: tr.employee_email,
              documentHash: canonicalDocHash,
              signedAt: signedIso,
            })
          : tr.signature_hash;
      await client.query(
        `UPDATE compliance_svc.responsibility_terms
         SET document_hash = $2, signature_hash = $3
         WHERE id = $1`,
        [tr.id, canonicalDocHash, canonicalSig],
      );
    }
  }

  // Reconcilia elos de auditoria cujo hash pré-canonicalização divergia após JSONB
  const { rows: genesisCheck } = await client.query(
    `SELECT * FROM compliance_svc.audit_chain
     WHERE id = 'ffffffff-ffff-4fff-8fff-ffffffffff01' LIMIT 1`,
  );
  if (genesisCheck[0]) {
    const g = genesisCheck[0];
    const expectedGenesisEntry = computeAuditChainHash({
      prevHash: g.prev_hash,
      tenantId: g.tenant_id,
      actorEmail: g.actor_email,
      actorRole: g.actor_role,
      action: g.action,
      resourceType: g.resource_type,
      resourceId: g.resource_id,
      payload: g.payload,
      createdAtIso: toIso(g.created_at),
    });
    if (expectedGenesisEntry !== g.entry_hash) {
      const { rows: chainRows } = await client.query(
        `SELECT * FROM compliance_svc.audit_chain
         WHERE tenant_id = $1 ORDER BY seq ASC FOR UPDATE`,
        [g.tenant_id],
      );
      let prev = GENESIS_HASH;
      for (const row of chainRows) {
        const nextHash = computeAuditChainHash({
          prevHash: prev,
          tenantId: row.tenant_id,
          actorEmail: row.actor_email,
          actorRole: row.actor_role,
          action: row.action,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          payload: row.payload,
          createdAtIso: toIso(row.created_at),
        });
        await client.query(
          'UPDATE compliance_svc.audit_chain SET prev_hash = $2, entry_hash = $3 WHERE seq = $1',
          [row.seq, prev, nextHash],
        );
        prev = nextHash;
      }
    }
  }
}

export async function initDatabase() {
  if (initialized) return { engine: USE_PG ? 'postgresql-16' : 'embedded-relational-memory' };

  if (!USE_PG) {
    resetMemoryStoreWithSeed();
    initialized = true;
    return { engine: 'embedded-relational-memory' };
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX || 12),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  });

  // Retry resiliente aguardando readiness do container PostgreSQL no Docker Compose
  let lastError = null;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, Math.min(1000 * attempt, 4000)));
    }
  }
  if (lastError) {
    throw new Error(`Falha ao conectar ao PostgreSQL: ${lastError.message}`);
  }

  // Lock distribuído PostgreSQL (pg_advisory_lock) impede race condition
  // quando os 5 microsserviços inicializam simultaneamente no Docker Compose.
  const bootClient = await pool.connect();
  try {
    await bootClient.query('SELECT pg_advisory_lock(88202603)');

    const sqlPath = path.join(__dirname, 'init.sql');
    if (fs.existsSync(sqlPath)) {
      const ddl = fs.readFileSync(sqlPath, 'utf8');
      await bootClient.query(ddl);
    }

    // Seed transacional atômico (verifica users para nunca deixar banco sem login)
    const { rows } = await bootClient.query('SELECT COUNT(*)::int AS total FROM auth_svc.users');
    if (rows[0].total === 0) {
      await bootClient.query('BEGIN');
      try {
        const seed = buildSeedBundle();
        for (const t of seed.tenants) {
          await bootClient.query(
            `INSERT INTO auth_svc.tenants (id, name, cnpj, plan, asset_prefix, agent_token_hash, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
            [t.id, t.name, t.cnpj, t.plan, t.asset_prefix, t.agent_token_hash, t.status, t.created_at],
          );
        }
        for (const u of seed.users) {
          await bootClient.query(
            `INSERT INTO auth_svc.users (id, tenant_id, name, email, password_hash, role, department, job_title, active, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (email) DO NOTHING`,
            [u.id, u.tenant_id, u.name, u.email, u.password_hash, u.role, u.department, u.job_title, u.active, u.created_at],
          );
        }
        for (const a of seed.assets) {
          await bootClient.query(
            `INSERT INTO assets_svc.assets
             (id, tenant_id, internal_id, type, brand, model, serial_number, status, location, department, assigned_to_name, assigned_to_email, purchase_value, specs, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)
             ON CONFLICT (tenant_id, internal_id) DO NOTHING`,
            [
              a.id, a.tenant_id, a.internal_id, a.type, a.brand, a.model, a.serial_number,
              a.status, a.location, a.department, a.assigned_to_name, a.assigned_to_email,
              a.purchase_value, JSON.stringify(a.specs), a.created_at, a.updated_at,
            ],
          );
        }
        for (const h of seed.assetHistory) {
          await bootClient.query(
            `INSERT INTO assets_svc.asset_history (id, tenant_id, asset_id, action, actor_name, actor_email, details, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
            [h.id, h.tenant_id, h.asset_id, h.action, h.actor_name, h.actor_email, h.details, h.created_at],
          );
        }
        for (const tk of seed.tickets) {
          await bootClient.query(
            `INSERT INTO tickets_svc.tickets
             (id, protocol, tenant_id, requester_name, requester_email, department, asset_id, asset_tag, category, priority, status, title, description, assigned_tech_name, resolution_notes, sla_due_at, resolved_at, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
             ON CONFLICT (protocol) DO NOTHING`,
            [
              tk.id, tk.protocol, tk.tenant_id, tk.requester_name, tk.requester_email, tk.department,
              tk.asset_id, tk.asset_tag, tk.category, tk.priority, tk.status, tk.title, tk.description,
              tk.assigned_tech_name, tk.resolution_notes, tk.sla_due_at, tk.resolved_at, tk.created_at, tk.updated_at,
            ],
          );
        }
        for (const cm of seed.ticketComments) {
          await bootClient.query(
            `INSERT INTO tickets_svc.ticket_comments (id, ticket_id, tenant_id, author_name, author_email, author_role, message, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
            [cm.id, cm.ticket_id, cm.tenant_id, cm.author_name, cm.author_email, cm.author_role, cm.message, cm.created_at],
          );
        }
        for (const tr of seed.terms) {
          await bootClient.query(
            `INSERT INTO compliance_svc.responsibility_terms
             (id, tenant_id, term_type, employee_name, employee_email, employee_cpf, department, assets_snapshot, legal_clause, status, document_hash, signature_hash, signer_ip, signer_user_agent, issued_by, signed_at, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             ON CONFLICT (id) DO NOTHING`,
            [
              tr.id, tr.tenant_id, tr.term_type, tr.employee_name, tr.employee_email, tr.employee_cpf,
              tr.department, JSON.stringify(tr.assets_snapshot), tr.legal_clause, tr.status,
              tr.document_hash, tr.signature_hash, tr.signer_ip, tr.signer_user_agent, tr.issued_by,
              tr.signed_at, tr.created_at,
            ],
          );
        }
        for (const ac of seed.auditChain) {
          await bootClient.query(
            `INSERT INTO compliance_svc.audit_chain
             (id, tenant_id, actor_email, actor_role, action, resource_type, resource_id, payload, prev_hash, entry_hash, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
             ON CONFLICT (id) DO NOTHING`,
            [
              ac.id, ac.tenant_id, ac.actor_email, ac.actor_role, ac.action,
              ac.resource_type, ac.resource_id, JSON.stringify(ac.payload), ac.prev_hash, ac.entry_hash, ac.created_at,
            ],
          );
        }
        for (const tl of seed.telemetry) {
          await bootClient.query(
            `INSERT INTO telemetry_svc.device_telemetry
             (id, tenant_id, device_key, hostname, serial_number, os_version, agent_version, ip_address, logged_user, cpu_percent, ram_percent, disk_percent, antivirus_active, firewall_active, last_seen_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             ON CONFLICT (tenant_id, device_key) DO NOTHING`,
            [
              tl.id, tl.tenant_id, tl.device_key, tl.hostname, tl.serial_number, tl.os_version,
              tl.agent_version, tl.ip_address, tl.logged_user, tl.cpu_percent, tl.ram_percent,
              tl.disk_percent, tl.antivirus_active, tl.firewall_active, tl.last_seen_at,
            ],
          );
        }
        await bootClient.query('COMMIT');
      } catch (seedErr) {
        await bootClient.query('ROLLBACK');
        throw seedErr;
      }
    } else {
      await bootClient.query('BEGIN');
      try {
        await reconcileCanonicalHashesIfNeeded(bootClient);
        await bootClient.query('COMMIT');
      } catch (recErr) {
        await bootClient.query('ROLLBACK');
        throw recErr;
      }
    }
  } finally {
    await bootClient.query('SELECT pg_advisory_unlock(88202603)').catch(() => {});
    bootClient.release();
  }

  initialized = true;
  return { engine: 'postgresql-16' };
}

export async function checkDbHealth() {
  const start = Date.now();
  if (!USE_PG) {
    return { status: 'healthy', engine: 'embedded-relational-memory', latencyMs: 1 };
  }
  try {
    await pool.query('SELECT 1');
    return { status: 'healthy', engine: 'postgresql-16', latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: 'unreachable',
      engine: 'postgresql-16',
      latencyMs: Date.now() - start,
      error: err.message,
    };
  }
}

export async function closeDatabase() {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
  }
  initialized = false;
}

// =============================================================================
// 1. Repositório de Identidade & Tenants (`auth_svc`)
// =============================================================================
export const authRepo = {
  async findUserByEmail(email) {
    const clean = String(email || '').toLowerCase().trim();
    if (!USE_PG) {
      const u = mem.users.find((x) => x.email.toLowerCase() === clean);
      if (!u) return null;
      const t = mem.tenants.find((x) => x.id === u.tenant_id);
      return {
        ...u,
        tenant_name: t?.name || u.tenant_id,
        tenant_status: t?.status || 'active',
        asset_prefix: t?.asset_prefix || 'NEX',
      };
    }
    const { rows } = await pool.query(
      `SELECT u.*, t.name AS tenant_name, t.status AS tenant_status, t.asset_prefix
       FROM auth_svc.users u
       JOIN auth_svc.tenants t ON t.id = u.tenant_id
       WHERE LOWER(u.email) = $1 LIMIT 1`,
      [clean],
    );
    return normalizeUserRow(rows[0]);
  },

  async findUserById(userId) {
    if (!USE_PG) {
      const u = mem.users.find((x) => x.id === userId);
      if (!u) return null;
      const t = mem.tenants.find((x) => x.id === u.tenant_id);
      return {
        ...u,
        tenant_name: t?.name || u.tenant_id,
        tenant_status: t?.status || 'active',
        asset_prefix: t?.asset_prefix || 'NEX',
      };
    }
    if (!isUuid(userId)) return null;
    const { rows } = await pool.query(
      `SELECT u.*, t.name AS tenant_name, t.status AS tenant_status, t.asset_prefix
       FROM auth_svc.users u
       JOIN auth_svc.tenants t ON t.id = u.tenant_id
       WHERE u.id = $1 LIMIT 1`,
      [userId],
    );
    return normalizeUserRow(rows[0]);
  },

  async findTenantById(tenantId) {
    if (!USE_PG) {
      return mem.tenants.find((t) => matchTenant(t.id, tenantId)) || null;
    }
    const clean = canonicalTenantId(tenantId);
    const { rows } = await pool.query('SELECT * FROM auth_svc.tenants WHERE id = $1 OR id = $2 LIMIT 1', [tenantId, clean]);
    return normalizeTenantRow(rows[0]);
  },

  async verifyTenantAgentToken(tenantId, rawToken) {
    const tenant = await this.findTenantById(tenantId);
    if (!tenant || tenant.status !== 'active') return false;
    return verifyAgentToken(rawToken, tenant.agent_token_hash);
  },

  async listTenantUsers(tenantId) {
    if (!USE_PG) {
      return mem.users
        .filter((u) => matchTenant(u.tenant_id, tenantId))
        .map(({ password_hash: _ph, ...safe }) => safe)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }
    const clean = canonicalTenantId(tenantId);
    const { rows } = await pool.query(
      `SELECT id, tenant_id, name, email, role, department, job_title, active, created_at
       FROM auth_svc.users WHERE tenant_id = $1 OR tenant_id = $2 ORDER BY name ASC`,
      [tenantId, clean],
    );
    return rows.map(normalizeUserRow);
  },

  async createUser({
    tenantId,
    name,
    email,
    password,
    role = 'collaborator',
    department = 'Geral',
    jobTitle = 'Colaborador',
    active = true,
  }) {
    const cleanEmail = String(email || '').toLowerCase().trim();
    if (!cleanEmail) {
      const err = new Error('E-mail é obrigatório para cadastro de usuário.');
      err.statusCode = 400;
      throw err;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      const err = new Error('Formato de e-mail inválido. Utilize um endereço corporativo válido.');
      err.statusCode = 400;
      throw err;
    }
    const cleanTenantId = canonicalTenantId(tenantId) || 'tenant-ap3htf6';
    const pwdHash = hashPassword(password);
    const nowIso = new Date().toISOString();

    if (!USE_PG) {
      const existing = mem.users.find((u) => u.email.toLowerCase() === cleanEmail);
      if (existing) {
        const err = new Error('E-mail já cadastrado na plataforma.');
        err.statusCode = 409;
        throw err;
      }
      const user = {
        id: crypto.randomUUID(),
        tenant_id: cleanTenantId,
        name: String(name || '').trim() || 'Colaborador',
        email: cleanEmail,
        password_hash: pwdHash,
        role: String(role || 'collaborator').toLowerCase(),
        department: String(department || 'Geral').trim(),
        job_title: String(jobTitle || 'Colaborador').trim(),
        active: Boolean(active),
        created_at: nowIso,
      };
      mem.users.push(user);
      const { password_hash: _ph, ...safe } = user;
      return safe;
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO auth_svc.users
         (tenant_id, name, email, password_hash, role, department, job_title, active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         RETURNING id, tenant_id, name, email, role, department, job_title, active, created_at`,
        [
          cleanTenantId,
          String(name || '').trim() || 'Colaborador',
          cleanEmail,
          pwdHash,
          String(role || 'collaborator').toLowerCase(),
          String(department || 'Geral').trim(),
          String(jobTitle || 'Colaborador').trim(),
          Boolean(active),
        ],
      );
      return normalizeUserRow(rows[0]);
    } catch (pgErr) {
      if (pgErr.code === '23505') {
        const err = new Error('E-mail já cadastrado na plataforma.');
        err.statusCode = 409;
        throw err;
      }
      throw pgErr;
    }
  },
};

// =============================================================================
// 2. Repositório de Ativos (`assets_svc`)
// =============================================================================
export const assetsRepo = {
  async list(tenantId, { status, type, search, assignedToEmail } = {}) {
    if (!USE_PG) {
      return mem.assets
        .filter((a) => {
          if (!matchTenant(a.tenant_id, tenantId)) return false;
          if (
            assignedToEmail &&
            String(a.assigned_to_email || '').toLowerCase() !== assignedToEmail.toLowerCase()
          ) {
            return false;
          }
          if (status && a.status !== status) return false;
          if (type && a.type.toLowerCase() !== type.toLowerCase()) return false;
          if (search) {
            const q = search.toLowerCase();
            const hay = `${a.internal_id} ${a.brand} ${a.model} ${a.serial_number || ''} ${a.assigned_to_name || ''}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        })
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    }

    const clean = canonicalTenantId(tenantId);
    const params = [tenantId, clean];
    const clauses = ['(tenant_id = $1 OR tenant_id = $2)'];
    if (assignedToEmail) {
      params.push(assignedToEmail.toLowerCase());
      clauses.push(`LOWER(assigned_to_email) = $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`status = $${params.length}`);
    }
    if (type) {
      params.push(type);
      clauses.push(`LOWER(type) = LOWER($${params.length})`);
    }
    if (search) {
      params.push(`%${search}%`);
      clauses.push(
        `(internal_id ILIKE $${params.length} OR brand ILIKE $${params.length} OR model ILIKE $${params.length} OR COALESCE(serial_number,'') ILIKE $${params.length} OR COALESCE(assigned_to_name,'') ILIKE $${params.length})`,
      );
    }

    const { rows } = await pool.query(
      `SELECT * FROM assets_svc.assets WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`,
      params,
    );
    return rows.map(normalizeAssetRow);
  },

  async findById(tenantId, assetId) {
    if (!USE_PG) {
      const asset = mem.assets.find((a) => a.id === assetId && matchTenant(a.tenant_id, tenantId));
      if (!asset) return null;
      const history = mem.assetHistory
        .filter((h) => h.asset_id === assetId && matchTenant(h.tenant_id, tenantId))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, 30);
      return { ...asset, history };
    }
    if (!isUuid(assetId)) return null;
    const clean = canonicalTenantId(tenantId);
    const { rows } = await pool.query(
      'SELECT * FROM assets_svc.assets WHERE id = $1 AND (tenant_id = $2 OR tenant_id = $3) LIMIT 1',
      [assetId, tenantId, clean],
    );
    if (!rows[0]) return null;
    const histRes = await pool.query(
      'SELECT * FROM assets_svc.asset_history WHERE asset_id = $1 AND (tenant_id = $2 OR tenant_id = $3) ORDER BY created_at DESC LIMIT 30',
      [assetId, tenantId, clean],
    );
    return {
      ...normalizeAssetRow(rows[0]),
      history: histRes.rows.map(normalizeHistoryRow),
    };
  },

  async create(tenantId, payload, actor) {
    const nowIso = new Date().toISOString();
    const internalId = String(payload.internalId || '').trim().toUpperCase();

    if (!USE_PG) {
      const exists = mem.assets.some(
        (a) => matchTenant(a.tenant_id, tenantId) && a.internal_id.toUpperCase() === internalId,
      );
      if (exists) {
        const err = new Error(`A tag patrimonial '${internalId}' já está em uso nesta empresa.`);
        err.statusCode = 409;
        throw err;
      }
      const created = {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        internal_id: internalId,
        type: payload.type,
        brand: payload.brand,
        model: payload.model,
        serial_number: payload.serialNumber || null,
        status: payload.status || (payload.assignedToEmail ? 'Em Uso' : 'Disponível'),
        location: payload.location || 'Matriz - TI',
        department: payload.department || 'Estoque TI',
        assigned_to_name: payload.assignedToName || null,
        assigned_to_email: payload.assignedToEmail ? payload.assignedToEmail.toLowerCase() : null,
        purchase_value: Number(payload.purchaseValue || 0),
        specs: payload.specs || {},
        created_at: nowIso,
        updated_at: nowIso,
      };
      mem.assets.push(created);
      mem.assetHistory.push({
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        asset_id: created.id,
        action: 'ATIVO_CRIADO',
        actor_name: actor.name || actor.email,
        actor_email: actor.email,
        details: `Ativo ${created.internal_id} (${created.brand} ${created.model}) registrado.`,
        created_at: nowIso,
      });
      return created;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO assets_svc.assets
         (tenant_id, internal_id, type, brand, model, serial_number, status, location, department, assigned_to_name, assigned_to_email, purchase_value, specs)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
         RETURNING *`,
        [
          tenantId,
          internalId,
          payload.type,
          payload.brand,
          payload.model,
          payload.serialNumber || null,
          payload.status || (payload.assignedToEmail ? 'Em Uso' : 'Disponível'),
          payload.location || 'Matriz - TI',
          payload.department || 'Estoque TI',
          payload.assignedToName || null,
          payload.assignedToEmail ? payload.assignedToEmail.toLowerCase() : null,
          Number(payload.purchaseValue || 0),
          JSON.stringify(payload.specs || {}),
        ],
      );
      const created = normalizeAssetRow(rows[0]);
      await client.query(
        `INSERT INTO assets_svc.asset_history (tenant_id, asset_id, action, actor_name, actor_email, details)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          tenantId,
          created.id,
          'ATIVO_CRIADO',
          actor.name || actor.email,
          actor.email,
          `Ativo ${created.internal_id} (${created.brand} ${created.model}) registrado.`,
        ],
      );
      await client.query('COMMIT');
      return created;
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === '23505') {
        const err = new Error(`A tag patrimonial '${internalId}' já está em uso nesta empresa.`);
        err.statusCode = 409;
        throw err;
      }
      throw e;
    } finally {
      client.release();
    }
  },

  async update(tenantId, assetId, patch, actor) {
    const nowIso = new Date().toISOString();
    if (!USE_PG) {
      const idx = mem.assets.findIndex((a) => a.id === assetId && matchTenant(a.tenant_id, tenantId));
      if (idx === -1) return null;
      const current = mem.assets[idx];
      const updated = {
        ...current,
        type: patch.type ?? current.type,
        brand: patch.brand ?? current.brand,
        model: patch.model ?? current.model,
        serial_number: patch.serialNumber !== undefined ? patch.serialNumber : current.serial_number,
        status: patch.status ?? current.status,
        location: patch.location ?? current.location,
        department: patch.department ?? current.department,
        assigned_to_name:
          patch.assignedToName !== undefined ? patch.assignedToName : current.assigned_to_name,
        assigned_to_email:
          patch.assignedToEmail !== undefined
            ? patch.assignedToEmail
              ? patch.assignedToEmail.toLowerCase()
              : null
            : current.assigned_to_email,
        purchase_value:
          patch.purchaseValue !== undefined ? Number(patch.purchaseValue) : current.purchase_value,
        specs: patch.specs ? { ...current.specs, ...patch.specs } : current.specs,
        updated_at: nowIso,
      };
      mem.assets[idx] = updated;
      mem.assetHistory.push({
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        asset_id: assetId,
        action: 'ATIVO_ATUALIZADO',
        actor_name: actor.name || actor.email,
        actor_email: actor.email,
        details: patch.historyNote || `Cadastro atualizado (status: ${updated.status}).`,
        created_at: nowIso,
      });
      return updated;
    }

    if (!isUuid(assetId)) return null;

    const clean = canonicalTenantId(tenantId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existingRes = await client.query(
        'SELECT * FROM assets_svc.assets WHERE id = $1 AND (tenant_id = $2 OR tenant_id = $3) FOR UPDATE',
        [assetId, tenantId, clean],
      );
      const existing = existingRes.rows[0];
      if (!existing) {
        await client.query('ROLLBACK');
        return null;
      }

      const mergedSpecs = patch.specs
        ? { ...(existing.specs || {}), ...patch.specs }
        : existing.specs;
      const { rows } = await client.query(
        `UPDATE assets_svc.assets
         SET type = $3, brand = $4, model = $5, serial_number = $6, status = $7,
             location = $8, department = $9, assigned_to_name = $10, assigned_to_email = $11,
             purchase_value = $12, specs = $13::jsonb, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [
          assetId,
          tenantId,
          patch.type ?? existing.type,
          patch.brand ?? existing.brand,
          patch.model ?? existing.model,
          patch.serialNumber !== undefined ? patch.serialNumber : existing.serial_number,
          patch.status ?? existing.status,
          patch.location ?? existing.location,
          patch.department ?? existing.department,
          patch.assignedToName !== undefined ? patch.assignedToName : existing.assigned_to_name,
          patch.assignedToEmail !== undefined
            ? patch.assignedToEmail
              ? patch.assignedToEmail.toLowerCase()
              : null
            : existing.assigned_to_email,
          patch.purchaseValue !== undefined
            ? Number(patch.purchaseValue)
            : Number(existing.purchase_value ?? 0),
          JSON.stringify(mergedSpecs || {}),
        ],
      );
      await client.query(
        `INSERT INTO assets_svc.asset_history (tenant_id, asset_id, action, actor_name, actor_email, details)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          tenantId,
          assetId,
          'ATIVO_ATUALIZADO',
          actor.name || actor.email,
          actor.email,
          patch.historyNote || `Cadastro atualizado (status: ${rows[0].status}).`,
        ],
      );
      await client.query('COMMIT');
      return normalizeAssetRow(rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async retire(tenantId, assetId, reason, actor) {
    return this.update(
      tenantId,
      assetId,
      {
        status: 'Baixado',
        assignedToName: null,
        assignedToEmail: null,
        historyNote: `Baixa patrimonial executada. Motivo: ${reason}`,
      },
      actor,
    );
  },
};

// =============================================================================
// 3. Repositório de Chamados / Helpdesk (`tickets_svc`)
// =============================================================================
const SLA_HOURS = { critical: 4, high: 8, medium: 24, low: 48 };

function generateTicketProtocol(now, attempt = 0) {
  const digits = attempt === 0 ? 4 : 6;
  const min = 10 ** (digits - 1);
  const max = 10 ** digits - min;
  const suffix = String(Math.floor(min + Math.random() * max));
  return `CHM-${now.getFullYear()}-${suffix}`;
}

export const ticketsRepo = {
  async list(tenantId, { requesterEmail, status, priority } = {}) {
    if (!USE_PG) {
      return mem.tickets
        .filter((t) => {
          if (!matchTenant(t.tenant_id, tenantId)) return false;
          if (requesterEmail && t.requester_email.toLowerCase() !== requesterEmail.toLowerCase()) {
            return false;
          }
          if (status && t.status !== status) return false;
          if (priority && t.priority !== priority) return false;
          return true;
        })
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .map((t) => ({
          ...t,
          comments_count: mem.ticketComments.filter((c) => c.ticket_id === t.id).length,
        }));
    }

    const clean = canonicalTenantId(tenantId);
    const params = [tenantId, clean];
    const clauses = ['(t.tenant_id = $1 OR t.tenant_id = $2)'];
    if (requesterEmail) {
      params.push(requesterEmail.toLowerCase());
      clauses.push(`LOWER(t.requester_email) = $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`t.status = $${params.length}`);
    }
    if (priority) {
      params.push(priority);
      clauses.push(`t.priority = $${params.length}`);
    }

    const { rows } = await pool.query(
      `SELECT t.*,
              (SELECT COUNT(*)::int FROM tickets_svc.ticket_comments c WHERE c.ticket_id = t.id) AS comments_count
       FROM tickets_svc.tickets t
       WHERE ${clauses.join(' AND ')}
       ORDER BY t.created_at DESC`,
      params,
    );
    return rows.map(normalizeTicketRow);
  },

  async findById(tenantId, ticketId) {
    if (!USE_PG) {
      const tk = mem.tickets.find((t) => t.id === ticketId && matchTenant(t.tenant_id, tenantId));
      if (!tk) return null;
      const comments = mem.ticketComments
        .filter((c) => c.ticket_id === ticketId && matchTenant(c.tenant_id, tenantId))
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      return { ...tk, comments };
    }
    if (!isUuid(ticketId)) return null;
    const clean = canonicalTenantId(tenantId);
    const { rows } = await pool.query(
      'SELECT * FROM tickets_svc.tickets WHERE id = $1 AND (tenant_id = $2 OR tenant_id = $3) LIMIT 1',
      [ticketId, tenantId, clean],
    );
    if (!rows[0]) return null;
    const cmRes = await pool.query(
      'SELECT * FROM tickets_svc.ticket_comments WHERE ticket_id = $1 AND (tenant_id = $2 OR tenant_id = $3) ORDER BY created_at ASC',
      [ticketId, tenantId, clean],
    );
    return {
      ...normalizeTicketRow(rows[0]),
      comments: cmRes.rows.map(normalizeCommentRow),
    };
  },

  async create(tenantId, payload, requester) {
    const now = new Date();
    const priority = payload.priority || 'medium';
    const slaHours = SLA_HOURS[priority] || 24;
    const slaDueIso = new Date(now.getTime() + slaHours * 3_600_000).toISOString();

    if (!USE_PG) {
      let protocol = generateTicketProtocol(now, 0);
      for (let attempt = 1; attempt <= 5 && mem.tickets.some((t) => t.protocol === protocol); attempt += 1) {
        protocol = generateTicketProtocol(now, attempt);
      }
      const created = {
        id: crypto.randomUUID(),
        protocol,
        tenant_id: tenantId,
        requester_name: requester.name || requester.email,
        requester_email: requester.email.toLowerCase(),
        department: payload.department || 'Geral',
        asset_id: payload.assetId || null,
        asset_tag: payload.assetTag || null,
        category: payload.category || 'Suporte Técnico',
        priority,
        status: 'open',
        title: payload.title,
        description: payload.description,
        assigned_tech_name: null,
        resolution_notes: null,
        sla_due_at: slaDueIso,
        resolved_at: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      };
      mem.tickets.push(created);
      return created;
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const protocol = generateTicketProtocol(now, attempt);
      try {
        const { rows } = await pool.query(
          `INSERT INTO tickets_svc.tickets
           (protocol, tenant_id, requester_name, requester_email, department, asset_id, asset_tag, category, priority, status, title, description, sla_due_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10,$11,$12)
           RETURNING *`,
          [
            protocol,
            tenantId,
            requester.name || requester.email,
            requester.email.toLowerCase(),
            payload.department || 'Geral',
            payload.assetId || null,
            payload.assetTag || null,
            payload.category || 'Suporte Técnico',
            priority,
            payload.title,
            payload.description,
            slaDueIso,
          ],
        );
        return normalizeTicketRow(rows[0]);
      } catch (e) {
        if (e.code === '23505' && attempt < 5) continue;
        throw e;
      }
    }
    throw new Error('Não foi possível alocar protocolo único para o chamado.');
  },

  async updateStatus(tenantId, ticketId, { status, resolutionNotes, assignedTechName }) {
    const nowIso = new Date().toISOString();
    const resolvedAt = status === 'resolved' || status === 'closed' ? nowIso : null;

    if (!USE_PG) {
      const idx = mem.tickets.findIndex((t) => t.id === ticketId && matchTenant(t.tenant_id, tenantId));
      if (idx === -1) return null;
      const cur = mem.tickets[idx];
      const updated = {
        ...cur,
        status: status || cur.status,
        assigned_tech_name: assignedTechName ?? cur.assigned_tech_name,
        resolution_notes: resolutionNotes ?? cur.resolution_notes,
        resolved_at: resolvedAt ?? cur.resolved_at,
        updated_at: nowIso,
      };
      mem.tickets[idx] = updated;
      return updated;
    }

    if (!isUuid(ticketId)) return null;
    const clean = canonicalTenantId(tenantId);
    const { rows } = await pool.query(
      `UPDATE tickets_svc.tickets
       SET status = COALESCE($3, status),
           assigned_tech_name = COALESCE($4, assigned_tech_name),
           resolution_notes = COALESCE($5, resolution_notes),
           resolved_at = CASE WHEN $3 IN ('resolved', 'closed') THEN NOW() ELSE resolved_at END,
           updated_at = NOW()
       WHERE id = $1 AND (tenant_id = $2 OR tenant_id = $6)
       RETURNING *`,
      [ticketId, tenantId, status || null, assignedTechName || null, resolutionNotes || null, clean],
    );
    return normalizeTicketRow(rows[0]);
  },

  async addComment(tenantId, ticketId, author, message) {
    const nowIso = new Date().toISOString();
    if (!USE_PG) {
      const tk = mem.tickets.find((t) => t.id === ticketId && matchTenant(t.tenant_id, tenantId));
      if (!tk) return null;
      const cm = {
        id: crypto.randomUUID(),
        ticket_id: ticketId,
        tenant_id: tenantId,
        author_name: author.name || author.email,
        author_email: author.email.toLowerCase(),
        author_role: author.role,
        message,
        created_at: nowIso,
      };
      mem.ticketComments.push(cm);
      return cm;
    }

    if (!isUuid(ticketId)) return null;
    const clean = canonicalTenantId(tenantId);
    const tkCheck = await pool.query(
      'SELECT id FROM tickets_svc.tickets WHERE id = $1 AND (tenant_id = $2 OR tenant_id = $3) LIMIT 1',
      [ticketId, tenantId, clean],
    );
    if (!tkCheck.rows[0]) return null;

    const { rows } = await pool.query(
      `INSERT INTO tickets_svc.ticket_comments
       (ticket_id, tenant_id, author_name, author_email, author_role, message)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [ticketId, tenantId, author.name || author.email, author.email.toLowerCase(), author.role, message],
    );
    return normalizeCommentRow(rows[0]);
  },

  async getMetrics(tenantId) {
    const list = await this.list(tenantId);
    const counts = { total: list.length, open: 0, in_progress: 0, resolved: 0, closed: 0, critical: 0 };
    for (const tk of list) {
      counts[tk.status] = (counts[tk.status] || 0) + 1;
      if (tk.priority === 'critical' && tk.status !== 'resolved' && tk.status !== 'closed') {
        counts.critical += 1;
      }
    }
    return counts;
  },
};

// =============================================================================
// 4. Repositório de Compliance CLT & Hash-Chain Audit (`compliance_svc`)
// =============================================================================
export const complianceRepo = {
  async listTerms(tenantId, { employeeEmail, status } = {}) {
    if (!USE_PG) {
      return mem.terms
        .filter((t) => {
          if (!matchTenant(t.tenant_id, tenantId)) return false;
          if (employeeEmail && t.employee_email.toLowerCase() !== employeeEmail.toLowerCase()) {
            return false;
          }
          if (status && t.status !== status) return false;
          return true;
        })
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    }

    const clean = canonicalTenantId(tenantId);
    const params = [tenantId, clean];
    const clauses = ['(tenant_id = $1 OR tenant_id = $2)'];
    if (employeeEmail) {
      params.push(employeeEmail.toLowerCase());
      clauses.push(`LOWER(employee_email) = $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`status = $${params.length}`);
    }
    const { rows } = await pool.query(
      `SELECT * FROM compliance_svc.responsibility_terms WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`,
      params,
    );
    return rows.map(normalizeTermRow);
  },

  async findTermById(tenantId, termId) {
    if (!USE_PG) {
      return mem.terms.find((t) => t.id === termId && matchTenant(t.tenant_id, tenantId)) || null;
    }
    if (!isUuid(termId)) return null;
    const clean = canonicalTenantId(tenantId);
    const { rows } = await pool.query(
      'SELECT * FROM compliance_svc.responsibility_terms WHERE id = $1 AND (tenant_id = $2 OR tenant_id = $3) LIMIT 1',
      [termId, tenantId, clean],
    );
    return normalizeTermRow(rows[0]);
  },

  async createTerm(tenantId, payload, issuer) {
    const nowIso = new Date().toISOString();
    const legalClause =
      payload.legalClause ||
      'Declaro, nos termos do Art. 462 §1º da CLT e da Política de Segurança da Informação Corporativa, ter recebido em perfeito estado de funcionamento os equipamentos listados, comprometendo-me com sua guarda, conservação e uso estritamente profissional.';
    const assetsSnapshot = Array.isArray(payload.assetsSnapshot) ? payload.assetsSnapshot : [];
    const docHash = computeTermDocumentHash({
      tenantId,
      termType: payload.termType || 'entrega',
      employeeEmail: payload.employeeEmail,
      assetsSnapshot,
      legalClause,
    });

    if (!USE_PG) {
      const created = {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        term_type: payload.termType || 'entrega',
        employee_name: payload.employeeName,
        employee_email: payload.employeeEmail.toLowerCase().trim(),
        employee_cpf: payload.employeeCpf || null,
        department: payload.department || 'Corporativo',
        assets_snapshot: assetsSnapshot,
        legal_clause: legalClause,
        status: 'pending',
        document_hash: docHash,
        signature_hash: null,
        signer_ip: null,
        signer_user_agent: null,
        issued_by: issuer.name || issuer.email,
        signed_at: null,
        created_at: nowIso,
      };
      mem.terms.push(created);
      return created;
    }

    const { rows } = await pool.query(
      `INSERT INTO compliance_svc.responsibility_terms
       (tenant_id, term_type, employee_name, employee_email, employee_cpf, department, assets_snapshot, legal_clause, status, document_hash, issued_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'pending',$9,$10)
       RETURNING *`,
      [
        tenantId,
        payload.termType || 'entrega',
        payload.employeeName,
        payload.employeeEmail.toLowerCase().trim(),
        payload.employeeCpf || null,
        payload.department || 'Corporativo',
        JSON.stringify(assetsSnapshot),
        legalClause,
        docHash,
        issuer.name || issuer.email,
      ],
    );
    return normalizeTermRow(rows[0]);
  },

  async signTerm(tenantId, termId, { signerIp, signerUserAgent }) {
    const term = await this.findTermById(tenantId, termId);
    if (!term) return null;
    if (term.status === 'signed') {
      const err = new Error('Este termo já encontra-se assinado digitalmente.');
      err.statusCode = 409;
      throw err;
    }
    if (term.status === 'revoked') {
      const err = new Error('Este termo foi revogado e não pode mais ser assinado.');
      err.statusCode = 409;
      throw err;
    }

    const signedAtIso = new Date().toISOString();
    const safeIp = cleanIp(signerIp, '127.0.0.1');
    const safeUa = String(signerUserAgent || 'NexusClient').slice(0, 255);
    const sigHash = signResponsibilityTerm({
      termId: term.id,
      tenantId,
      employeeEmail: term.employee_email,
      documentHash: term.document_hash,
      signedAt: signedAtIso,
    });

    if (!USE_PG) {
      const idx = mem.terms.findIndex((t) => t.id === termId && matchTenant(t.tenant_id, tenantId));
      mem.terms[idx] = {
        ...term,
        status: 'signed',
        signature_hash: sigHash,
        signer_ip: safeIp,
        signer_user_agent: safeUa,
        signed_at: signedAtIso,
      };
      return mem.terms[idx];
    }

    const clean = canonicalTenantId(tenantId);
    const { rows } = await pool.query(
      `UPDATE compliance_svc.responsibility_terms
       SET status = 'signed',
           signature_hash = $3,
           signer_ip = $4,
           signer_user_agent = $5,
           signed_at = $6
       WHERE id = $1 AND (tenant_id = $2 OR tenant_id = $7) AND status = 'pending'
       RETURNING *`,
      [termId, tenantId, sigHash, safeIp, safeUa, signedAtIso, clean],
    );
    if (!rows[0]) {
      const err = new Error('Este termo já foi processado ou revogado em requisição concorrente.');
      err.statusCode = 409;
      throw err;
    }
    return normalizeTermRow(rows[0]);
  },

  async appendAuditLog(tenantId, { actorEmail, actorRole, action, resourceType, resourceId, payload }) {
    const clean = canonicalTenantId(tenantId);
    const createdAtIso = new Date().toISOString();

    if (!USE_PG) {
      const tenantChain = mem.auditChain
        .filter((e) => matchTenant(e.tenant_id, tenantId))
        .sort((a, b) => a.seq - b.seq);
      const prevHash =
        tenantChain.length > 0 ? tenantChain[tenantChain.length - 1].entry_hash : GENESIS_HASH;
      const entryHash = computeAuditChainHash({
        prevHash,
        tenantId: clean,
        actorEmail,
        actorRole,
        action,
        resourceType,
        resourceId,
        payload,
        createdAtIso,
      });
      mem.seqCounter += 1;
      const entry = {
        seq: mem.seqCounter,
        id: crypto.randomUUID(),
        tenant_id: clean,
        actor_email: actorEmail,
        actor_role: actorRole,
        action,
        resource_type: resourceType,
        resource_id: String(resourceId),
        payload: payload || {},
        prev_hash: prevHash,
        entry_hash: entryHash,
        created_at: createdAtIso,
      };
      mem.auditChain.push(entry);
      return entry;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Advisory lock transacional por tenant serializa gravações concorrentes na Hash-Chain,
      // mesmo quando a empresa ainda não possui nenhum registro anterior (0 linhas).
      await client.query('SELECT pg_advisory_xact_lock(202603, hashtext($1))', [clean]);
      const lastRes = await client.query(
        'SELECT entry_hash FROM compliance_svc.audit_chain WHERE (tenant_id = $1 OR tenant_id = $2) ORDER BY seq DESC LIMIT 1',
        [tenantId, clean],
      );
      const prevHash = lastRes.rows[0]?.entry_hash || GENESIS_HASH;
      const entryHash = computeAuditChainHash({
        prevHash,
        tenantId: clean,
        actorEmail,
        actorRole,
        action,
        resourceType,
        resourceId: String(resourceId),
        payload: payload || {},
        createdAtIso,
      });

      const { rows } = await client.query(
        `INSERT INTO compliance_svc.audit_chain
         (tenant_id, actor_email, actor_role, action, resource_type, resource_id, payload, prev_hash, entry_hash, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
         RETURNING *`,
        [
          clean,
          actorEmail,
          actorRole,
          action,
          resourceType,
          String(resourceId),
          JSON.stringify(payload || {}),
          prevHash,
          entryHash,
          createdAtIso,
        ],
      );
      await client.query('COMMIT');
      return normalizeAuditRow(rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async listAuditChain(tenantId, limit = 50) {
    const clean = canonicalTenantId(tenantId);
    if (!USE_PG) {
      return mem.auditChain
        .filter((e) => matchTenant(e.tenant_id, tenantId))
        .sort((a, b) => b.seq - a.seq)
        .slice(0, limit);
    }
    const { rows } = await pool.query(
      'SELECT * FROM compliance_svc.audit_chain WHERE (tenant_id = $1 OR tenant_id = $3) ORDER BY seq DESC LIMIT $2',
      [tenantId, limit, clean],
    );
    return rows.map(normalizeAuditRow);
  },

  async verifyAuditChainIntegrity(tenantId) {
    const clean = canonicalTenantId(tenantId);
    let entries;
    if (!USE_PG) {
      entries = mem.auditChain
        .filter((e) => matchTenant(e.tenant_id, tenantId))
        .sort((a, b) => a.seq - b.seq);
    } else {
      const { rows } = await pool.query(
        'SELECT * FROM compliance_svc.audit_chain WHERE (tenant_id = $1 OR tenant_id = $2) ORDER BY seq ASC',
        [tenantId, clean],
      );
      entries = rows.map(normalizeAuditRow);
    }

    let expectedPrev = GENESIS_HASH;
    for (const row of entries) {
      const createdIso = toIso(row.created_at);
      if (row.prev_hash !== expectedPrev) {
        return {
          intact: false,
          checkedRecords: entries.length,
          brokenAtSeq: Number(row.seq),
          reason: 'Quebra de elo anterior (prev_hash divergente).',
        };
      }
      const recomputed = computeAuditChainHash({
        prevHash: row.prev_hash,
        tenantId: row.tenant_id,
        actorEmail: row.actor_email,
        actorRole: row.actor_role,
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        payload: row.payload,
        createdAtIso: createdIso,
      });
      if (recomputed !== row.entry_hash) {
        return {
          intact: false,
          checkedRecords: entries.length,
          brokenAtSeq: Number(row.seq),
          reason: 'Adulteração detectada: hash SHA-256 do conteúdo não confere.',
        };
      }
      expectedPrev = row.entry_hash;
    }

    return {
      intact: true,
      algorithm: 'SHA-256 Hash-Chain',
      checkedRecords: entries.length,
      genesisHash: GENESIS_HASH,
      headHash: expectedPrev,
      verifiedAt: new Date().toISOString(),
    };
  },
};

// =============================================================================
// 5. Repositório de Telemetria RMM & Frota (`telemetry_svc`)
// =============================================================================
export const telemetryRepo = {
  async upsertHeartbeat(tenantId, data) {
    const nowIso = new Date().toISOString();
    const record = {
      tenant_id: tenantId,
      device_key: String(data.deviceKey).trim(),
      hostname: String(data.hostname).trim().toUpperCase(),
      serial_number: data.serialNumber || null,
      os_version: data.osVersion || 'Windows 11 Pro 24H2',
      agent_version: data.agentVersion || '3.2.0',
      ip_address: cleanIp(data.ipAddress, '0.0.0.0'),
      logged_user: data.loggedUser || 'system',
      cpu_percent: Number(data.cpuPercent ?? 0),
      ram_percent: Number(data.ramPercent ?? 0),
      disk_percent: Number(data.diskPercent ?? 0),
      antivirus_active: data.antivirusActive !== false,
      firewall_active: data.firewallActive !== false,
      last_seen_at: nowIso,
    };

    if (!USE_PG) {
      const idx = mem.telemetry.findIndex(
        (d) => d.tenant_id === tenantId && d.device_key === record.device_key,
      );
      if (idx >= 0) {
        mem.telemetry[idx] = { ...mem.telemetry[idx], ...record };
        return mem.telemetry[idx];
      }
      const created = { id: crypto.randomUUID(), ...record };
      mem.telemetry.push(created);
      return created;
    }

    const { rows } = await pool.query(
      `INSERT INTO telemetry_svc.device_telemetry
       (tenant_id, device_key, hostname, serial_number, os_version, agent_version, ip_address, logged_user, cpu_percent, ram_percent, disk_percent, antivirus_active, firewall_active, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       ON CONFLICT (tenant_id, device_key) DO UPDATE SET
         hostname = EXCLUDED.hostname,
         serial_number = COALESCE(EXCLUDED.serial_number, telemetry_svc.device_telemetry.serial_number),
         os_version = EXCLUDED.os_version,
         agent_version = EXCLUDED.agent_version,
         ip_address = EXCLUDED.ip_address,
         logged_user = EXCLUDED.logged_user,
         cpu_percent = EXCLUDED.cpu_percent,
         ram_percent = EXCLUDED.ram_percent,
         disk_percent = EXCLUDED.disk_percent,
         antivirus_active = EXCLUDED.antivirus_active,
         firewall_active = EXCLUDED.firewall_active,
         last_seen_at = NOW()
       RETURNING *`,
      [
        record.tenant_id, record.device_key, record.hostname, record.serial_number,
        record.os_version, record.agent_version, record.ip_address, record.logged_user,
        record.cpu_percent, record.ram_percent, record.disk_percent,
        record.antivirus_active, record.firewall_active,
      ],
    );
    return normalizeTelemetryRow(rows[0]);
  },

  async listFleet(tenantId) {
    let devices;
    if (!USE_PG) {
      devices = mem.telemetry
        .filter((d) => d.tenant_id === tenantId)
        .sort((a, b) => String(b.last_seen_at).localeCompare(String(a.last_seen_at)));
    } else {
      const { rows } = await pool.query(
        'SELECT * FROM telemetry_svc.device_telemetry WHERE tenant_id = $1 ORDER BY last_seen_at DESC',
        [tenantId],
      );
      devices = rows.map(normalizeTelemetryRow);
    }

    const nowMs = Date.now();
    const enriched = devices.map((d) => {
      const seenMs = new Date(d.last_seen_at).getTime();
      const online = nowMs - seenMs <= 120_000;
      return {
        ...d,
        cpu_percent: Number(d.cpu_percent),
        ram_percent: Number(d.ram_percent),
        disk_percent: Number(d.disk_percent),
        online,
      };
    });

    const onlineCount = enriched.filter((d) => d.online).length;
    const avgCpu =
      enriched.length > 0
        ? Number((enriched.reduce((acc, d) => acc + d.cpu_percent, 0) / enriched.length).toFixed(1))
        : 0;
    const avgRam =
      enriched.length > 0
        ? Number((enriched.reduce((acc, d) => acc + d.ram_percent, 0) / enriched.length).toFixed(1))
        : 0;

    return {
      summary: {
        totalDevices: enriched.length,
        online: onlineCount,
        offline: enriched.length - onlineCount,
        avgCpuPercent: avgCpu,
        avgRamPercent: avgRam,
      },
      devices: enriched,
    };
  },

  async queueCommand(tenantId, { deviceKey, commandType, payload }, actorEmail) {
    const nowIso = new Date().toISOString();
    if (!USE_PG) {
      const cmd = {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        device_key: deviceKey,
        command_type: commandType,
        payload: payload || '',
        issued_by: actorEmail,
        status: 'dispatched',
        created_at: nowIso,
      };
      mem.remoteCommands.push(cmd);
      return cmd;
    }
    const { rows } = await pool.query(
      `INSERT INTO telemetry_svc.remote_commands
       (tenant_id, device_key, command_type, payload, issued_by, status)
       VALUES ($1,$2,$3,$4,$5,'dispatched') RETURNING *`,
      [tenantId, deviceKey, commandType, payload || '', actorEmail],
    );
    return normalizeCommandRow(rows[0]);
  },
};
