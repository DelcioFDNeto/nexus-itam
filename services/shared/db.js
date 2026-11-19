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

const normalizeAttachmentArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const normalizeTicketRow = (r) => {
  if (!r) return null;
  const out = {
    ...r,
    sla_due_at: toIso(r.sla_due_at),
    resolved_at: toIso(r.resolved_at),
    created_at: toIso(r.created_at),
    updated_at: toIso(r.updated_at),
  };
  if (r.attachments !== undefined) {
    out.attachments = normalizeAttachmentArray(r.attachments);
  }
  if (r.attachments_count !== undefined) {
    out.attachments_count = Number(r.attachments_count);
  } else if (Array.isArray(out.attachments)) {
    out.attachments_count = out.attachments.length;
  }
  if (r.comments_count !== undefined) {
    out.comments_count = Number(r.comments_count);
  }
  if (r.last_message_at !== undefined) {
    out.last_message_at = toIso(r.last_message_at);
  }
  if (r.last_message_preview !== undefined) {
    out.last_message_preview = r.last_message_preview || '';
  }
  return out;
};

const normalizeCommentRow = (r) =>
  r
    ? {
        ...r,
        attachments: normalizeAttachmentArray(r.attachments),
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

const normalizeVpsConnectionRow = (r) =>
  r
    ? {
        ...r,
        port: r.port === null || r.port === undefined ? null : Number(r.port),
        quota_bytes: Number(r.quota_bytes ?? 0),
        used_bytes: Number(r.used_bytes ?? 0),
        latency_ms: r.latency_ms === null || r.latency_ms === undefined ? null : Number(r.latency_ms),
        free_bytes: r.free_bytes === null || r.free_bytes === undefined ? null : Number(r.free_bytes),
        total_bytes: r.total_bytes === null || r.total_bytes === undefined ? null : Number(r.total_bytes),
        last_check_at: toIso(r.last_check_at),
        initialized_at: toIso(r.initialized_at),
        created_at: toIso(r.created_at),
        updated_at: toIso(r.updated_at),
      }
    : null;

const normalizeStorageNodeRow = (r) =>
  r
    ? {
        ...r,
        size_bytes: Number(r.size_bytes ?? 0),
        current_version: Number(r.current_version ?? 1),
        is_trashed: Boolean(r.is_trashed),
        locked_at: toIso(r.locked_at),
        trashed_at: toIso(r.trashed_at),
        created_at: toIso(r.created_at),
        updated_at: toIso(r.updated_at),
      }
    : null;

const normalizeStorageAclRow = (r) =>
  r
    ? {
        ...r,
        created_at: toIso(r.created_at),
        updated_at: toIso(r.updated_at),
      }
    : null;

const normalizeStorageVersionRow = (r) =>
  r
    ? {
        ...r,
        version_number: Number(r.version_number ?? 1),
        size_bytes: Number(r.size_bytes ?? 0),
        created_at: toIso(r.created_at),
      }
    : null;

const normalizeStorageTempLinkRow = (r) =>
  r
    ? {
        ...r,
        allow_download: Boolean(r.allow_download),
        access_count: Number(r.access_count ?? 0),
        expires_at: toIso(r.expires_at),
        revoked_at: toIso(r.revoked_at),
        last_accessed_at: toIso(r.last_accessed_at),
        created_at: toIso(r.created_at),
      }
    : null;

const normalizeSheetSessionRow = (r) =>
  r
    ? {
        ...r,
        rev: Number(r.rev ?? 1),
        workbook_json: r.workbook_json && typeof r.workbook_json === 'object' ? r.workbook_json : {},
        last_saved_at: toIso(r.last_saved_at),
        created_at: toIso(r.created_at),
        updated_at: toIso(r.updated_at),
      }
    : null;

const normalizeSheetCellHistoryRow = (r) =>
  r
    ? {
        ...r,
        rev: Number(r.rev ?? 1),
        created_at: toIso(r.created_at),
      }
    : null;

const normalizeDesktopEditSessionRow = (r) =>
  r
    ? {
        ...r,
        sync_count: Number(r.sync_count ?? 0),
        last_version: Number(r.last_version ?? 1),
        last_synced_at: toIso(r.last_synced_at),
        opened_at: toIso(r.opened_at),
        expires_at: toIso(r.expires_at),
        closed_at: toIso(r.closed_at),
        created_at: toIso(r.created_at),
        updated_at: toIso(r.updated_at),
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
  vpsConnections: [],
  storageNodes: [],
  storageAcls: [],
  storageVersions: [],
  storageTempLinks: [],
  sheetSessions: [],
  sheetCellHistory: [],
  desktopEditSessions: [],
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
      primary_color: '#ed0202',
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
      primary_color: '#ed0202',
      created_at: yesterdayIso,
    },
  ];

  const users = [
    {
      id: '33333333-3333-4333-8333-333333333301',
      tenant_id: 'tenant-ap3htf6',
      name: 'Délcio Farias',
      email: 'ti@shineraybysabel.com.br',
      password_hash: hashPassword('Shineray@2026!'),
      role: 'owner',
      department: 'Tecnologia & Operações',
      job_title: 'Dono & Gestor de TI',
      active: true,
      created_at: yesterdayIso,
    },
  ];

  // Apenas para ambiente de testes de microsserviços (validação de papéis e suíte automatizada)
  if (process.env.NODE_ENV !== 'test') {
    return {
      tenants,
      users,
      assets: [],
      assetHistory: [],
      tickets: [],
      ticketComments: [],
      terms: [],
      auditChain: [],
      telemetry: [],
    };
  }

  users.push(
    {
      id: '33333333-3333-4333-8333-333333333302',
      tenant_id: 'tenant-ap3htf6',
      name: 'João da Silva (Teste)',
      email: 'joao.silva@shineray.com.br',
      password_hash: hashPassword('Colab@2026!'),
      role: 'collaborator',
      department: 'Vendas Concessionária',
      job_title: 'Consultor de Vendas',
      active: true,
      created_at: yesterdayIso,
    },
    {
      id: '33333333-3333-4333-8333-333333333304',
      tenant_id: 'tenant-ap3htf6',
      name: 'Karen Matos (Teste)',
      email: 'karen.matos@shineraybysabel.com.br',
      password_hash: hashPassword('Colab@2026!'),
      role: 'collaborator',
      department: 'Vendas & Pós-Vendas',
      job_title: 'Consultora Comercial',
      active: true,
      created_at: yesterdayIso,
    },
  );

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
  mem.vpsConnections = [];
  mem.storageNodes = [];
  mem.storageAcls = [];
  mem.storageVersions = [];
  mem.storageTempLinks = [];
  mem.sheetSessions = [];
  mem.sheetCellHistory = [];
  mem.desktopEditSessions = [];
  mem.seqCounter = seed.auditChain.length;
}

/**
 * Reconcilia de forma idempotente volumes PostgreSQL já existentes caso tenham
 * sido criados antes da canonicalização de chaves `JSONB`, garantindo que
 * `verify-chain` e `terms/:id/verify` passem 100% sem perda de dados.
 */
async function reconcileProductionShinerayState(client) {
  await client.query('ALTER TABLE auth_svc.users DROP CONSTRAINT IF EXISTS users_role_check');
  await client.query(
    "ALTER TABLE auth_svc.users ADD CONSTRAINT users_role_check CHECK (role IN ('owner', 'admin', 'manager', 'member', 'operator', 'viewer', 'collaborator', 'superadmin'))",
  );

  const seed = buildSeedBundle();
  for (const t of seed.tenants) {
    await client.query(
      `INSERT INTO auth_svc.tenants (id, name, cnpj, plan, asset_prefix, agent_token_hash, status, primary_color, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         cnpj = EXCLUDED.cnpj,
         plan = EXCLUDED.plan,
         asset_prefix = EXCLUDED.asset_prefix,
         primary_color = COALESCE(NULLIF(auth_svc.tenants.primary_color, ''), EXCLUDED.primary_color),
         status = 'active'`,
      [t.id, t.name, t.cnpj, t.plan, t.asset_prefix, t.agent_token_hash, t.status, t.primary_color || '#ed0202', t.created_at],
    );
  }

  await client.query(
    `DELETE FROM telemetry_svc.remote_commands
     WHERE tenant_id IN ('nexus-corp', 'alpha-logistica')
        OR device_key IN ('WKS-SHL-PF3Z881K', 'WKS-SHL-NP550XED', 'SRV-SHL-CORE-01', 'WKS-SHL-LAB-009', 'HACK-01')`,
  );
  await client.query(
    `DELETE FROM telemetry_svc.device_telemetry
     WHERE tenant_id IN ('nexus-corp', 'alpha-logistica')
        OR id IN (
          'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',
          'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02',
          'f078eed6-78ad-45d0-9f09-f52c6c24c00b'
        )
        OR device_key IN ('WKS-SHL-PF3Z881K', 'WKS-SHL-NP550XED', 'SRV-SHL-CORE-01', 'WKS-SHL-LAB-009', 'HACK-01')
        OR ip_address IN ('10.50.12.16', '10.50.12.10', '179.183.250.73')`,
  );
  await client.query(
    `DELETE FROM compliance_svc.audit_chain
     WHERE tenant_id IN ('nexus-corp', 'alpha-logistica')
        OR id = 'ffffffff-ffff-4fff-8fff-ffffffffff01'
        OR resource_id IN (
          'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
          'cccccccc-cccc-4ccc-8ccc-cccccccccc02',
          '16fe4faf-9300-4915-b460-e9f383f227f2',
          '71800026-c9b8-4733-b050-bf094b32a61e',
          'b1448b0f-b52e-40ee-8f73-3f0572e6df1e',
          '0f47fa42-c432-472e-8563-27cc468d8222'
        )
        OR actor_email IN (
          'karen.matos@shineraybysabel.com.br',
          'joao.silva@shineray.com.br',
          'delcio.farias@shineraybysabel.com.br',
          'danillo.portal@shineraybysabel.com.br',
          'dono@shineraybysabel.com.br'
        )`,
  );
  await client.query(
    `DELETE FROM compliance_svc.responsibility_terms
     WHERE tenant_id IN ('nexus-corp', 'alpha-logistica')
        OR id IN (
          'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
          'cccccccc-cccc-4ccc-8ccc-cccccccccc02',
          '16fe4faf-9300-4915-b460-e9f383f227f2',
          '71800026-c9b8-4733-b050-bf094b32a61e',
          'b1448b0f-b52e-40ee-8f73-3f0572e6df1e',
          '0f47fa42-c432-472e-8563-27cc468d8222'
        )
        OR employee_email IN (
          'karen.matos@shineraybysabel.com.br',
          'joao.silva@shineray.com.br',
          'delcio.farias@shineraybysabel.com.br',
          'danillo.portal@shineraybysabel.com.br',
          'dono@shineraybysabel.com.br'
        )
        OR assets_snapshot::text ILIKE '%SHL-BEL-NTB-016%'
        OR assets_snapshot::text ILIKE '%SHL-BEL-NTB-007%'
        OR assets_snapshot::text ILIKE '%SHL-BEL-NTB-002%'`,
  );
  await client.query(
    `DELETE FROM tickets_svc.ticket_comments
     WHERE tenant_id IN ('nexus-corp', 'alpha-logistica')
        OR id IN (
          'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
          'dddddddd-dddd-4ddd-8ddd-dddddddddd02',
          'dddddddd-dddd-4ddd-8ddd-dddddddddd03'
        )
        OR ticket_id IN (
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb04',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05',
          '37f4abed-5c65-4750-86d6-ad3aa40a4d16',
          'f9d2d01c-19d5-4cc4-a705-05b9e1869f3c'
        )
        OR author_email IN (
          'karen.matos@shineraybysabel.com.br',
          'joao.silva@shineray.com.br',
          'delcio.farias@shineraybysabel.com.br',
          'danillo.portal@shineraybysabel.com.br',
          'dono@shineraybysabel.com.br'
        )`,
  );
  await client.query(
    `DELETE FROM tickets_svc.tickets
     WHERE tenant_id IN ('nexus-corp', 'alpha-logistica')
        OR id IN (
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb04',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05',
          '37f4abed-5c65-4750-86d6-ad3aa40a4d16',
          'f9d2d01c-19d5-4cc4-a705-05b9e1869f3c'
        )
        OR protocol IN (
          'CHM-2026-0500',
          'CHM-2026-0501',
          'CHM-2026-0502',
          'CHM-2026-0503',
          'CHM-2026-0504',
          'CHM-2026-9040',
          'CHM-2026-1732'
        )
        OR title ILIKE '%Auditoria de SLA%'
        OR requester_email IN (
          'karen.matos@shineraybysabel.com.br',
          'joao.silva@shineray.com.br',
          'delcio.farias@shineraybysabel.com.br',
          'danillo.portal@shineraybysabel.com.br',
          'dono@shineraybysabel.com.br'
        )`,
  );
  await client.query(
    `DELETE FROM assets_svc.asset_history
     WHERE tenant_id IN ('nexus-corp', 'alpha-logistica')
        OR id = '99999999-9999-4999-8999-999999999901'
        OR asset_id IN (
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa07',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa08',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa09',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12',
          'e2bf2636-981c-463f-8375-0b2c1c61aec5',
          'b213216c-cee8-4ace-9d29-1b9742465e7c'
        )`,
  );
  await client.query(
    `DELETE FROM assets_svc.assets
     WHERE tenant_id IN ('nexus-corp', 'alpha-logistica')
        OR id IN (
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa07',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa08',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa09',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12',
          'e2bf2636-981c-463f-8375-0b2c1c61aec5',
          'b213216c-cee8-4ace-9d29-1b9742465e7c'
        )
        OR model ILIKE '%Auditoria v3%'
        OR assigned_to_email IN (
          'karen.matos@shineraybysabel.com.br',
          'joao.silva@shineray.com.br',
          'delcio.farias@shineraybysabel.com.br'
        )`,
  );
  await client.query(
    `DELETE FROM auth_svc.users
     WHERE tenant_id IN ('nexus-corp', 'alpha-logistica')
        OR email IN (
          'karen.matos@shineraybysabel.com.br',
          'joao.silva@shineray.com.br',
          'delcio.farias@shineraybysabel.com.br',
          'danillo.portal@shineraybysabel.com.br',
          'dono@shineraybysabel.com.br',
          'admin@nexuscorp.com.br',
          'colab@nexuscorp.com.br',
          'mariana.costa@nexuscorp.com.br',
          'suporte@nexuscorp.com.br',
          'ti@alphalogistica.com.br',
          'gestor@alphalog.com.br'
        )`,
  );
  await client.query(
    "DELETE FROM auth_svc.tenants WHERE id IN ('nexus-corp', 'alpha-logistica')",
  );

  for (const u of seed.users) {
    await client.query('DELETE FROM auth_svc.users WHERE id = $1 AND email <> $2', [u.id, u.email]);
    await client.query(
      `INSERT INTO auth_svc.users (id, tenant_id, name, email, password_hash, role, department, job_title, active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (email) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         department = EXCLUDED.department,
         job_title = EXCLUDED.job_title,
         active = TRUE`,
      [u.id, u.tenant_id, u.name, u.email, u.password_hash, u.role, u.department, u.job_title, u.active, u.created_at],
    );
  }
}

async function reconcileCanonicalHashesIfNeeded(client) {
  await reconcileProductionShinerayState(client);

  // Reconcilia elos de auditoria garantindo encadeamento SHA-256 íntegro desde GENESIS_HASH
  const { rows: chainRows } = await client.query(
    `SELECT * FROM compliance_svc.audit_chain
     ORDER BY seq ASC FOR UPDATE`,
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
    if (row.prev_hash !== prev || row.entry_hash !== nextHash) {
      await client.query(
        'UPDATE compliance_svc.audit_chain SET prev_hash = $2, entry_hash = $3 WHERE seq = $1',
        [row.seq, prev, nextHash],
      );
    }
    prev = nextHash;
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
            `INSERT INTO auth_svc.tenants (id, name, cnpj, plan, asset_prefix, agent_token_hash, status, primary_color, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
            [t.id, t.name, t.cnpj, t.plan, t.asset_prefix, t.agent_token_hash, t.status, t.primary_color || '#ed0202', t.created_at],
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
        tenant_plan: t?.plan || 'enterprise',
        tenant_overrides: t?.overrides || {},
        tenant_custom_contract: t?.custom_contract || {},
        asset_prefix: t?.asset_prefix || 'NEX',
        primary_color: t?.primary_color || u.primary_color || '#ed0202',
        logo_url: t?.logo_url || u.logo_url || null,
      };
    }
    const { rows } = await pool.query(
      `SELECT u.*, t.name AS tenant_name, t.status AS tenant_status, t.plan AS tenant_plan,
              t.asset_prefix, t.primary_color, t.logo_url,
              COALESCE(t.overrides, '{}'::jsonb) AS tenant_overrides,
              COALESCE(t.custom_contract, '{}'::jsonb) AS tenant_custom_contract
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
        tenant_plan: t?.plan || 'enterprise',
        tenant_overrides: t?.overrides || {},
        tenant_custom_contract: t?.custom_contract || {},
        asset_prefix: t?.asset_prefix || 'NEX',
        primary_color: t?.primary_color || u.primary_color || '#ed0202',
        logo_url: t?.logo_url || u.logo_url || null,
      };
    }
    if (!isUuid(userId)) return null;
    const { rows } = await pool.query(
      `SELECT u.*, t.name AS tenant_name, t.status AS tenant_status, t.plan AS tenant_plan,
              t.asset_prefix, t.primary_color, t.logo_url,
              COALESCE(t.overrides, '{}'::jsonb) AS tenant_overrides,
              COALESCE(t.custom_contract, '{}'::jsonb) AS tenant_custom_contract
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

  async deleteUser(userId, tenantId) {
    if (!USE_PG) {
      const idx = mem.users.findIndex((u) => u.id === userId && matchTenant(u.tenant_id, tenantId));
      if (idx === -1) {
        const err = new Error('Usuário não encontrado.');
        err.statusCode = 404;
        throw err;
      }
      if (mem.users[idx].role === 'owner') {
        const err = new Error('O perfil de proprietário (owner) não pode ser excluído.');
        err.statusCode = 403;
        throw err;
      }
      const [deleted] = mem.users.splice(idx, 1);
      const { password_hash: _ph, ...safe } = deleted;
      return safe;
    }
    const cleanTenantId = canonicalTenantId(tenantId) || 'tenant-ap3htf6';
    const { rows: existing } = await pool.query(
      `SELECT * FROM auth_svc.users WHERE id = $1 AND (tenant_id = $2 OR tenant_id = $3)`,
      [userId, tenantId, cleanTenantId],
    );
    if (!existing.length) {
      const err = new Error('Usuário não encontrado.');
      err.statusCode = 404;
      throw err;
    }
    if (existing[0].role === 'owner') {
      const err = new Error('O perfil de proprietário (owner) não pode ser excluído.');
      err.statusCode = 403;
      throw err;
    }
    const { rows } = await pool.query(
      `DELETE FROM auth_svc.users WHERE id = $1 RETURNING id, tenant_id, name, email, role, department, job_title, active, created_at`,
      [userId],
    );
    return normalizeUserRow(rows[0]);
  },

  async findTenantUserById(userId, tenantId) {
    if (!USE_PG) {
      const u = mem.users.find((x) => x.id === userId && matchTenant(x.tenant_id, tenantId));
      if (!u) return null;
      const { password_hash: _ph, ...safe } = u;
      return safe;
    }
    if (!isUuid(userId)) return null;
    const cleanTenantId = canonicalTenantId(tenantId) || 'tenant-ap3htf6';
    const { rows } = await pool.query(
      `SELECT id, tenant_id, name, email, role, department, job_title, active, created_at
       FROM auth_svc.users WHERE id = $1 AND (tenant_id = $2 OR tenant_id = $3) LIMIT 1`,
      [userId, tenantId, cleanTenantId],
    );
    return normalizeUserRow(rows[0]);
  },

  async updateUser(userId, tenantId, { name, department, jobTitle, active, password } = {}) {
    if (!USE_PG) {
      const idx = mem.users.findIndex((u) => u.id === userId && matchTenant(u.tenant_id, tenantId));
      if (idx === -1) {
        const err = new Error('Usuário não encontrado.');
        err.statusCode = 404;
        throw err;
      }
      const target = mem.users[idx];
      if (name !== undefined) target.name = String(name).trim() || target.name;
      if (department !== undefined) target.department = String(department).trim() || 'Geral';
      if (jobTitle !== undefined) target.job_title = String(jobTitle).trim() || 'Colaborador';
      if (active !== undefined) target.active = Boolean(active);
      if (password) target.password_hash = hashPassword(password);
      const { password_hash: _ph, ...safe } = target;
      return safe;
    }
    if (!isUuid(userId)) {
      const err = new Error('Identificador de usuário inválido.');
      err.statusCode = 400;
      throw err;
    }
    const existing = await this.findTenantUserById(userId, tenantId);
    if (!existing) {
      const err = new Error('Usuário não encontrado.');
      err.statusCode = 404;
      throw err;
    }
    const sets = [];
    const params = [];
    if (name !== undefined) {
      params.push(String(name).trim() || existing.name);
      sets.push(`name = $${params.length}`);
    }
    if (department !== undefined) {
      params.push(String(department).trim() || 'Geral');
      sets.push(`department = $${params.length}`);
    }
    if (jobTitle !== undefined) {
      params.push(String(jobTitle).trim() || 'Colaborador');
      sets.push(`job_title = $${params.length}`);
    }
    if (active !== undefined) {
      params.push(Boolean(active));
      sets.push(`active = $${params.length}`);
    }
    if (password) {
      params.push(hashPassword(password));
      sets.push(`password_hash = $${params.length}`);
    }
    if (sets.length === 0) return existing;
    params.push(userId);
    const { rows } = await pool.query(
      `UPDATE auth_svc.users SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, tenant_id, name, email, role, department, job_title, active, created_at`,
      params,
    );
    return normalizeUserRow(rows[0]);
  },

  async getTenantContract(tenantId) {
    const tenant = await this.findTenantById(tenantId);
    if (!tenant) return null;
    return {
      tenantId: tenant.id,
      companyName: tenant.name,
      plan: tenant.plan || 'enterprise',
      primaryColor: tenant.primary_color || null,
      logoUrl: tenant.logo_url || null,
      overrides: tenant.overrides && typeof tenant.overrides === 'object' ? tenant.overrides : {},
      customContract: tenant.custom_contract && typeof tenant.custom_contract === 'object' ? tenant.custom_contract : {},
    };
  },

  async updateTenantContract(tenantId, { plan, overrides, customContract, companyName, primaryColor, logoUrl } = {}) {
    if (!USE_PG) {
      const target = mem.tenants.find((t) => matchTenant(t.id, tenantId));
      if (!target) {
        const err = new Error('Empresa não encontrada.');
        err.statusCode = 404;
        throw err;
      }
      if (plan) target.plan = String(plan).toLowerCase();
      if (companyName && String(companyName).trim()) target.name = String(companyName).trim();
      if (primaryColor !== undefined) target.primary_color = primaryColor || null;
      if (logoUrl !== undefined) target.logo_url = logoUrl || null;
      if (overrides !== undefined) target.overrides = overrides || {};
      if (customContract !== undefined) target.custom_contract = customContract || {};
      return {
        tenantId: target.id,
        companyName: target.name,
        plan: target.plan,
        primaryColor: target.primary_color || null,
        logoUrl: target.logo_url || null,
        overrides: target.overrides,
        customContract: target.custom_contract,
      };
    }
    const cleanTenantId = canonicalTenantId(tenantId) || tenantId;
    const { rows } = await pool.query(
      `UPDATE auth_svc.tenants
       SET plan = COALESCE($2, plan),
           overrides = COALESCE($3::jsonb, overrides),
           custom_contract = COALESCE($4::jsonb, custom_contract),
           name = COALESCE(NULLIF($6, ''), name),
           primary_color = CASE WHEN $7::boolean THEN $8 ELSE primary_color END,
           logo_url = CASE WHEN $9::boolean THEN $10 ELSE logo_url END
       WHERE id = $1 OR id = $5
       RETURNING id, name, plan, primary_color, logo_url, overrides, custom_contract`,
      [
        tenantId,
        plan ? String(plan).toLowerCase() : null,
        overrides !== undefined ? JSON.stringify(overrides || {}) : null,
        customContract !== undefined ? JSON.stringify(customContract || {}) : null,
        cleanTenantId,
        companyName ? String(companyName).trim() : null,
        primaryColor !== undefined,
        primaryColor || null,
        logoUrl !== undefined,
        logoUrl || null,
      ],
    );
    if (!rows.length) {
      const err = new Error('Empresa não encontrada.');
      err.statusCode = 404;
      throw err;
    }
    const row = rows[0];
    return {
      tenantId: row.id,
      companyName: row.name,
      plan: row.plan,
      primaryColor: row.primary_color || null,
      logoUrl: row.logo_url || null,
      overrides: row.overrides || {},
      customContract: row.custom_contract || {},
    };
  },
};

// =============================================================================
// 2. Repositório de Ativos (`assets_svc`)
// =============================================================================
const BRAZILIAN_HOLDER_STOP_WORDS = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);
const RETIRED_ASSET_STATUSES = new Set(['baixado', 'descartado', 'vendido']);

function normalizeHolderName(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isMatchingHolderName(name1, name2) {
  const n1 = normalizeHolderName(name1);
  const n2 = normalizeHolderName(name2);
  if (!n1 || !n2) return false;
  if (n1 === n2) return true;

  const words1 = n1.split(' ').filter((w) => w && !BRAZILIAN_HOLDER_STOP_WORDS.has(w));
  const words2 = n2.split(' ').filter((w) => w && !BRAZILIAN_HOLDER_STOP_WORDS.has(w));
  if (words1.length === 0 || words2.length === 0) return false;

  const [shorter, longer] = words1.length <= words2.length ? [words1, words2] : [words2, words1];
  if (shorter.length >= 2) {
    return shorter.every((w) => longer.includes(w));
  }
  if (shorter.length === 1 && shorter[0].length >= 3) {
    return longer[0] === shorter[0];
  }
  return false;
}

/**
 * Verifica se um ativo pertence à custódia de um usuário.
 * - Quando `assigned_to_email` está preenchido, exige igualdade estrita de e-mail
 *   (evita colisão entre homônimos).
 * - Quando `assigned_to_email` está vazio/nulo (ativos legados/sincronizados só por nome),
 *   aplica correspondência segura de nome completo/composto sem acentos.
 */
export function isAssetAssignedToUser(asset, { email, name } = {}) {
  if (!asset) return false;
  const assetEmail = String(asset.assigned_to_email || '').trim().toLowerCase();
  const userEmail = String(email || '').trim().toLowerCase();

  if (assetEmail) {
    return Boolean(userEmail && assetEmail === userEmail);
  }

  const assetName = String(asset.assigned_to_name || '').trim();
  const userName = String(name || '').trim();
  if (!assetName || !userName) return false;
  return isMatchingHolderName(userName, assetName);
}

function resolveUniqueEmailByHolderName(holderName, tenantUsers = []) {
  if (!holderName || !Array.isArray(tenantUsers) || tenantUsers.length === 0) return null;
  const matches = tenantUsers.filter(
    (u) => u && u.email && u.name && isMatchingHolderName(u.name, holderName),
  );
  if (matches.length === 1) {
    return String(matches[0].email).trim().toLowerCase();
  }
  const exact = matches.filter(
    (u) => normalizeHolderName(u.name) === normalizeHolderName(holderName),
  );
  if (exact.length === 1) {
    return String(exact[0].email).trim().toLowerCase();
  }
  return null;
}

export const assetsRepo = {
  async list(tenantId, { status, type, search, assignedToEmail, assignedToName } = {}) {
    if (!USE_PG) {
      return mem.assets
        .filter((a) => {
          if (!matchTenant(a.tenant_id, tenantId)) return false;
          if (
            (assignedToEmail || assignedToName) &&
            !isAssetAssignedToUser(a, { email: assignedToEmail, name: assignedToName })
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
    if (assignedToEmail && assignedToName) {
      params.push(assignedToEmail.toLowerCase());
      clauses.push(
        `(LOWER(assigned_to_email) = $${params.length} OR (COALESCE(TRIM(assigned_to_email), '') = '' AND COALESCE(TRIM(assigned_to_name), '') <> ''))`,
      );
    } else if (assignedToEmail) {
      params.push(assignedToEmail.toLowerCase());
      clauses.push(`LOWER(assigned_to_email) = $${params.length}`);
    } else if (assignedToName) {
      clauses.push(
        `COALESCE(TRIM(assigned_to_email), '') = '' AND COALESCE(TRIM(assigned_to_name), '') <> ''`,
      );
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
    const mapped = rows.map(normalizeAssetRow);
    if (assignedToName) {
      return mapped.filter((row) =>
        isAssetAssignedToUser(row, { email: assignedToEmail, name: assignedToName }),
      );
    }
    return mapped;
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

  async upsertManyByInternalId(tenantId, rawItems = [], actor = {}) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) return [];
    const targetTenantId = canonicalTenantId(tenantId) || tenantId;
    const tenantUsers = await authRepo.listTenantUsers(targetTenantId).catch(() => []);
    const nowIso = new Date().toISOString();

    // Deduplica por tag patrimonial dentro do lote (última ocorrência vence)
    const dedupMap = new Map();
    for (const raw of rawItems) {
      if (!raw || typeof raw !== 'object') continue;
      const internalId = String(raw.internalId || '').trim().toUpperCase().slice(0, 64);
      if (!internalId) continue;

      const status = String(
        raw.status || (raw.assignedToEmail || raw.assignedToName ? 'Em Uso' : 'Disponível'),
      )
        .trim()
        .slice(0, 40) || 'Disponível';
      const retired = RETIRED_ASSET_STATUSES.has(status.toLowerCase());

      const assignedToName = retired
        ? null
        : raw.assignedToName
          ? String(raw.assignedToName).trim().slice(0, 160)
          : null;
      let assignedToEmail = retired
        ? null
        : raw.assignedToEmail
          ? String(raw.assignedToEmail).trim().toLowerCase().slice(0, 180)
          : null;

      if (!retired && !assignedToEmail && assignedToName) {
        assignedToEmail = resolveUniqueEmailByHolderName(assignedToName, tenantUsers);
      }

      const rawVal = Number(raw.purchaseValue ?? 0);
      const purchaseValue = Number.isFinite(rawVal) && rawVal >= 0 ? rawVal : 0;

      dedupMap.set(internalId, {
        internalId,
        type: String(raw.type || 'Equipamento').trim().slice(0, 64) || 'Equipamento',
        brand: String(raw.brand || 'Geral').trim().slice(0, 80) || 'Geral',
        model: String(raw.model || 'Equipamento').trim().slice(0, 120) || 'Equipamento',
        serialNumber: raw.serialNumber ? String(raw.serialNumber).trim().slice(0, 120) : null,
        status,
        location: String(raw.location || 'Matriz - TI').trim().slice(0, 120) || 'Matriz - TI',
        department: String(raw.department || 'Estoque TI').trim().slice(0, 120) || 'Estoque TI',
        assignedToName,
        assignedToEmail,
        purchaseValue,
        specs: raw.specs && typeof raw.specs === 'object' && !Array.isArray(raw.specs) ? raw.specs : {},
      });
    }

    const items = Array.from(dedupMap.values());
    if (items.length === 0) return [];

    if (!USE_PG) {
      const results = [];
      for (const item of items) {
        const idx = mem.assets.findIndex(
          (a) => matchTenant(a.tenant_id, targetTenantId) && a.internal_id.toUpperCase() === item.internalId,
        );
        if (idx >= 0) {
          const existing = mem.assets[idx];
          const updated = {
            ...existing,
            type: item.type,
            brand: item.brand,
            model: item.model,
            serial_number: item.serialNumber ?? existing.serial_number,
            status: item.status,
            location: item.location,
            department: item.department,
            assigned_to_name: item.assignedToName,
            assigned_to_email: item.assignedToEmail,
            purchase_value: item.purchaseValue,
            specs: { ...(existing.specs || {}), ...item.specs },
            updated_at: nowIso,
          };
          mem.assets[idx] = updated;
          results.push(updated);
        } else {
          const created = {
            id: crypto.randomUUID(),
            tenant_id: targetTenantId,
            internal_id: item.internalId,
            type: item.type,
            brand: item.brand,
            model: item.model,
            serial_number: item.serialNumber,
            status: item.status,
            location: item.location,
            department: item.department,
            assigned_to_name: item.assignedToName,
            assigned_to_email: item.assignedToEmail,
            purchase_value: item.purchaseValue,
            specs: item.specs,
            created_at: nowIso,
            updated_at: nowIso,
          };
          mem.assets.push(created);
          mem.assetHistory.push({
            id: crypto.randomUUID(),
            tenant_id: targetTenantId,
            asset_id: created.id,
            action: 'ATIVO_SINCRONIZADO',
            actor_name: actor.name || actor.email || 'Sistema',
            actor_email: actor.email || null,
            details: `Ativo ${created.internal_id} (${created.brand} ${created.model}) sincronizado com o Portal.`,
            created_at: nowIso,
          });
          results.push(created);
        }
      }
      return results;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const results = [];
      for (const item of items) {
        const { rows } = await client.query(
          `INSERT INTO assets_svc.assets
           (tenant_id, internal_id, type, brand, model, serial_number, status, location, department, assigned_to_name, assigned_to_email, purchase_value, specs)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
           ON CONFLICT (tenant_id, internal_id) DO UPDATE SET
             type = EXCLUDED.type,
             brand = EXCLUDED.brand,
             model = EXCLUDED.model,
             serial_number = COALESCE(EXCLUDED.serial_number, assets_svc.assets.serial_number),
             status = EXCLUDED.status,
             location = EXCLUDED.location,
             department = EXCLUDED.department,
             assigned_to_name = EXCLUDED.assigned_to_name,
             assigned_to_email = EXCLUDED.assigned_to_email,
             purchase_value = EXCLUDED.purchase_value,
             specs = COALESCE(assets_svc.assets.specs, '{}'::jsonb) || EXCLUDED.specs,
             updated_at = NOW()
           RETURNING *`,
          [
            targetTenantId,
            item.internalId,
            item.type,
            item.brand,
            item.model,
            item.serialNumber,
            item.status,
            item.location,
            item.department,
            item.assignedToName,
            item.assignedToEmail,
            item.purchaseValue,
            JSON.stringify(item.specs || {}),
          ],
        );
        if (rows[0]) {
          results.push(normalizeAssetRow(rows[0]));
        }
      }
      await client.query('COMMIT');
      return results;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
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
        .map((t) => {
          const comments = mem.ticketComments
            .filter((c) => c.ticket_id === t.id)
            .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
          const lastComment = comments[comments.length - 1] || null;
          const attachmentsCount =
            (Array.isArray(t.attachments) ? t.attachments.length : 0) +
            comments.reduce(
              (acc, cm) => acc + (Array.isArray(cm.attachments) ? cm.attachments.length : 0),
              0,
            );
          const { attachments: _omitListAttachments, ...rest } = t;
          return {
            ...rest,
            attachments_count: attachmentsCount,
            comments_count: comments.length,
            last_message_at: lastComment ? lastComment.created_at : null,
            last_message_preview: lastComment
              ? String(lastComment.message || '').trim() ||
                (lastComment.attachments?.length ? '📷 Imagem anexada' : '')
              : '',
          };
        })
        .sort((a, b) =>
          String(b.last_message_at || b.updated_at || b.created_at).localeCompare(
            String(a.last_message_at || a.updated_at || a.created_at),
          ),
        );
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
      `SELECT t.id, t.protocol, t.tenant_id, t.requester_name, t.requester_email,
              t.department, t.asset_id, t.asset_tag, t.category, t.priority,
              t.status, t.title, t.description, t.assigned_tech_name,
              t.resolution_notes, t.sla_due_at, t.resolved_at,
              t.created_at, t.updated_at,
              COALESCE(jsonb_array_length(t.attachments), 0)::int
                + COALESCE((SELECT SUM(jsonb_array_length(c.attachments)) FROM tickets_svc.ticket_comments c WHERE c.ticket_id = t.id), 0)::int AS attachments_count,
              (SELECT COUNT(*)::int FROM tickets_svc.ticket_comments c WHERE c.ticket_id = t.id) AS comments_count,
              (SELECT c.created_at FROM tickets_svc.ticket_comments c WHERE c.ticket_id = t.id ORDER BY c.created_at DESC LIMIT 1) AS last_message_at,
              (SELECT COALESCE(
                        NULLIF(TRIM(c.message), ''),
                        CASE WHEN jsonb_array_length(c.attachments) > 0 THEN '📷 Imagem anexada' ELSE '' END
                      )
               FROM tickets_svc.ticket_comments c
               WHERE c.ticket_id = t.id
               ORDER BY c.created_at DESC
               LIMIT 1) AS last_message_preview
       FROM tickets_svc.tickets t
       WHERE ${clauses.join(' AND ')}
       ORDER BY GREATEST(
         t.updated_at,
         COALESCE((SELECT MAX(c.created_at) FROM tickets_svc.ticket_comments c WHERE c.ticket_id = t.id), t.created_at)
       ) DESC`,
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
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .map(normalizeCommentRow);
      return {
        ...normalizeTicketRow(tk),
        attachments: normalizeAttachmentArray(tk.attachments),
        comments,
      };
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
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];

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
        attachments,
        assigned_tech_name: null,
        resolution_notes: null,
        sla_due_at: slaDueIso,
        resolved_at: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      };
      mem.tickets.push(created);
      return normalizeTicketRow(created);
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const protocol = generateTicketProtocol(now, attempt);
      try {
        const { rows } = await pool.query(
          `INSERT INTO tickets_svc.tickets
           (protocol, tenant_id, requester_name, requester_email, department, asset_id, asset_tag, category, priority, status, title, description, attachments, sla_due_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10,$11,$12::jsonb,$13)
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
            JSON.stringify(attachments),
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

  async addComment(tenantId, ticketId, author, message, attachments = []) {
    const nowIso = new Date().toISOString();
    const cleanMessage = message ?? '';
    const cleanAttachments = Array.isArray(attachments) ? attachments : [];
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
        message: cleanMessage,
        attachments: cleanAttachments,
        created_at: nowIso,
      };
      mem.ticketComments.push(cm);
      tk.updated_at = nowIso;
      return normalizeCommentRow(cm);
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
       (ticket_id, tenant_id, author_name, author_email, author_role, message, attachments)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
      [
        ticketId,
        tenantId,
        author.name || author.email,
        author.email.toLowerCase(),
        author.role,
        cleanMessage,
        JSON.stringify(cleanAttachments),
      ],
    );
    await pool.query('UPDATE tickets_svc.tickets SET updated_at = NOW() WHERE id = $1', [ticketId]);
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

  async delete(tenantId, ticketId) {
    if (!USE_PG) {
      const idx = mem.tickets.findIndex(
        (t) => t.id === ticketId && matchTenant(t.tenant_id, tenantId),
      );
      if (idx === -1) return null;
      const [removed] = mem.tickets.splice(idx, 1);
      mem.ticketComments = mem.ticketComments.filter((c) => c.ticket_id !== ticketId);
      return removed;
    }

    if (!isUuid(ticketId)) return null;
    const clean = canonicalTenantId(tenantId);
    const { rows } = await pool.query(
      'DELETE FROM tickets_svc.tickets WHERE id = $1 AND (tenant_id = $2 OR tenant_id = $3) RETURNING *',
      [ticketId, tenantId, clean],
    );
    return normalizeTicketRow(rows[0]);
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

  async deleteTerm(tenantId, termId) {
    const clean = canonicalTenantId(tenantId);
    if (!USE_PG) {
      const idx = mem.terms.findIndex(
        (t) => t.id === termId && matchTenant(t.tenant_id, tenantId),
      );
      if (idx === -1) return null;
      const [removed] = mem.terms.splice(idx, 1);
      mem.auditChain = mem.auditChain.filter(
        (e) => !(matchTenant(e.tenant_id, tenantId) && String(e.resource_id) === String(termId)),
      );
      let expectedPrev = GENESIS_HASH;
      const tenantChain = mem.auditChain
        .filter((e) => matchTenant(e.tenant_id, tenantId))
        .sort((a, b) => a.seq - b.seq);
      for (const row of tenantChain) {
        row.prev_hash = expectedPrev;
        row.entry_hash = computeAuditChainHash({
          prevHash: expectedPrev,
          tenantId: row.tenant_id,
          actorEmail: row.actor_email,
          actorRole: row.actor_role,
          action: row.action,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          payload: row.payload || {},
          createdAtIso: toIso(row.created_at),
        });
        expectedPrev = row.entry_hash;
      }
      return removed;
    }

    if (!isUuid(termId)) return null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(202603, hashtext($1))', [clean]);
      const { rows } = await client.query(
        'DELETE FROM compliance_svc.responsibility_terms WHERE id = $1 AND (tenant_id = $2 OR tenant_id = $3) RETURNING *',
        [termId, tenantId, clean],
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(
        'DELETE FROM compliance_svc.audit_chain WHERE resource_id = $1 AND (tenant_id = $2 OR tenant_id = $3)',
        [String(termId), tenantId, clean],
      );
      const chainRes = await client.query(
        'SELECT * FROM compliance_svc.audit_chain WHERE (tenant_id = $1 OR tenant_id = $2) ORDER BY seq ASC',
        [tenantId, clean],
      );
      let expectedPrev = GENESIS_HASH;
      for (const row of chainRes.rows) {
        const createdIso = toIso(row.created_at);
        const recomputed = computeAuditChainHash({
          prevHash: expectedPrev,
          tenantId: row.tenant_id,
          actorEmail: row.actor_email,
          actorRole: row.actor_role,
          action: row.action,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          payload: row.payload || {},
          createdAtIso: createdIso,
        });
        if (row.prev_hash !== expectedPrev || row.entry_hash !== recomputed) {
          await client.query(
            'UPDATE compliance_svc.audit_chain SET prev_hash = $2, entry_hash = $3 WHERE seq = $1',
            [row.seq, expectedPrev, recomputed],
          );
        }
        expectedPrev = recomputed;
      }
      await client.query('COMMIT');
      return normalizeTermRow(rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
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

// =============================================================================
// 6. Repositório de Armazenamento Corporativo & Planilhas (`storage_svc`)
// =============================================================================
const DEFAULT_QUOTA_BYTES = 107_374_182_400; // 100 GiB

const requireCleanTenantId = (tenantId) => {
  const clean = canonicalTenantId(String(tenantId || '').trim());
  if (!clean) {
    const err = new Error('Identificador de empresa (tenant_id) obrigatório.');
    err.statusCode = 400;
    err.code = 'TENANT_ID_REQUIRED';
    throw err;
  }
  return clean;
};

const normalizeVirtualPathValue = (rawPath) => {
  const trimmed = String(rawPath || '/').trim();
  if (!trimmed || trimmed === '/') return '/';
  const parts = trimmed.split('/').filter(Boolean);
  return parts.length === 0 ? '/' : `/${parts.join('/')}`;
};

const computeAlertLevel = (usedBytes, quotaBytes) => {
  if (quotaBytes <= 0) return usedBytes > 0 ? 'exceeded' : 'ok';
  if (usedBytes > quotaBytes) return 'exceeded';
  const pct = (usedBytes / quotaBytes) * 100;
  if (pct >= 90) return 'critical_90';
  if (pct >= 80) return 'warning_80';
  return 'ok';
};

export const storageRepo = {
  // ---------------------------------------------------------------------------
  // 6.1 VPS Connections
  // ---------------------------------------------------------------------------
  async getConnection(tenantId) {
    const clean = requireCleanTenantId(tenantId);
    if (!USE_PG) {
      const row = mem.vpsConnections.find((c) => matchTenant(c.tenant_id, clean));
      return row ? normalizeVpsConnectionRow({ ...row }) : null;
    }
    const { rows } = await pool.query(
      'SELECT * FROM storage_svc.vps_connections WHERE tenant_id = $1 LIMIT 1',
      [clean],
    );
    return normalizeVpsConnectionRow(rows[0]);
  },

  async upsertConnection(tenantId, payload) {
    const clean = requireCleanTenantId(tenantId);
    const nowIso = new Date().toISOString();
    const hasProvider = payload.providerType !== undefined || payload.provider_type !== undefined;
    const hasLabel = payload.label !== undefined;
    const hasHost = payload.host !== undefined;
    const hasPort = payload.port !== undefined;
    const hasUsername = payload.username !== undefined;
    const hasRootPath = payload.rootPath !== undefined || payload.root_path !== undefined;
    const hasEndpointUrl = payload.endpointUrl !== undefined || payload.endpoint_url !== undefined;
    const hasBucket = payload.bucket !== undefined;
    const hasRegion = payload.region !== undefined;
    const encryptedCredentials = payload.encryptedCredentials ?? payload.encrypted_credentials;
    const hasQuota = payload.quotaBytes !== undefined || payload.quota_bytes !== undefined;
    const rawQuota = payload.quotaBytes !== undefined ? payload.quotaBytes : payload.quota_bytes;
    const hasStatus = payload.status !== undefined;

    let validatedPort;
    if (hasPort) {
      if (payload.port === null) {
        validatedPort = null;
      } else {
        const isValidType =
          typeof payload.port === 'number' ||
          (typeof payload.port === 'string' && payload.port.trim() !== '');
        const parsedPort = isValidType ? Number(payload.port) : NaN;
        if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
          const err = new Error('Porta inválida: deve ser um inteiro entre 1 e 65535.');
          err.statusCode = 400;
          err.code = 'INVALID_PORT';
          throw err;
        }
        validatedPort = parsedPort;
      }
    }

    let validatedQuota;
    if (hasQuota) {
      const isValidType =
        typeof rawQuota === 'number' ||
        (typeof rawQuota === 'string' && rawQuota.trim() !== '');
      const parsedQuota = isValidType ? Number(rawQuota) : NaN;
      if (!Number.isFinite(parsedQuota) || !Number.isInteger(parsedQuota) || parsedQuota < 0) {
        const err = new Error('quotaBytes inválido: deve ser um inteiro não negativo.');
        err.statusCode = 400;
        err.code = 'INVALID_QUOTA_BYTES';
        throw err;
      }
      validatedQuota = parsedQuota;
    }

    const mergeConnectionPayload = (existing) => {
      const providerType = hasProvider
        ? String(payload.providerType ?? payload.provider_type ?? '').trim() || existing?.provider_type || 'sftp'
        : existing?.provider_type || 'sftp';
      const label = hasLabel
        ? (payload.label === null ? null : String(payload.label || '').trim() || null)
        : (existing?.label ?? null);
      const host = hasHost
        ? (payload.host === null ? null : String(payload.host || '').trim() || null)
        : (existing?.host ?? null);
      const port = hasPort ? validatedPort : (existing?.port ?? null);
      const username = hasUsername
        ? (payload.username === null ? null : String(payload.username || '').trim() || null)
        : (existing?.username ?? null);
      const rootPath = hasRootPath
        ? String(payload.rootPath ?? payload.root_path ?? '').trim() || existing?.root_path || '/srv/nexus-vault'
        : (existing?.root_path || '/srv/nexus-vault');
      const endpointUrl = hasEndpointUrl
        ? String(payload.endpointUrl ?? payload.endpoint_url ?? '').trim() || null
        : (existing?.endpoint_url ?? null);
      const bucket = hasBucket
        ? (payload.bucket === null ? null : String(payload.bucket || '').trim() || null)
        : (existing?.bucket ?? null);
      const region = hasRegion
        ? (payload.region === null ? null : String(payload.region || '').trim() || null)
        : (existing?.region ?? null);
      const finalCreds =
        encryptedCredentials !== undefined && encryptedCredentials !== null
          ? String(encryptedCredentials)
          : existing?.encrypted_credentials;
      const quotaBytes = hasQuota
        ? validatedQuota
        : (existing?.quota_bytes ?? DEFAULT_QUOTA_BYTES);
      const status = hasStatus
        ? String(payload.status || 'pending').trim() || 'pending'
        : (existing?.status || 'pending');

      return {
        provider_type: providerType,
        label,
        host,
        port,
        username,
        root_path: rootPath,
        endpoint_url: endpointUrl,
        bucket,
        region,
        encrypted_credentials: finalCreds,
        quota_bytes: quotaBytes,
        status,
      };
    };

    if (!USE_PG) {
      const idx = mem.vpsConnections.findIndex((c) => matchTenant(c.tenant_id, clean));
      if (idx >= 0) {
        const prev = mem.vpsConnections[idx];
        const merged = mergeConnectionPayload(prev);
        const next = {
          ...prev,
          ...merged,
          tenant_id: clean,
          updated_at: nowIso,
        };
        mem.vpsConnections[idx] = next;
        return normalizeVpsConnectionRow({ ...next });
      }
      const merged = mergeConnectionPayload(null);
      if (!merged.encrypted_credentials) {
        const err = new Error('Credenciais cifradas são obrigatórias ao configurar conexão VPS.');
        err.statusCode = 400;
        throw err;
      }
      const created = {
        id: crypto.randomUUID(),
        tenant_id: clean,
        ...merged,
        used_bytes: 0,
        last_check_at: null,
        last_error: null,
        latency_ms: null,
        free_bytes: null,
        total_bytes: null,
        initialized_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      };
      mem.vpsConnections.push(created);
      return normalizeVpsConnectionRow({ ...created });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(202605, hashtext($1))', [clean]);
      const existingRes = await client.query(
        'SELECT * FROM storage_svc.vps_connections WHERE tenant_id = $1 FOR UPDATE',
        [clean],
      );
      const existing = existingRes.rows[0] || null;
      const merged = mergeConnectionPayload(existing);
      if (!merged.encrypted_credentials) {
        const err = new Error('Credenciais cifradas são obrigatórias ao configurar conexão VPS.');
        err.statusCode = 400;
        throw err;
      }

      const { rows } = await client.query(
        `INSERT INTO storage_svc.vps_connections
         (tenant_id, provider_type, label, host, port, username, root_path, endpoint_url, bucket, region, encrypted_credentials, quota_bytes, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (tenant_id) DO UPDATE SET
           provider_type = EXCLUDED.provider_type,
           label = EXCLUDED.label,
           host = EXCLUDED.host,
           port = EXCLUDED.port,
           username = EXCLUDED.username,
           root_path = EXCLUDED.root_path,
           endpoint_url = EXCLUDED.endpoint_url,
           bucket = EXCLUDED.bucket,
           region = EXCLUDED.region,
           encrypted_credentials = EXCLUDED.encrypted_credentials,
           quota_bytes = EXCLUDED.quota_bytes,
           status = EXCLUDED.status,
           updated_at = NOW()
         RETURNING *`,
        [
          clean,
          merged.provider_type,
          merged.label,
          merged.host,
          merged.port,
          merged.username,
          merged.root_path,
          merged.endpoint_url,
          merged.bucket,
          merged.region,
          merged.encrypted_credentials,
          merged.quota_bytes,
          merged.status,
        ],
      );
      await client.query('COMMIT');
      return normalizeVpsConnectionRow(rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async updateConnectionStatus(
    tenantId,
    { status, lastError, latencyMs, freeBytes, totalBytes, initializedAt, lastCheckAt } = {},
  ) {
    const clean = requireCleanTenantId(tenantId);
    const nowIso = new Date().toISOString();
    const checkIso = lastCheckAt ? toIso(lastCheckAt) : nowIso;
    const hasLastError = lastError !== undefined;
    const normalizedLastError = hasLastError ? (lastError === null ? null : String(lastError)) : null;
    const hasLatency = latencyMs !== undefined;
    const normalizedLatency = hasLatency
      ? latencyMs === null
        ? null
        : Math.round(Number(latencyMs))
      : null;
    const hasFreeBytes = freeBytes !== undefined;
    const normalizedFreeBytes = hasFreeBytes
      ? freeBytes === null
        ? null
        : Math.round(Number(freeBytes))
      : null;
    const hasTotalBytes = totalBytes !== undefined;
    const normalizedTotalBytes = hasTotalBytes
      ? totalBytes === null
        ? null
        : Math.round(Number(totalBytes))
      : null;
    const hasInitializedAt = initializedAt !== undefined;
    const normalizedInitializedAt = hasInitializedAt ? toIso(initializedAt) : null;

    if (!USE_PG) {
      const idx = mem.vpsConnections.findIndex((c) => matchTenant(c.tenant_id, clean));
      if (idx === -1) return null;
      const prev = mem.vpsConnections[idx];
      const next = {
        ...prev,
        status: status !== undefined ? status : prev.status,
        last_error: hasLastError ? normalizedLastError : prev.last_error,
        latency_ms: hasLatency ? normalizedLatency : prev.latency_ms,
        free_bytes: hasFreeBytes ? normalizedFreeBytes : prev.free_bytes,
        total_bytes: hasTotalBytes ? normalizedTotalBytes : prev.total_bytes,
        initialized_at: hasInitializedAt ? normalizedInitializedAt : prev.initialized_at,
        last_check_at: checkIso,
        updated_at: nowIso,
      };
      mem.vpsConnections[idx] = next;
      return normalizeVpsConnectionRow({ ...next });
    }

    const { rows } = await pool.query(
      `UPDATE storage_svc.vps_connections
       SET status = COALESCE($2, status),
           last_error = CASE WHEN $3::boolean THEN $4::text ELSE last_error END,
           latency_ms = CASE WHEN $5::boolean THEN $6::int ELSE latency_ms END,
           free_bytes = CASE WHEN $7::boolean THEN $8::bigint ELSE free_bytes END,
           total_bytes = CASE WHEN $9::boolean THEN $10::bigint ELSE total_bytes END,
           initialized_at = CASE WHEN $11::boolean THEN $12::timestamptz ELSE initialized_at END,
           last_check_at = $13::timestamptz,
           updated_at = NOW()
       WHERE tenant_id = $1
       RETURNING *`,
      [
        clean,
        status ?? null,
        hasLastError,
        normalizedLastError,
        hasLatency,
        normalizedLatency,
        hasFreeBytes,
        normalizedFreeBytes,
        hasTotalBytes,
        normalizedTotalBytes,
        hasInitializedAt,
        normalizedInitializedAt,
        checkIso,
      ],
    );
    return normalizeVpsConnectionRow(rows[0]);
  },

  async deleteConnection(tenantId) {
    const clean = requireCleanTenantId(tenantId);
    if (!USE_PG) {
      const idx = mem.vpsConnections.findIndex((c) => matchTenant(c.tenant_id, clean));
      if (idx === -1) return null;
      const [removed] = mem.vpsConnections.splice(idx, 1);
      return normalizeVpsConnectionRow({ ...removed });
    }
    const { rows } = await pool.query(
      'DELETE FROM storage_svc.vps_connections WHERE tenant_id = $1 RETURNING *',
      [clean],
    );
    return normalizeVpsConnectionRow(rows[0]);
  },

  // ---------------------------------------------------------------------------
  // 6.2 Atomic Quotas
  // ---------------------------------------------------------------------------
  async reserveQuota(tenantId, deltaBytes) {
    const clean = requireCleanTenantId(tenantId);
    const delta = Math.round(Number(deltaBytes));
    if (!Number.isFinite(delta) || delta < 0) {
      const err = new Error('deltaBytes inválido para reserva de cota.');
      err.statusCode = 400;
      throw err;
    }

    if (!USE_PG) {
      const idx = mem.vpsConnections.findIndex((c) => matchTenant(c.tenant_id, clean));
      if (idx === -1) {
        const err = new Error('Conexão VPS não configurada para este tenant.');
        err.statusCode = 404;
        err.code = 'CONNECTION_NOT_CONFIGURED';
        throw err;
      }
      const conn = mem.vpsConnections[idx];
      if (conn.used_bytes + delta > conn.quota_bytes) {
        const err = new Error('Cota de armazenamento da empresa excedida.');
        err.statusCode = 413;
        err.code = 'QUOTA_EXCEEDED';
        throw err;
      }
      const next = {
        ...conn,
        used_bytes: conn.used_bytes + delta,
        updated_at: new Date().toISOString(),
      };
      mem.vpsConnections[idx] = next;
      return normalizeVpsConnectionRow({ ...next });
    }

    const { rows } = await pool.query(
      `UPDATE storage_svc.vps_connections
       SET used_bytes = used_bytes + $2,
           updated_at = NOW()
       WHERE tenant_id = $1 AND used_bytes + $2 <= quota_bytes
       RETURNING *`,
      [clean, delta],
    );
    if (!rows[0]) {
      const conn = await this.getConnection(clean);
      if (!conn) {
        const err = new Error('Conexão VPS não configurada para este tenant.');
        err.statusCode = 404;
        err.code = 'CONNECTION_NOT_CONFIGURED';
        throw err;
      }
      const err = new Error('Cota de armazenamento da empresa excedida.');
      err.statusCode = 413;
      err.code = 'QUOTA_EXCEEDED';
      throw err;
    }
    return normalizeVpsConnectionRow(rows[0]);
  },

  async releaseQuota(tenantId, deltaBytes) {
    const clean = requireCleanTenantId(tenantId);
    const release = Math.max(0, Math.round(Number(deltaBytes || 0)));

    if (!USE_PG) {
      const idx = mem.vpsConnections.findIndex((c) => matchTenant(c.tenant_id, clean));
      if (idx === -1) return null;
      const conn = mem.vpsConnections[idx];
      const next = {
        ...conn,
        used_bytes: Math.max(0, Number(conn.used_bytes || 0) - release),
        updated_at: new Date().toISOString(),
      };
      mem.vpsConnections[idx] = next;
      return normalizeVpsConnectionRow({ ...next });
    }

    const { rows } = await pool.query(
      `UPDATE storage_svc.vps_connections
       SET used_bytes = GREATEST(0, used_bytes - $2),
           updated_at = NOW()
       WHERE tenant_id = $1
       RETURNING *`,
      [clean, release],
    );
    return normalizeVpsConnectionRow(rows[0]);
  },

  async recalculateUsedBytes(tenantId) {
    const clean = requireCleanTenantId(tenantId);
    if (!USE_PG) {
      const total = mem.storageNodes
        .filter((n) => matchTenant(n.tenant_id, clean))
        .reduce((acc, n) => acc + Number(n.size_bytes || 0), 0);
      const idx = mem.vpsConnections.findIndex((c) => matchTenant(c.tenant_id, clean));
      if (idx === -1) return null;
      const next = {
        ...mem.vpsConnections[idx],
        used_bytes: total,
        updated_at: new Date().toISOString(),
      };
      mem.vpsConnections[idx] = next;
      return normalizeVpsConnectionRow({ ...next });
    }

    const { rows } = await pool.query(
      `UPDATE storage_svc.vps_connections vc
       SET used_bytes = COALESCE((
             SELECT SUM(sn.size_bytes) FROM storage_svc.storage_nodes sn WHERE sn.tenant_id = $1
           ), 0),
           updated_at = NOW()
       WHERE vc.tenant_id = $1
       RETURNING *`,
      [clean],
    );
    return normalizeVpsConnectionRow(rows[0]);
  },

  async getQuotaSummary(tenantId) {
    const clean = requireCleanTenantId(tenantId);
    const conn = await this.getConnection(clean);
    const quotaBytes = conn ? conn.quota_bytes : 0;
    const usedBytes = conn ? conn.used_bytes : 0;
    const usagePercent =
      quotaBytes > 0 ? Number(((usedBytes / quotaBytes) * 100).toFixed(2)) : usedBytes > 0 ? 100 : 0;

    let byDepartment = [];
    if (!USE_PG) {
      const deptMap = new Map();
      for (const n of mem.storageNodes) {
        if (!matchTenant(n.tenant_id, clean)) continue;
        const dept = n.department_scope || 'Geral';
        deptMap.set(dept, (deptMap.get(dept) || 0) + Number(n.size_bytes || 0));
      }
      byDepartment = Array.from(deptMap.entries()).map(([department, bytes]) => ({
        department,
        bytes,
      }));
    } else {
      const { rows } = await pool.query(
        `SELECT COALESCE(department_scope, 'Geral') AS department,
                COALESCE(SUM(size_bytes), 0) AS bytes
         FROM storage_svc.storage_nodes
         WHERE tenant_id = $1
         GROUP BY COALESCE(department_scope, 'Geral')
         ORDER BY bytes DESC`,
        [clean],
      );
      byDepartment = rows.map((r) => ({ department: r.department, bytes: Number(r.bytes || 0) }));
    }

    return {
      quotaBytes,
      usedBytes,
      usagePercent,
      alertLevel: computeAlertLevel(usedBytes, quotaBytes),
      byDepartment,
    };
  },

  // ---------------------------------------------------------------------------
  // 6.3 Storage Nodes (VFS)
  // ---------------------------------------------------------------------------
  async createNode(tenantId, data) {
    const clean = requireCleanTenantId(tenantId);
    const nowIso = new Date().toISOString();
    const virtualPath = normalizeVirtualPathValue(data.virtualPath ?? data.virtual_path);
    const parentId = data.parentId ?? data.parent_id ?? null;
    const name = String(data.name || '').trim();
    const nodeType = String(data.nodeType ?? data.node_type ?? 'file').trim();
    const mimeType = data.mimeType ?? data.mime_type ?? null;
    const sizeBytes = Math.max(0, Math.round(Number(data.sizeBytes ?? data.size_bytes ?? 0)));
    const sha256Hash = data.sha256Hash ?? data.sha256_hash ?? null;
    const currentVersion = Math.max(1, Math.round(Number(data.currentVersion ?? data.current_version ?? 1)));
    const departmentScope = data.departmentScope ?? data.department_scope ?? null;
    const createdByEmail = data.createdByEmail ?? data.created_by_email ?? null;
    const updatedByEmail = data.updatedByEmail ?? data.updated_by_email ?? createdByEmail;

    if (parentId !== null && !isUuid(parentId)) {
      const err = new Error('parent_id inválido.');
      err.statusCode = 400;
      err.code = 'INVALID_PARENT_NODE';
      throw err;
    }

    if (!USE_PG) {
      if (parentId !== null) {
        const parentNode = mem.storageNodes.find(
          (n) => n.id === parentId && matchTenant(n.tenant_id, clean),
        );
        if (!parentNode) {
          const err = new Error('Pasta pai não encontrada para este tenant.');
          err.statusCode = 404;
          err.code = 'INVALID_PARENT_NODE';
          throw err;
        }
        if (parentNode.is_trashed) {
          const err = new Error('Não é possível criar item dentro de uma pasta na lixeira.');
          err.statusCode = 400;
          err.code = 'INVALID_PARENT_NODE';
          throw err;
        }
        if (parentNode.node_type !== 'folder') {
          const err = new Error('O nó pai deve ser uma pasta.');
          err.statusCode = 400;
          err.code = 'INVALID_PARENT_NODE';
          throw err;
        }
      }

      const conflict = mem.storageNodes.find(
        (n) => matchTenant(n.tenant_id, clean) && !n.is_trashed && n.virtual_path === virtualPath,
      );
      if (conflict) {
        const err = new Error(`Já existe um item ativo no caminho '${virtualPath}'.`);
        err.statusCode = 409;
        err.code = 'PATH_ALREADY_EXISTS';
        throw err;
      }
      const created = {
        id: data.id && isUuid(data.id) ? data.id : crypto.randomUUID(),
        tenant_id: clean,
        parent_id: parentId,
        name,
        node_type: nodeType,
        virtual_path: virtualPath,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        sha256_hash: sha256Hash,
        current_version: currentVersion,
        department_scope: departmentScope,
        locked_by_email: null,
        locked_at: null,
        is_trashed: false,
        trashed_at: null,
        trashed_by_email: null,
        original_parent_id: null,
        original_virtual_path: null,
        trash_key: null,
        created_by_email: createdByEmail,
        updated_by_email: updatedByEmail,
        created_at: nowIso,
        updated_at: nowIso,
      };
      mem.storageNodes.push(created);
      return normalizeStorageNodeRow({ ...created });
    }

    if (parentId !== null) {
      const parentRes = await pool.query(
        'SELECT id, node_type, is_trashed FROM storage_svc.storage_nodes WHERE id = $1 AND tenant_id = $2 LIMIT 1',
        [parentId, clean],
      );
      const parentRow = parentRes.rows[0];
      if (!parentRow) {
        const err = new Error('Pasta pai não encontrada para este tenant.');
        err.statusCode = 404;
        err.code = 'INVALID_PARENT_NODE';
        throw err;
      }
      if (parentRow.is_trashed) {
        const err = new Error('Não é possível criar item dentro de uma pasta na lixeira.');
        err.statusCode = 400;
        err.code = 'INVALID_PARENT_NODE';
        throw err;
      }
      if (parentRow.node_type !== 'folder') {
        const err = new Error('O nó pai deve ser uma pasta.');
        err.statusCode = 400;
        err.code = 'INVALID_PARENT_NODE';
        throw err;
      }
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO storage_svc.storage_nodes
         (tenant_id, parent_id, name, node_type, virtual_path, mime_type, size_bytes, sha256_hash, current_version, department_scope, created_by_email, updated_by_email)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          clean,
          parentId,
          name,
          nodeType,
          virtualPath,
          mimeType,
          sizeBytes,
          sha256Hash,
          currentVersion,
          departmentScope,
          createdByEmail,
          updatedByEmail,
        ],
      );
      return normalizeStorageNodeRow(rows[0]);
    } catch (e) {
      if (e.code === '23505') {
        const err = new Error(`Já existe um item ativo no caminho '${virtualPath}'.`);
        err.statusCode = 409;
        err.code = 'PATH_ALREADY_EXISTS';
        throw err;
      }
      throw e;
    }
  },

  async getNodeById(tenantId, nodeId, { includeTrashed = false } = {}) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId)) return null;
    if (!USE_PG) {
      const found = mem.storageNodes.find(
        (n) =>
          n.id === nodeId &&
          matchTenant(n.tenant_id, clean) &&
          (includeTrashed || !n.is_trashed),
      );
      return found ? normalizeStorageNodeRow({ ...found }) : null;
    }
    const sql = includeTrashed
      ? 'SELECT * FROM storage_svc.storage_nodes WHERE id = $1 AND tenant_id = $2 LIMIT 1'
      : 'SELECT * FROM storage_svc.storage_nodes WHERE id = $1 AND tenant_id = $2 AND is_trashed = FALSE LIMIT 1';
    const { rows } = await pool.query(sql, [nodeId, clean]);
    return normalizeStorageNodeRow(rows[0]);
  },

  async getNodeByPath(tenantId, virtualPath) {
    const clean = requireCleanTenantId(tenantId);
    const normalizedPath = normalizeVirtualPathValue(virtualPath);
    if (!USE_PG) {
      const found = mem.storageNodes.find(
        (n) =>
          matchTenant(n.tenant_id, clean) &&
          !n.is_trashed &&
          n.virtual_path === normalizedPath,
      );
      return found ? normalizeStorageNodeRow({ ...found }) : null;
    }
    const { rows } = await pool.query(
      'SELECT * FROM storage_svc.storage_nodes WHERE tenant_id = $1 AND virtual_path = $2 AND is_trashed = FALSE LIMIT 1',
      [clean, normalizedPath],
    );
    return normalizeStorageNodeRow(rows[0]);
  },

  async listNodes(
    tenantId,
    { parentId, search, includeTrash = false, nodeType, departmentScope } = {},
  ) {
    const clean = requireCleanTenantId(tenantId);
    if (!USE_PG) {
      const term = search ? String(search).trim().toLowerCase() : '';
      return mem.storageNodes
        .filter((n) => {
          if (!matchTenant(n.tenant_id, clean)) return false;
          if (!includeTrash && n.is_trashed) return false;
          if (parentId !== undefined) {
            if (parentId === null && n.parent_id !== null) return false;
            if (parentId !== null && n.parent_id !== parentId) return false;
          }
          if (nodeType && n.node_type !== nodeType) return false;
          if (departmentScope && n.department_scope !== departmentScope) return false;
          if (
            term &&
            !String(n.name || '').toLowerCase().includes(term) &&
            !String(n.virtual_path || '').toLowerCase().includes(term)
          ) {
            return false;
          }
          return true;
        })
        .sort((a, b) => {
          if (a.node_type === 'folder' && b.node_type !== 'folder') return -1;
          if (a.node_type !== 'folder' && b.node_type === 'folder') return 1;
          return String(a.name).localeCompare(String(b.name));
        })
        .map((n) => normalizeStorageNodeRow({ ...n }));
    }

    const params = [clean];
    const where = ['tenant_id = $1'];
    if (!includeTrash) where.push('is_trashed = FALSE');
    if (parentId !== undefined) {
      if (parentId === null) {
        where.push('parent_id IS NULL');
      } else {
        if (!isUuid(parentId)) return [];
        params.push(parentId);
        where.push(`parent_id = $${params.length}`);
      }
    }
    if (nodeType) {
      params.push(nodeType);
      where.push(`node_type = $${params.length}`);
    }
    if (departmentScope) {
      params.push(departmentScope);
      where.push(`department_scope = $${params.length}`);
    }
    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      where.push(`(name ILIKE $${params.length} OR virtual_path ILIKE $${params.length})`);
    }

    const { rows } = await pool.query(
      `SELECT * FROM storage_svc.storage_nodes
       WHERE ${where.join(' AND ')}
       ORDER BY (CASE WHEN node_type = 'folder' THEN 0 ELSE 1 END), name ASC`,
      params,
    );
    return rows.map(normalizeStorageNodeRow);
  },

  async listDescendants(tenantId, virtualPathPrefix, { includeTrash = false } = {}) {
    const clean = requireCleanTenantId(tenantId);
    const prefix = normalizeVirtualPathValue(virtualPathPrefix);
    const childPrefix = prefix === '/' ? '/' : `${prefix}/`;

    if (!USE_PG) {
      return mem.storageNodes
        .filter((n) => {
          if (!matchTenant(n.tenant_id, clean)) return false;
          if (!includeTrash && n.is_trashed) return false;
          if (prefix === '/') return true;
          return n.virtual_path === prefix || String(n.virtual_path).startsWith(childPrefix);
        })
        .sort((a, b) => String(a.virtual_path).localeCompare(String(b.virtual_path)))
        .map((n) => normalizeStorageNodeRow({ ...n }));
    }

    if (prefix === '/') {
      const sql = includeTrash
        ? 'SELECT * FROM storage_svc.storage_nodes WHERE tenant_id = $1 ORDER BY virtual_path ASC'
        : 'SELECT * FROM storage_svc.storage_nodes WHERE tenant_id = $1 AND is_trashed = FALSE ORDER BY virtual_path ASC';
      const { rows } = await pool.query(sql, [clean]);
      return rows.map(normalizeStorageNodeRow);
    }

    const sql = includeTrash
      ? 'SELECT * FROM storage_svc.storage_nodes WHERE tenant_id = $1 AND (virtual_path = $2 OR starts_with(virtual_path, $3)) ORDER BY virtual_path ASC'
      : 'SELECT * FROM storage_svc.storage_nodes WHERE tenant_id = $1 AND is_trashed = FALSE AND (virtual_path = $2 OR starts_with(virtual_path, $3)) ORDER BY virtual_path ASC';
    const { rows } = await pool.query(sql, [clean, prefix, childPrefix]);
    return rows.map(normalizeStorageNodeRow);
  },

  async updateNode(tenantId, nodeId, patch = {}) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId)) return null;
    const nowIso = new Date().toISOString();

    const mapped = {};
    if (patch.name !== undefined) mapped.name = String(patch.name).trim();
    if (patch.parentId !== undefined || patch.parent_id !== undefined) {
      mapped.parent_id = patch.parentId !== undefined ? patch.parentId : patch.parent_id;
    }
    if (patch.virtualPath !== undefined || patch.virtual_path !== undefined) {
      mapped.virtual_path = normalizeVirtualPathValue(
        patch.virtualPath !== undefined ? patch.virtualPath : patch.virtual_path,
      );
    }
    if (patch.sizeBytes !== undefined || patch.size_bytes !== undefined) {
      mapped.size_bytes = Math.max(
        0,
        Math.round(Number(patch.sizeBytes !== undefined ? patch.sizeBytes : patch.size_bytes)),
      );
    }
    if (patch.sha256Hash !== undefined || patch.sha256_hash !== undefined) {
      mapped.sha256_hash = patch.sha256Hash !== undefined ? patch.sha256Hash : patch.sha256_hash;
    }
    if (patch.mimeType !== undefined || patch.mime_type !== undefined) {
      mapped.mime_type = patch.mimeType !== undefined ? patch.mimeType : patch.mime_type;
    }
    if (patch.currentVersion !== undefined || patch.current_version !== undefined) {
      mapped.current_version = Math.max(
        1,
        Math.round(
          Number(patch.currentVersion !== undefined ? patch.currentVersion : patch.current_version),
        ),
      );
    }
    if (patch.departmentScope !== undefined || patch.department_scope !== undefined) {
      mapped.department_scope =
        patch.departmentScope !== undefined ? patch.departmentScope : patch.department_scope;
    }
    if (patch.updatedByEmail !== undefined || patch.updated_by_email !== undefined) {
      mapped.updated_by_email =
        patch.updatedByEmail !== undefined ? patch.updatedByEmail : patch.updated_by_email;
    }

    if (!USE_PG) {
      const idx = mem.storageNodes.findIndex(
        (n) => n.id === nodeId && matchTenant(n.tenant_id, clean),
      );
      if (idx === -1) return null;
      const prev = mem.storageNodes[idx];
      const nextPath = mapped.virtual_path ?? prev.virtual_path;
      if (!prev.is_trashed && mapped.virtual_path !== undefined) {
        const conflict = mem.storageNodes.find(
          (n) =>
            n.id !== nodeId &&
            matchTenant(n.tenant_id, clean) &&
            !n.is_trashed &&
            n.virtual_path === nextPath,
        );
        if (conflict) {
          const err = new Error(`Já existe um item ativo no caminho '${nextPath}'.`);
          err.statusCode = 409;
          err.code = 'PATH_ALREADY_EXISTS';
          throw err;
        }
      }
      const next = { ...prev, ...mapped, updated_at: nowIso };
      mem.storageNodes[idx] = next;
      return normalizeStorageNodeRow({ ...next });
    }

    const keys = Object.keys(mapped);
    if (keys.length === 0) return this.getNodeById(clean, nodeId, { includeTrashed: true });

    const setClauses = keys.map((k, i) => `${k} = $${i + 3}`);
    setClauses.push('updated_at = NOW()');
    const values = keys.map((k) => mapped[k]);

    try {
      const { rows } = await pool.query(
        `UPDATE storage_svc.storage_nodes
         SET ${setClauses.join(', ')}
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [nodeId, clean, ...values],
      );
      return normalizeStorageNodeRow(rows[0]);
    } catch (e) {
      if (e.code === '23505') {
        const err = new Error('Já existe um item ativo no caminho de destino.');
        err.statusCode = 409;
        err.code = 'PATH_ALREADY_EXISTS';
        throw err;
      }
      throw e;
    }
  },

  async moveNodeSubtree(tenantId, nodeId, { newParentId, newName, oldPrefix, newPrefix, updatedByEmail }) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId)) return null;
    if (newParentId !== undefined && newParentId !== null && !isUuid(newParentId)) {
      const err = new Error('newParentId inválido.');
      err.statusCode = 400;
      err.code = 'INVALID_PARENT_NODE';
      throw err;
    }
    if (newParentId !== undefined && newParentId !== null && newParentId === nodeId) {
      const err = new Error('Ciclo detectado: não é possível mover um nó para dentro de si mesmo.');
      err.statusCode = 400;
      err.code = 'CYCLE_DETECTED';
      throw err;
    }
    const normOld = normalizeVirtualPathValue(oldPrefix);
    const normNew = normalizeVirtualPathValue(newPrefix);
    const oldChildPrefix = normOld === '/' ? '/' : `${normOld}/`;
    if (normOld !== '/' && (normNew === normOld || normNew.startsWith(oldChildPrefix))) {
      const err = new Error('Ciclo detectado: caminho de destino pertence à subárvore movida.');
      err.statusCode = 400;
      err.code = 'CYCLE_DETECTED';
      throw err;
    }
    const nowIso = new Date().toISOString();

    if (!USE_PG) {
      const targetIdx = mem.storageNodes.findIndex(
        (n) => n.id === nodeId && matchTenant(n.tenant_id, clean) && !n.is_trashed,
      );
      if (targetIdx === -1) return null;

      const affected = mem.storageNodes.filter(
        (n) =>
          matchTenant(n.tenant_id, clean) &&
          !n.is_trashed &&
          (n.id === nodeId || String(n.virtual_path).startsWith(oldChildPrefix)),
      );
      const affectedIds = new Set(affected.map((n) => n.id));

      if (newParentId !== undefined && newParentId !== null) {
        const parentNode = mem.storageNodes.find(
          (n) => n.id === newParentId && matchTenant(n.tenant_id, clean),
        );
        if (!parentNode) {
          const err = new Error('Pasta de destino não encontrada para este tenant.');
          err.statusCode = 404;
          err.code = 'INVALID_PARENT_NODE';
          throw err;
        }
        if (parentNode.is_trashed) {
          const err = new Error('Não é possível mover para dentro de uma pasta na lixeira.');
          err.statusCode = 400;
          err.code = 'INVALID_PARENT_NODE';
          throw err;
        }
        if (parentNode.node_type !== 'folder') {
          const err = new Error('O nó pai de destino deve ser uma pasta.');
          err.statusCode = 400;
          err.code = 'INVALID_PARENT_NODE';
          throw err;
        }
        if (
          affectedIds.has(newParentId) ||
          (normOld !== '/' &&
            (parentNode.virtual_path === normOld ||
              String(parentNode.virtual_path).startsWith(oldChildPrefix)))
        ) {
          const err = new Error('Ciclo detectado: pasta de destino pertence à subárvore movida.');
          err.statusCode = 400;
          err.code = 'CYCLE_DETECTED';
          throw err;
        }
        const seenAncestors = new Set([parentNode.id]);
        let curParentId = parentNode.parent_id;
        while (curParentId) {
          if (curParentId === nodeId) {
            const err = new Error('Ciclo detectado: pasta de destino pertence à subárvore movida.');
            err.statusCode = 400;
            err.code = 'CYCLE_DETECTED';
            throw err;
          }
          if (seenAncestors.has(curParentId)) break;
          seenAncestors.add(curParentId);
          const anc = mem.storageNodes.find(
            (n) => n.id === curParentId && matchTenant(n.tenant_id, clean),
          );
          curParentId = anc?.parent_id ?? null;
        }
      }

      const plannedPaths = new Map();
      for (const n of affected) {
        const nextPath =
          n.id === nodeId
            ? normNew
            : `${normNew}${String(n.virtual_path).slice(normOld.length)}`;
        plannedPaths.set(n.id, nextPath);
      }

      for (const n of mem.storageNodes) {
        if (!matchTenant(n.tenant_id, clean) || n.is_trashed || affectedIds.has(n.id)) continue;
        for (const p of plannedPaths.values()) {
          if (n.virtual_path === p) {
            const err = new Error(`Conflito de caminho ao mover para '${p}'.`);
            err.statusCode = 409;
            err.code = 'PATH_ALREADY_EXISTS';
            throw err;
          }
        }
      }

      for (let i = 0; i < mem.storageNodes.length; i += 1) {
        const n = mem.storageNodes[i];
        if (!affectedIds.has(n.id)) continue;
        mem.storageNodes[i] = {
          ...n,
          parent_id: n.id === nodeId && newParentId !== undefined ? newParentId : n.parent_id,
          name: n.id === nodeId && newName ? String(newName).trim() : n.name,
          virtual_path: plannedPaths.get(n.id),
          updated_by_email: updatedByEmail || n.updated_by_email,
          updated_at: nowIso,
        };
      }
      return normalizeStorageNodeRow({ ...mem.storageNodes[targetIdx] });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const targetRes = await client.query(
        'SELECT * FROM storage_svc.storage_nodes WHERE id = $1 AND tenant_id = $2 AND is_trashed = FALSE LIMIT 1',
        [nodeId, clean],
      );
      if (!targetRes.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }

      if (newParentId !== undefined && newParentId !== null) {
        const parentRes = await client.query(
          'SELECT id, node_type, is_trashed, virtual_path FROM storage_svc.storage_nodes WHERE id = $1 AND tenant_id = $2 LIMIT 1',
          [newParentId, clean],
        );
        const parentRow = parentRes.rows[0];
        if (!parentRow) {
          const err = new Error('Pasta de destino não encontrada para este tenant.');
          err.statusCode = 404;
          err.code = 'INVALID_PARENT_NODE';
          throw err;
        }
        if (parentRow.is_trashed) {
          const err = new Error('Não é possível mover para dentro de uma pasta na lixeira.');
          err.statusCode = 400;
          err.code = 'INVALID_PARENT_NODE';
          throw err;
        }
        if (parentRow.node_type !== 'folder') {
          const err = new Error('O nó pai de destino deve ser uma pasta.');
          err.statusCode = 400;
          err.code = 'INVALID_PARENT_NODE';
          throw err;
        }
        if (
          normOld !== '/' &&
          (parentRow.virtual_path === normOld ||
            String(parentRow.virtual_path).startsWith(oldChildPrefix))
        ) {
          const err = new Error('Ciclo detectado: pasta de destino pertence à subárvore movida.');
          err.statusCode = 400;
          err.code = 'CYCLE_DETECTED';
          throw err;
        }
        const cycleRes = await client.query(
          `WITH RECURSIVE subtree AS (
             SELECT id FROM storage_svc.storage_nodes
             WHERE id = $1 AND tenant_id = $2 AND is_trashed = FALSE
             UNION
             SELECT c.id FROM storage_svc.storage_nodes c
             INNER JOIN subtree s ON c.parent_id = s.id
             WHERE c.tenant_id = $2 AND c.is_trashed = FALSE
           )
           SELECT id FROM subtree WHERE id = $3 LIMIT 1`,
          [nodeId, clean, newParentId],
        );
        if (cycleRes.rows[0]) {
          const err = new Error('Ciclo detectado: pasta de destino pertence à subárvore movida.');
          err.statusCode = 400;
          err.code = 'CYCLE_DETECTED';
          throw err;
        }
      }

      const hasNewParent = newParentId !== undefined;
      const newParentUuid = hasNewParent ? newParentId : null;
      const cleanNewName = newName ? String(newName).trim() : null;

      await client.query(
        `UPDATE storage_svc.storage_nodes
         SET parent_id = CASE WHEN $3::boolean THEN $4::uuid ELSE parent_id END,
             name = COALESCE($5, name),
             virtual_path = $6,
             updated_by_email = COALESCE($7, updated_by_email),
             updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2`,
        [nodeId, clean, hasNewParent, newParentUuid, cleanNewName, normNew, updatedByEmail || null],
      );

      await client.query(
        `UPDATE storage_svc.storage_nodes
         SET virtual_path = $4 || SUBSTRING(virtual_path FROM CHAR_LENGTH($3) + 1),
             updated_by_email = COALESCE($5, updated_by_email),
             updated_at = NOW()
         WHERE tenant_id = $1 AND is_trashed = FALSE AND id <> $2 AND starts_with(virtual_path, $6)`,
        [clean, nodeId, normOld, normNew, updatedByEmail || null, oldChildPrefix],
      );

      const updated = await client.query(
        'SELECT * FROM storage_svc.storage_nodes WHERE id = $1 AND tenant_id = $2 LIMIT 1',
        [nodeId, clean],
      );
      await client.query('COMMIT');
      return normalizeStorageNodeRow(updated.rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === '23505') {
        const err = new Error('Conflito de caminho ao mover nó.');
        err.statusCode = 409;
        err.code = 'PATH_ALREADY_EXISTS';
        throw err;
      }
      throw e;
    } finally {
      client.release();
    }
  },

  async lockNode(tenantId, nodeId, actorEmail) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId)) return null;
    const email = String(actorEmail || '').trim().toLowerCase();
    const nowIso = new Date().toISOString();

    if (!USE_PG) {
      const idx = mem.storageNodes.findIndex(
        (n) => n.id === nodeId && matchTenant(n.tenant_id, clean) && !n.is_trashed,
      );
      if (idx === -1) return null;
      const node = mem.storageNodes[idx];
      if (node.locked_by_email && node.locked_by_email.toLowerCase() !== email) {
        const err = new Error(`Arquivo bloqueado por '${node.locked_by_email}'.`);
        err.statusCode = 423;
        err.code = 'NODE_LOCKED';
        throw err;
      }
      const next = { ...node, locked_by_email: email, locked_at: nowIso, updated_at: nowIso };
      mem.storageNodes[idx] = next;
      return normalizeStorageNodeRow({ ...next });
    }

    const { rows } = await pool.query(
      `UPDATE storage_svc.storage_nodes
       SET locked_by_email = $3,
           locked_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND is_trashed = FALSE
         AND (locked_by_email IS NULL OR LOWER(locked_by_email) = LOWER($3))
       RETURNING *`,
      [nodeId, clean, email],
    );
    if (!rows[0]) {
      const existing = await this.getNodeById(clean, nodeId);
      if (!existing) return null;
      const err = new Error(`Arquivo bloqueado por '${existing.locked_by_email}'.`);
      err.statusCode = 423;
      err.code = 'NODE_LOCKED';
      throw err;
    }
    return normalizeStorageNodeRow(rows[0]);
  },

  async unlockNode(tenantId, nodeId, actorEmail, { force = false } = {}) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId)) return null;
    const email = String(actorEmail || '').trim().toLowerCase();
    const nowIso = new Date().toISOString();

    if (!USE_PG) {
      const idx = mem.storageNodes.findIndex(
        (n) => n.id === nodeId && matchTenant(n.tenant_id, clean) && !n.is_trashed,
      );
      if (idx === -1) return null;
      const node = mem.storageNodes[idx];
      if (node.locked_by_email && node.locked_by_email.toLowerCase() !== email && !force) {
        const err = new Error(`Apenas '${node.locked_by_email}' ou administrador pode desbloquear.`);
        err.statusCode = 423;
        err.code = 'NODE_LOCKED';
        throw err;
      }
      const next = { ...node, locked_by_email: null, locked_at: null, updated_at: nowIso };
      mem.storageNodes[idx] = next;
      return normalizeStorageNodeRow({ ...next });
    }

    const sql = force
      ? `UPDATE storage_svc.storage_nodes
         SET locked_by_email = NULL, locked_at = NULL, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND is_trashed = FALSE
         RETURNING *`
      : `UPDATE storage_svc.storage_nodes
         SET locked_by_email = NULL, locked_at = NULL, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND is_trashed = FALSE
           AND (locked_by_email IS NULL OR LOWER(locked_by_email) = LOWER($3))
         RETURNING *`;
    const params = force ? [nodeId, clean] : [nodeId, clean, email];
    const { rows } = await pool.query(sql, params);
    if (!rows[0]) {
      const existing = await this.getNodeById(clean, nodeId);
      if (!existing) return null;
      const err = new Error(`Apenas '${existing.locked_by_email}' ou administrador pode desbloquear.`);
      err.statusCode = 423;
      err.code = 'NODE_LOCKED';
      throw err;
    }
    return normalizeStorageNodeRow(rows[0]);
  },

  async trashNode(tenantId, nodeId, { trashedByEmail, trashKey } = {}) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId)) return null;
    const nowIso = new Date().toISOString();
    const effectiveTrashKey = trashKey ? String(trashKey) : crypto.randomUUID();

    if (!USE_PG) {
      const target = mem.storageNodes.find(
        (n) => n.id === nodeId && matchTenant(n.tenant_id, clean) && !n.is_trashed,
      );
      if (!target) return null;
      const childPrefix = `${target.virtual_path}/`;
      for (let i = 0; i < mem.storageNodes.length; i += 1) {
        const n = mem.storageNodes[i];
        if (!matchTenant(n.tenant_id, clean) || n.is_trashed) continue;
        if (n.id === nodeId || (target.node_type === 'folder' && String(n.virtual_path).startsWith(childPrefix))) {
          mem.storageNodes[i] = {
            ...n,
            is_trashed: true,
            trashed_at: nowIso,
            trashed_by_email: trashedByEmail || null,
            original_parent_id: n.parent_id,
            original_virtual_path: n.virtual_path,
            trash_key: effectiveTrashKey,
            updated_at: nowIso,
          };
        }
      }
      const updated = mem.storageNodes.find((n) => n.id === nodeId);
      return normalizeStorageNodeRow({ ...updated });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        'SELECT * FROM storage_svc.storage_nodes WHERE id = $1 AND tenant_id = $2 AND is_trashed = FALSE LIMIT 1',
        [nodeId, clean],
      );
      const target = res.rows[0];
      if (!target) {
        await client.query('ROLLBACK');
        return null;
      }

      if (target.node_type === 'folder') {
        await client.query(
          `UPDATE storage_svc.storage_nodes
           SET is_trashed = TRUE,
               trashed_at = $6::timestamptz,
               trashed_by_email = $3,
               original_parent_id = parent_id,
               original_virtual_path = virtual_path,
               trash_key = $4,
               updated_at = NOW()
           WHERE tenant_id = $1 AND is_trashed = FALSE
             AND (id = $2 OR starts_with(virtual_path, $5))`,
          [clean, nodeId, trashedByEmail || null, effectiveTrashKey, `${target.virtual_path}/`, nowIso],
        );
      } else {
        await client.query(
          `UPDATE storage_svc.storage_nodes
           SET is_trashed = TRUE,
               trashed_at = $5::timestamptz,
               trashed_by_email = $3,
               original_parent_id = parent_id,
               original_virtual_path = virtual_path,
               trash_key = $4,
               updated_at = NOW()
           WHERE id = $1 AND tenant_id = $2 AND is_trashed = FALSE`,
          [nodeId, clean, trashedByEmail || null, effectiveTrashKey, nowIso],
        );
      }

      const updated = await client.query(
        'SELECT * FROM storage_svc.storage_nodes WHERE id = $1 AND tenant_id = $2 LIMIT 1',
        [nodeId, clean],
      );
      await client.query('COMMIT');
      return normalizeStorageNodeRow(updated.rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async listTrash(tenantId) {
    const clean = requireCleanTenantId(tenantId);
    if (!USE_PG) {
      return mem.storageNodes
        .filter((n) => matchTenant(n.tenant_id, clean) && n.is_trashed)
        .sort((a, b) => String(b.trashed_at || '').localeCompare(String(a.trashed_at || '')))
        .map((n) => normalizeStorageNodeRow({ ...n }));
    }
    const { rows } = await pool.query(
      'SELECT * FROM storage_svc.storage_nodes WHERE tenant_id = $1 AND is_trashed = TRUE ORDER BY trashed_at DESC',
      [clean],
    );
    return rows.map(normalizeStorageNodeRow);
  },

  async restoreNode(tenantId, nodeId, { targetParentId, targetVirtualPath } = {}) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId)) return null;
    if (targetParentId !== undefined && targetParentId !== null && !isUuid(targetParentId)) {
      const err = new Error('targetParentId inválido.');
      err.statusCode = 400;
      err.code = 'INVALID_PARENT_NODE';
      throw err;
    }
    if (targetParentId !== undefined && targetParentId !== null && targetParentId === nodeId) {
      const err = new Error('Ciclo detectado: não é possível restaurar um nó dentro de si mesmo.');
      err.statusCode = 400;
      err.code = 'CYCLE_DETECTED';
      throw err;
    }
    const nowIso = new Date().toISOString();
    const hasTargetParent = targetParentId !== undefined;

    const buildRebasePath = (oldPrefix, nextPath) => {
      const oldChildPrefix = oldPrefix === '/' ? '/' : `${oldPrefix}/`;
      return (rawDescPath) => {
        const normDesc = normalizeVirtualPathValue(rawDescPath);
        if (nextPath === oldPrefix) return normDesc;
        if (oldPrefix !== '/' && normDesc.startsWith(oldChildPrefix)) {
          const suffix = normDesc.slice(oldPrefix.length);
          return nextPath === '/' ? suffix || '/' : `${nextPath}${suffix}`;
        }
        return normDesc;
      };
    };

    if (!USE_PG) {
      const idx = mem.storageNodes.findIndex(
        (n) => n.id === nodeId && matchTenant(n.tenant_id, clean) && n.is_trashed,
      );
      if (idx === -1) return null;
      const node = mem.storageNodes[idx];
      const oldPrefix = normalizeVirtualPathValue(node.original_virtual_path || node.virtual_path);
      const nextPath = normalizeVirtualPathValue(targetVirtualPath || oldPrefix);
      const nextName =
        nextPath !== '/' && nextPath !== oldPrefix ? path.posix.basename(nextPath) : node.name;
      const oldChildPrefix = oldPrefix === '/' ? '/' : `${oldPrefix}/`;
      const rebaseDescPath = buildRebasePath(oldPrefix, nextPath);

      const matchesTrashSnapshot = (candidate) => {
        if (node.trash_key) return candidate.trash_key === node.trash_key;
        return Boolean(node.trashed_at && candidate.trashed_at === node.trashed_at);
      };

      const descendantIndices = [];
      const subtreeIds = new Set([node.id]);
      if (node.node_type === 'folder') {
        let changed = true;
        while (changed) {
          changed = false;
          for (const n of mem.storageNodes) {
            if (
              !matchTenant(n.tenant_id, clean) ||
              !n.is_trashed ||
              subtreeIds.has(n.id) ||
              !matchesTrashSnapshot(n)
            ) {
              continue;
            }
            if (n.parent_id && subtreeIds.has(n.parent_id)) {
              subtreeIds.add(n.id);
              changed = true;
            } else if (
              n.parent_id === null &&
              normalizeVirtualPathValue(n.original_virtual_path || n.virtual_path).startsWith(
                oldChildPrefix,
              )
            ) {
              subtreeIds.add(n.id);
              changed = true;
            }
          }
        }
        for (let i = 0; i < mem.storageNodes.length; i += 1) {
          const n = mem.storageNodes[i];
          if (n.id !== node.id && subtreeIds.has(n.id)) {
            descendantIndices.push(i);
          }
        }
      }

      let nextParent = hasTargetParent
        ? targetParentId
        : (node.original_parent_id ?? node.parent_id ?? null);

      if (hasTargetParent && targetParentId !== null) {
        if (subtreeIds.has(targetParentId)) {
          const err = new Error('Ciclo detectado: pasta de destino pertence à subárvore restaurada.');
          err.statusCode = 400;
          err.code = 'CYCLE_DETECTED';
          throw err;
        }
        const parentNode = mem.storageNodes.find(
          (n) => n.id === targetParentId && matchTenant(n.tenant_id, clean),
        );
        if (!parentNode) {
          const err = new Error('Pasta pai de destino não encontrada para este tenant.');
          err.statusCode = 404;
          err.code = 'INVALID_PARENT_NODE';
          throw err;
        }
        if (parentNode.is_trashed) {
          const err = new Error('Não é possível restaurar sob uma pasta que está na lixeira.');
          err.statusCode = 409;
          err.code = 'PARENT_IS_TRASHED';
          throw err;
        }
        if (parentNode.node_type !== 'folder') {
          const err = new Error('O nó pai de destino deve ser uma pasta.');
          err.statusCode = 400;
          err.code = 'INVALID_PARENT_NODE';
          throw err;
        }
      } else if (!hasTargetParent && nextParent !== null) {
        const parentNode = mem.storageNodes.find(
          (n) => n.id === nextParent && matchTenant(n.tenant_id, clean),
        );
        if (parentNode && parentNode.is_trashed) {
          const err = new Error(
            'A pasta pai original ainda está na lixeira. Restaure a pasta pai primeiro ou informe targetParentId.',
          );
          err.statusCode = 409;
          err.code = 'PARENT_IS_TRASHED';
          throw err;
        }
        if (parentNode && parentNode.node_type !== 'folder') {
          const err = new Error('O nó pai original não é uma pasta válida.');
          err.statusCode = 400;
          err.code = 'INVALID_PARENT_NODE';
          throw err;
        }
        if (!parentNode) {
          nextParent = null;
        }
      }

      const plannedPaths = new Map();
      plannedPaths.set(idx, nextPath);
      const plannedPathSet = new Set([nextPath]);
      for (const dIdx of descendantIndices) {
        const d = mem.storageNodes[dIdx];
        const dPath = rebaseDescPath(d.original_virtual_path || d.virtual_path);
        if (plannedPathSet.has(dPath)) {
          const err = new Error(`Caminho '${dPath}' duplicado ao restaurar pasta.`);
          err.statusCode = 409;
          err.code = 'PATH_ALREADY_EXISTS';
          throw err;
        }
        plannedPathSet.add(dPath);
        plannedPaths.set(dIdx, dPath);
      }

      for (const n of mem.storageNodes) {
        if (!matchTenant(n.tenant_id, clean) || n.is_trashed) continue;
        if (plannedPathSet.has(n.virtual_path)) {
          const err = new Error(`Caminho '${n.virtual_path}' já está ocupado por outro item ativo.`);
          err.statusCode = 409;
          err.code = 'PATH_ALREADY_EXISTS';
          throw err;
        }
      }

      const nextRoot = {
        ...node,
        parent_id: nextParent,
        name: nextName,
        virtual_path: nextPath,
        is_trashed: false,
        trashed_at: null,
        trashed_by_email: null,
        trash_key: null,
        updated_at: nowIso,
      };
      mem.storageNodes[idx] = nextRoot;

      for (const dIdx of descendantIndices) {
        const d = mem.storageNodes[dIdx];
        mem.storageNodes[dIdx] = {
          ...d,
          parent_id: d.original_parent_id ?? d.parent_id,
          virtual_path: plannedPaths.get(dIdx),
          is_trashed: false,
          trashed_at: null,
          trashed_by_email: null,
          trash_key: null,
          updated_at: nowIso,
        };
      }

      return normalizeStorageNodeRow({ ...nextRoot });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const targetRes = await client.query(
        'SELECT * FROM storage_svc.storage_nodes WHERE id = $1 AND tenant_id = $2 AND is_trashed = TRUE LIMIT 1 FOR UPDATE',
        [nodeId, clean],
      );
      const node = targetRes.rows[0];
      if (!node) {
        await client.query('ROLLBACK');
        return null;
      }

      const oldPrefix = normalizeVirtualPathValue(node.original_virtual_path || node.virtual_path);
      const nextPath = normalizeVirtualPathValue(targetVirtualPath || oldPrefix);
      const nextName =
        nextPath !== '/' && nextPath !== oldPrefix ? path.posix.basename(nextPath) : node.name;
      const oldChildPrefix = oldPrefix === '/' ? '/' : `${oldPrefix}/`;
      const rebaseDescPath = buildRebasePath(oldPrefix, nextPath);

      let descRows = [];
      if (node.node_type === 'folder') {
        const subRes = await client.query(
          `WITH RECURSIVE subtree AS (
             SELECT * FROM storage_svc.storage_nodes
             WHERE id = $1 AND tenant_id = $2 AND is_trashed = TRUE
             UNION
             SELECT * FROM storage_svc.storage_nodes
             WHERE tenant_id = $2 AND is_trashed = TRUE AND parent_id IS NULL
               AND (
                 ($3::text IS NOT NULL AND trash_key = $3::text)
                 OR ($3::text IS NULL AND trashed_at = $4::timestamptz)
               )
               AND starts_with(COALESCE(original_virtual_path, virtual_path), $5)
             UNION
             SELECT c.* FROM storage_svc.storage_nodes c
             INNER JOIN subtree s ON c.parent_id = s.id
             WHERE c.tenant_id = $2 AND c.is_trashed = TRUE
               AND (
                 ($3::text IS NOT NULL AND c.trash_key = $3::text)
                 OR ($3::text IS NULL AND c.trashed_at = $4::timestamptz)
               )
           )
           SELECT * FROM subtree WHERE id <> $1`,
          [nodeId, clean, node.trash_key || null, toIso(node.trashed_at), oldChildPrefix],
        );
        descRows = subRes.rows;
      }

      let resolvedParentId = hasTargetParent
        ? targetParentId
        : (node.original_parent_id ?? node.parent_id ?? null);

      if (hasTargetParent && targetParentId !== null) {
        if (descRows.some((d) => d.id === targetParentId)) {
          const err = new Error('Ciclo detectado: pasta de destino pertence à subárvore restaurada.');
          err.statusCode = 400;
          err.code = 'CYCLE_DETECTED';
          throw err;
        }
        const parentRes = await client.query(
          'SELECT id, node_type, is_trashed FROM storage_svc.storage_nodes WHERE id = $1 AND tenant_id = $2 LIMIT 1',
          [targetParentId, clean],
        );
        const parentRow = parentRes.rows[0];
        if (!parentRow) {
          const err = new Error('Pasta pai de destino não encontrada para este tenant.');
          err.statusCode = 404;
          err.code = 'INVALID_PARENT_NODE';
          throw err;
        }
        if (parentRow.is_trashed) {
          const err = new Error('Não é possível restaurar sob uma pasta que está na lixeira.');
          err.statusCode = 409;
          err.code = 'PARENT_IS_TRASHED';
          throw err;
        }
        if (parentRow.node_type !== 'folder') {
          const err = new Error('O nó pai de destino deve ser uma pasta.');
          err.statusCode = 400;
          err.code = 'INVALID_PARENT_NODE';
          throw err;
        }
      } else if (!hasTargetParent && resolvedParentId !== null) {
        const parentRes = await client.query(
          'SELECT id, node_type, is_trashed FROM storage_svc.storage_nodes WHERE id = $1 AND tenant_id = $2 LIMIT 1',
          [resolvedParentId, clean],
        );
        const parentRow = parentRes.rows[0];
        if (parentRow && parentRow.is_trashed) {
          const err = new Error(
            'A pasta pai original ainda está na lixeira. Restaure a pasta pai primeiro ou informe targetParentId.',
          );
          err.statusCode = 409;
          err.code = 'PARENT_IS_TRASHED';
          throw err;
        }
        if (parentRow && parentRow.node_type !== 'folder') {
          const err = new Error('O nó pai original não é uma pasta válida.');
          err.statusCode = 400;
          err.code = 'INVALID_PARENT_NODE';
          throw err;
        }
        if (!parentRow) {
          resolvedParentId = null;
        }
      }

      const descPlans = descRows.map((d) => ({
        id: d.id,
        nextPath: rebaseDescPath(d.original_virtual_path || d.virtual_path),
      }));
      const allRestorePaths = [nextPath, ...descPlans.map((p) => p.nextPath)];

      const conflictRes = await client.query(
        `SELECT virtual_path FROM storage_svc.storage_nodes
         WHERE tenant_id = $1 AND is_trashed = FALSE AND virtual_path = ANY($2::text[])
         LIMIT 1`,
        [clean, allRestorePaths],
      );
      if (conflictRes.rows[0]) {
        const err = new Error(
          `Caminho '${conflictRes.rows[0].virtual_path}' já está ocupado por outro item ativo.`,
        );
        err.statusCode = 409;
        err.code = 'PATH_ALREADY_EXISTS';
        throw err;
      }

      const { rows } = await client.query(
        `UPDATE storage_svc.storage_nodes
         SET parent_id = $3::uuid,
             name = $5,
             virtual_path = $4,
             is_trashed = FALSE,
             trashed_at = NULL,
             trashed_by_email = NULL,
             trash_key = NULL,
             updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND is_trashed = TRUE
         RETURNING *`,
        [nodeId, clean, resolvedParentId, nextPath, nextName],
      );

      if (descPlans.length > 0) {
        await client.query(
          `UPDATE storage_svc.storage_nodes sn
           SET parent_id = COALESCE(sn.original_parent_id, sn.parent_id),
               virtual_path = v.new_path,
               is_trashed = FALSE,
               trashed_at = NULL,
               trashed_by_email = NULL,
               trash_key = NULL,
               updated_at = NOW()
           FROM unnest($2::uuid[], $3::text[]) AS v(id, new_path)
           WHERE sn.id = v.id AND sn.tenant_id = $1 AND sn.is_trashed = TRUE`,
          [clean, descPlans.map((p) => p.id), descPlans.map((p) => p.nextPath)],
        );
      }

      await client.query('COMMIT');
      return normalizeStorageNodeRow(rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === '23505') {
        const err = new Error('Caminho de restauração já está ocupado por outro item ativo.');
        err.statusCode = 409;
        err.code = 'PATH_ALREADY_EXISTS';
        throw err;
      }
      throw e;
    } finally {
      client.release();
    }
  },

  async purgeNode(tenantId, nodeId) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId)) return null;

    if (!USE_PG) {
      const target = mem.storageNodes.find(
        (n) => n.id === nodeId && matchTenant(n.tenant_id, clean) && n.is_trashed,
      );
      if (!target) return null;
      const toRemoveIds = new Set([target.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const n of mem.storageNodes) {
          if (matchTenant(n.tenant_id, clean) && n.parent_id && toRemoveIds.has(n.parent_id) && !toRemoveIds.has(n.id)) {
            toRemoveIds.add(n.id);
            changed = true;
          }
        }
      }
      let freedBytes = 0;
      const kept = [];
      for (const n of mem.storageNodes) {
        if (toRemoveIds.has(n.id)) {
          freedBytes += Number(n.size_bytes || 0);
        } else {
          kept.push(n);
        }
      }
      mem.storageNodes = kept;
      mem.storageAcls = mem.storageAcls.filter((a) => !toRemoveIds.has(a.node_id));
      mem.storageVersions = mem.storageVersions.filter((v) => !toRemoveIds.has(v.node_id));
      mem.storageTempLinks = mem.storageTempLinks.filter((l) => !toRemoveIds.has(l.node_id));
      mem.sheetSessions = mem.sheetSessions.filter((s) => !toRemoveIds.has(s.node_id));
      mem.sheetCellHistory = mem.sheetCellHistory.filter((h) => !toRemoveIds.has(h.node_id));

      return { deletedNode: normalizeStorageNodeRow({ ...target }), freedBytes };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const subRes = await client.query(
        `WITH RECURSIVE subtree AS (
           SELECT id, size_bytes FROM storage_svc.storage_nodes
           WHERE id = $1 AND tenant_id = $2 AND is_trashed = TRUE
           UNION ALL
           SELECT sn.id, sn.size_bytes FROM storage_svc.storage_nodes sn
           INNER JOIN subtree st ON sn.parent_id = st.id
           WHERE sn.tenant_id = $2
         )
         SELECT COALESCE(SUM(size_bytes), 0) AS freed_bytes FROM subtree`,
        [nodeId, clean],
      );
      const { rows } = await client.query(
        'DELETE FROM storage_svc.storage_nodes WHERE id = $1 AND tenant_id = $2 AND is_trashed = TRUE RETURNING *',
        [nodeId, clean],
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query('COMMIT');
      return {
        deletedNode: normalizeStorageNodeRow(rows[0]),
        freedBytes: Number(subRes.rows[0]?.freed_bytes || 0),
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async purgeExpiredTrash(tenantId, retentionDays = 30) {
    const clean = requireCleanTenantId(tenantId);
    const days = Math.max(1, Math.round(Number(retentionDays || 30)));
    const cutoffMs = Date.now() - days * 86_400_000;

    if (!USE_PG) {
      const expired = mem.storageNodes.filter(
        (n) =>
          matchTenant(n.tenant_id, clean) &&
          n.is_trashed &&
          n.trashed_at &&
          new Date(n.trashed_at).getTime() <= cutoffMs,
      );
      const expiredIds = new Set(expired.map((n) => n.id));
      let changed = true;
      while (changed) {
        changed = false;
        for (const n of mem.storageNodes) {
          if (
            matchTenant(n.tenant_id, clean) &&
            n.is_trashed &&
            n.parent_id &&
            expiredIds.has(n.parent_id) &&
            !expiredIds.has(n.id)
          ) {
            expiredIds.add(n.id);
            changed = true;
          }
        }
      }
      let freedBytes = 0;
      const purgedNodes = [];
      const kept = [];
      for (const n of mem.storageNodes) {
        if (expiredIds.has(n.id)) {
          freedBytes += Number(n.size_bytes || 0);
          purgedNodes.push(normalizeStorageNodeRow({ ...n }));
        } else {
          kept.push(n);
        }
      }
      mem.storageNodes = kept;
      mem.storageAcls = mem.storageAcls.filter((a) => !expiredIds.has(a.node_id));
      mem.storageVersions = mem.storageVersions.filter((v) => !expiredIds.has(v.node_id));
      mem.storageTempLinks = mem.storageTempLinks.filter((l) => !expiredIds.has(l.node_id));
      mem.sheetSessions = mem.sheetSessions.filter((s) => !expiredIds.has(s.node_id));
      mem.sheetCellHistory = mem.sheetCellHistory.filter((h) => !expiredIds.has(h.node_id));
      return { purgedNodes, freedBytes };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const subRes = await client.query(
        `WITH RECURSIVE expired_roots AS (
           SELECT * FROM storage_svc.storage_nodes
           WHERE tenant_id = $1
             AND is_trashed = TRUE
             AND trashed_at <= NOW() - ($2::text || ' days')::interval
         ),
         subtree AS (
           SELECT * FROM expired_roots
           UNION
           SELECT c.* FROM storage_svc.storage_nodes c
           INNER JOIN subtree s ON c.parent_id = s.id
           WHERE c.tenant_id = $1
             AND c.is_trashed = TRUE
         )
         SELECT * FROM subtree`,
        [clean, String(days)],
      );

      const seenIds = new Set();
      const uniqueRows = [];
      for (const r of subRes.rows) {
        if (!seenIds.has(r.id)) {
          seenIds.add(r.id);
          uniqueRows.push(r);
        }
      }

      if (uniqueRows.length > 0) {
        const idsToDelete = Array.from(seenIds);
        await client.query(
          `UPDATE storage_svc.storage_nodes
           SET parent_id = NULL, updated_at = NOW()
           WHERE tenant_id = $1 AND is_trashed = FALSE AND parent_id = ANY($2::uuid[])`,
          [clean, idsToDelete],
        );
        await client.query(
          'DELETE FROM storage_svc.storage_nodes WHERE tenant_id = $1 AND is_trashed = TRUE AND id = ANY($2::uuid[])',
          [clean, idsToDelete],
        );
      }

      await client.query('COMMIT');
      const purgedNodes = uniqueRows.map(normalizeStorageNodeRow);
      const freedBytes = purgedNodes.reduce((acc, n) => acc + Number(n.size_bytes || 0), 0);
      return { purgedNodes, freedBytes };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  // ---------------------------------------------------------------------------
  // 6.4 ACLs
  // ---------------------------------------------------------------------------
  async listNodeAcls(tenantId, nodeId) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId)) return [];
    if (!USE_PG) {
      return mem.storageAcls
        .filter((a) => matchTenant(a.tenant_id, clean) && a.node_id === nodeId)
        .map((a) => normalizeStorageAclRow({ ...a }));
    }
    const { rows } = await pool.query(
      'SELECT * FROM storage_svc.storage_acls WHERE tenant_id = $1 AND node_id = $2 ORDER BY created_at ASC',
      [clean, nodeId],
    );
    return rows.map(normalizeStorageAclRow);
  },

  async listAclsForNodes(tenantId, nodeIds) {
    const clean = requireCleanTenantId(tenantId);
    const validIds = (Array.isArray(nodeIds) ? nodeIds : []).filter(isUuid);
    if (validIds.length === 0) return [];
    if (!USE_PG) {
      const idSet = new Set(validIds);
      return mem.storageAcls
        .filter((a) => matchTenant(a.tenant_id, clean) && idSet.has(a.node_id))
        .map((a) => normalizeStorageAclRow({ ...a }));
    }
    const { rows } = await pool.query(
      'SELECT * FROM storage_svc.storage_acls WHERE tenant_id = $1 AND node_id = ANY($2::uuid[]) ORDER BY created_at ASC',
      [clean, validIds],
    );
    return rows.map(normalizeStorageAclRow);
  },

  async upsertNodeAcl(tenantId, nodeId, { targetType, targetValue, accessLevel, grantedByEmail }) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId)) return null;
    const node = await this.getNodeById(clean, nodeId, { includeTrashed: true });
    if (!node) {
      const err = new Error('Nó de armazenamento não encontrado para este tenant.');
      err.statusCode = 404;
      throw err;
    }

    const nowIso = new Date().toISOString();
    const cleanTargetType = String(targetType || '').trim();
    const cleanTargetValue = String(targetValue || '').trim();
    const cleanAccessLevel = String(accessLevel || '').trim();

    if (!USE_PG) {
      const idx = mem.storageAcls.findIndex(
        (a) =>
          matchTenant(a.tenant_id, clean) &&
          a.node_id === nodeId &&
          a.target_type === cleanTargetType &&
          a.target_value === cleanTargetValue,
      );
      if (idx >= 0) {
        const next = {
          ...mem.storageAcls[idx],
          access_level: cleanAccessLevel,
          granted_by_email: grantedByEmail || mem.storageAcls[idx].granted_by_email,
          updated_at: nowIso,
        };
        mem.storageAcls[idx] = next;
        return normalizeStorageAclRow({ ...next });
      }
      const created = {
        id: crypto.randomUUID(),
        tenant_id: clean,
        node_id: nodeId,
        target_type: cleanTargetType,
        target_value: cleanTargetValue,
        access_level: cleanAccessLevel,
        granted_by_email: grantedByEmail || null,
        created_at: nowIso,
        updated_at: nowIso,
      };
      mem.storageAcls.push(created);
      return normalizeStorageAclRow({ ...created });
    }

    const { rows } = await pool.query(
      `INSERT INTO storage_svc.storage_acls
       (tenant_id, node_id, target_type, target_value, access_level, granted_by_email)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id, node_id, target_type, target_value) DO UPDATE SET
         access_level = EXCLUDED.access_level,
         granted_by_email = COALESCE(EXCLUDED.granted_by_email, storage_svc.storage_acls.granted_by_email),
         updated_at = NOW()
       RETURNING *`,
      [clean, nodeId, cleanTargetType, cleanTargetValue, cleanAccessLevel, grantedByEmail || null],
    );
    return normalizeStorageAclRow(rows[0]);
  },

  async deleteNodeAcl(tenantId, nodeId, aclId) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId) || !isUuid(aclId)) return null;
    if (!USE_PG) {
      const idx = mem.storageAcls.findIndex(
        (a) => a.id === aclId && a.node_id === nodeId && matchTenant(a.tenant_id, clean),
      );
      if (idx === -1) return null;
      const [removed] = mem.storageAcls.splice(idx, 1);
      return normalizeStorageAclRow({ ...removed });
    }
    const { rows } = await pool.query(
      'DELETE FROM storage_svc.storage_acls WHERE id = $1 AND node_id = $2 AND tenant_id = $3 RETURNING *',
      [aclId, nodeId, clean],
    );
    return normalizeStorageAclRow(rows[0]);
  },

  // ---------------------------------------------------------------------------
  // 6.5 Versions
  // ---------------------------------------------------------------------------
  async createVersion(tenantId, nodeId, { sizeBytes = 0, sha256Hash = null, storageKey = null, uploadedByEmail = null, comment = null } = {}) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId)) {
      const err = new Error('Nó não encontrado.');
      err.statusCode = 404;
      throw err;
    }
    const node = await this.getNodeById(clean, nodeId, { includeTrashed: true });
    if (!node) {
      const err = new Error('Nó não encontrado para este tenant.');
      err.statusCode = 404;
      throw err;
    }

    const nowIso = new Date().toISOString();
    const safeSize = Math.max(0, Math.round(Number(sizeBytes || 0)));

    if (!USE_PG) {
      const existing = mem.storageVersions.filter(
        (v) => matchTenant(v.tenant_id, clean) && v.node_id === nodeId,
      );
      const nextVer =
        existing.length > 0
          ? Math.max(...existing.map((v) => Number(v.version_number || 0))) + 1
          : 1;
      const created = {
        id: crypto.randomUUID(),
        tenant_id: clean,
        node_id: nodeId,
        version_number: nextVer,
        storage_key: storageKey,
        size_bytes: safeSize,
        sha256_hash: sha256Hash,
        uploaded_by_email: uploadedByEmail,
        comment,
        created_at: nowIso,
      };
      mem.storageVersions.push(created);
      const allForNode = mem.storageVersions
        .filter((v) => matchTenant(v.tenant_id, clean) && v.node_id === nodeId)
        .sort((a, b) => Number(b.version_number) - Number(a.version_number));
      if (allForNode.length > 10) {
        const removeIds = new Set(allForNode.slice(10).map((v) => v.id));
        mem.storageVersions = mem.storageVersions.filter((v) => !removeIds.has(v.id));
      }
      const nodeIdx = mem.storageNodes.findIndex(
        (n) => n.id === nodeId && matchTenant(n.tenant_id, clean),
      );
      if (nodeIdx >= 0) {
        mem.storageNodes[nodeIdx] = {
          ...mem.storageNodes[nodeIdx],
          current_version: nextVer,
          updated_at: nowIso,
        };
      }
      return normalizeStorageVersionRow({ ...created });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(202604, hashtext($1))', [nodeId]);
      const verRes = await client.query(
        'SELECT COALESCE(MAX(version_number), 0) + 1 AS next_ver FROM storage_svc.storage_versions WHERE node_id = $1',
        [nodeId],
      );
      const nextVer = Number(verRes.rows[0].next_ver);
      const { rows } = await client.query(
        `INSERT INTO storage_svc.storage_versions
         (tenant_id, node_id, version_number, storage_key, size_bytes, sha256_hash, uploaded_by_email, comment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [clean, nodeId, nextVer, storageKey, safeSize, sha256Hash, uploadedByEmail, comment],
      );
      await client.query(
        `DELETE FROM storage_svc.storage_versions
         WHERE tenant_id = $1 AND node_id = $2
           AND id NOT IN (
             SELECT id FROM storage_svc.storage_versions
             WHERE tenant_id = $1 AND node_id = $2
             ORDER BY version_number DESC
             LIMIT 10
           )`,
        [clean, nodeId],
      );
      await client.query(
        'UPDATE storage_svc.storage_nodes SET current_version = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
        [nodeId, clean, nextVer],
      );
      await client.query('COMMIT');
      return normalizeStorageVersionRow(rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async listVersions(tenantId, nodeId) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId)) return [];
    if (!USE_PG) {
      return mem.storageVersions
        .filter((v) => matchTenant(v.tenant_id, clean) && v.node_id === nodeId)
        .sort((a, b) => Number(b.version_number) - Number(a.version_number))
        .map((v) => normalizeStorageVersionRow({ ...v }));
    }
    const { rows } = await pool.query(
      'SELECT * FROM storage_svc.storage_versions WHERE tenant_id = $1 AND node_id = $2 ORDER BY version_number DESC',
      [clean, nodeId],
    );
    return rows.map(normalizeStorageVersionRow);
  },

  async getVersion(tenantId, nodeId, versionNumber) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId)) return null;
    const ver = Number(versionNumber);
    if (!Number.isFinite(ver) || ver < 1) return null;
    if (!USE_PG) {
      const found = mem.storageVersions.find(
        (v) =>
          matchTenant(v.tenant_id, clean) &&
          v.node_id === nodeId &&
          Number(v.version_number) === ver,
      );
      return found ? normalizeStorageVersionRow({ ...found }) : null;
    }
    const { rows } = await pool.query(
      'SELECT * FROM storage_svc.storage_versions WHERE tenant_id = $1 AND node_id = $2 AND version_number = $3 LIMIT 1',
      [clean, nodeId, ver],
    );
    return normalizeStorageVersionRow(rows[0]);
  },

  // ---------------------------------------------------------------------------
  // 6.6 Temporary Share Links
  // ---------------------------------------------------------------------------
  async createTempLink(
    tenantId,
    nodeId,
    { tokenHash, createdByEmail, passwordHash = null, allowDownload = false, expiresAt },
  ) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId)) {
      const err = new Error('Nó não encontrado.');
      err.statusCode = 404;
      throw err;
    }
    const node = await this.getNodeById(clean, nodeId);
    if (!node) {
      const err = new Error('Arquivo não encontrado para este tenant.');
      err.statusCode = 404;
      throw err;
    }
    const nowIso = new Date().toISOString();
    const expIso = toIso(expiresAt);

    if (!USE_PG) {
      const created = {
        id: crypto.randomUUID(),
        tenant_id: clean,
        node_id: nodeId,
        token_hash: String(tokenHash),
        password_hash: passwordHash,
        allow_download: Boolean(allowDownload),
        expires_at: expIso,
        revoked_at: null,
        access_count: 0,
        last_accessed_at: null,
        created_by_email: String(createdByEmail),
        created_at: nowIso,
      };
      mem.storageTempLinks.push(created);
      return normalizeStorageTempLinkRow({ ...created });
    }

    const { rows } = await pool.query(
      `INSERT INTO storage_svc.storage_temp_links
       (tenant_id, node_id, token_hash, password_hash, allow_download, expires_at, created_by_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [clean, nodeId, String(tokenHash), passwordHash, Boolean(allowDownload), expIso, String(createdByEmail)],
    );
    return normalizeStorageTempLinkRow(rows[0]);
  },

  async getTempLinkByTokenHash(tokenHash) {
    if (!tokenHash) return null;
    if (!USE_PG) {
      const found = mem.storageTempLinks.find((l) => l.token_hash === String(tokenHash));
      return found ? normalizeStorageTempLinkRow({ ...found }) : null;
    }
    const { rows } = await pool.query(
      'SELECT * FROM storage_svc.storage_temp_links WHERE token_hash = $1 LIMIT 1',
      [String(tokenHash)],
    );
    return normalizeStorageTempLinkRow(rows[0]);
  },

  async listTempLinks(tenantId, { nodeId } = {}) {
    const clean = requireCleanTenantId(tenantId);
    if (nodeId && !isUuid(nodeId)) return [];
    if (!USE_PG) {
      return mem.storageTempLinks
        .filter((l) => matchTenant(l.tenant_id, clean) && (!nodeId || l.node_id === nodeId))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .map((l) => normalizeStorageTempLinkRow({ ...l }));
    }
    if (nodeId) {
      const { rows } = await pool.query(
        'SELECT * FROM storage_svc.storage_temp_links WHERE tenant_id = $1 AND node_id = $2 ORDER BY created_at DESC',
        [clean, nodeId],
      );
      return rows.map(normalizeStorageTempLinkRow);
    }
    const { rows } = await pool.query(
      'SELECT * FROM storage_svc.storage_temp_links WHERE tenant_id = $1 ORDER BY created_at DESC',
      [clean],
    );
    return rows.map(normalizeStorageTempLinkRow);
  },

  async incrementTempLinkAccess(linkId) {
    if (!isUuid(linkId)) return null;
    const nowIso = new Date().toISOString();
    if (!USE_PG) {
      const idx = mem.storageTempLinks.findIndex((l) => l.id === linkId);
      if (idx === -1) return null;
      const next = {
        ...mem.storageTempLinks[idx],
        access_count: Number(mem.storageTempLinks[idx].access_count || 0) + 1,
        last_accessed_at: nowIso,
      };
      mem.storageTempLinks[idx] = next;
      return normalizeStorageTempLinkRow({ ...next });
    }
    const { rows } = await pool.query(
      `UPDATE storage_svc.storage_temp_links
       SET access_count = access_count + 1,
           last_accessed_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [linkId],
    );
    return normalizeStorageTempLinkRow(rows[0]);
  },

  async revokeTempLink(tenantId, linkId) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(linkId)) return null;
    const nowIso = new Date().toISOString();
    if (!USE_PG) {
      const idx = mem.storageTempLinks.findIndex(
        (l) => l.id === linkId && matchTenant(l.tenant_id, clean),
      );
      if (idx === -1) return null;
      const next = {
        ...mem.storageTempLinks[idx],
        revoked_at: mem.storageTempLinks[idx].revoked_at || nowIso,
      };
      mem.storageTempLinks[idx] = next;
      return normalizeStorageTempLinkRow({ ...next });
    }
    const { rows } = await pool.query(
      `UPDATE storage_svc.storage_temp_links
       SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [linkId, clean],
    );
    return normalizeStorageTempLinkRow(rows[0]);
  },

  async deleteTempLink(tenantId, linkId) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(linkId)) return null;
    if (!USE_PG) {
      const idx = mem.storageTempLinks.findIndex(
        (l) => l.id === linkId && matchTenant(l.tenant_id, clean),
      );
      if (idx === -1) return null;
      const [removed] = mem.storageTempLinks.splice(idx, 1);
      return normalizeStorageTempLinkRow({ ...removed });
    }
    const { rows } = await pool.query(
      `DELETE FROM storage_svc.storage_temp_links
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [linkId, clean],
    );
    return normalizeStorageTempLinkRow(rows[0]);
  },

  // ---------------------------------------------------------------------------
  // 6.7 Sheets Live Sessions & Cell History
  // ---------------------------------------------------------------------------
  async getSheetSession(tenantId, nodeId) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId)) return null;
    if (!USE_PG) {
      const found = mem.sheetSessions.find(
        (s) => matchTenant(s.tenant_id, clean) && s.node_id === nodeId,
      );
      return found ? normalizeSheetSessionRow({ ...found }) : null;
    }
    const { rows } = await pool.query(
      'SELECT * FROM storage_svc.sheet_sessions WHERE tenant_id = $1 AND node_id = $2 LIMIT 1',
      [clean, nodeId],
    );
    return normalizeSheetSessionRow(rows[0]);
  },

  async upsertSheetSession(
    tenantId,
    nodeId,
    { workbookJson = {}, expectedRev, lastSavedByEmail = null, force = false } = {},
  ) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId)) {
      const err = new Error('Nó de planilha inválido.');
      err.statusCode = 400;
      throw err;
    }
    const node = await this.getNodeById(clean, nodeId, { includeTrashed: true });
    if (!node) {
      const err = new Error('Planilha não encontrada para este tenant.');
      err.statusCode = 404;
      throw err;
    }
    const nowIso = new Date().toISOString();

    if (!USE_PG) {
      const idx = mem.sheetSessions.findIndex(
        (s) => matchTenant(s.tenant_id, clean) && s.node_id === nodeId,
      );
      if (idx >= 0) {
        const current = mem.sheetSessions[idx];
        if (!force && expectedRev !== undefined && Number(expectedRev) !== Number(current.rev)) {
          const err = new Error('Conflito de revisão na planilha.');
          err.statusCode = 409;
          err.code = 'SHEET_REV_CONFLICT';
          throw err;
        }
        const next = {
          ...current,
          rev: Number(current.rev) + 1,
          workbook_json: workbookJson && typeof workbookJson === 'object' ? workbookJson : {},
          last_saved_by_email: lastSavedByEmail ?? current.last_saved_by_email,
          last_saved_at: nowIso,
          updated_at: nowIso,
        };
        mem.sheetSessions[idx] = next;
        return normalizeSheetSessionRow({ ...next });
      }
      const created = {
        id: crypto.randomUUID(),
        tenant_id: clean,
        node_id: nodeId,
        rev: 1,
        workbook_json: workbookJson && typeof workbookJson === 'object' ? workbookJson : {},
        last_saved_by_email: lastSavedByEmail,
        last_saved_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      };
      mem.sheetSessions.push(created);
      return normalizeSheetSessionRow({ ...created });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existingRes = await client.query(
        'SELECT * FROM storage_svc.sheet_sessions WHERE tenant_id = $1 AND node_id = $2 FOR UPDATE',
        [clean, nodeId],
      );
      if (existingRes.rows[0]) {
        const current = existingRes.rows[0];
        if (!force && expectedRev !== undefined && Number(expectedRev) !== Number(current.rev)) {
          const err = new Error('Conflito de revisão na planilha.');
          err.statusCode = 409;
          err.code = 'SHEET_REV_CONFLICT';
          throw err;
        }
        const { rows } = await client.query(
          `UPDATE storage_svc.sheet_sessions
           SET rev = rev + 1,
               workbook_json = $3::jsonb,
               last_saved_by_email = COALESCE($4, last_saved_by_email),
               last_saved_at = NOW(),
               updated_at = NOW()
           WHERE id = $1 AND tenant_id = $2
           RETURNING *`,
          [current.id, clean, JSON.stringify(workbookJson || {}), lastSavedByEmail],
        );
        await client.query('COMMIT');
        return normalizeSheetSessionRow(rows[0]);
      }

      const { rows } = await client.query(
        `INSERT INTO storage_svc.sheet_sessions
         (tenant_id, node_id, rev, workbook_json, last_saved_by_email, last_saved_at)
         VALUES ($1,$2,1,$3::jsonb,$4,NOW())
         RETURNING *`,
        [clean, nodeId, JSON.stringify(workbookJson || {}), lastSavedByEmail],
      );
      await client.query('COMMIT');
      return normalizeSheetSessionRow(rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async appendSheetCellHistory(tenantId, nodeId, entries) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId)) {
      const err = new Error('Nó de planilha inválido.');
      err.statusCode = 400;
      throw err;
    }
    const node = await this.getNodeById(clean, nodeId, { includeTrashed: true });
    if (!node) {
      const err = new Error('Planilha não encontrada para este tenant.');
      err.statusCode = 404;
      throw err;
    }

    const list = Array.isArray(entries) ? entries : [entries];
    if (list.length === 0) return [];
    const nowIso = new Date().toISOString();
    const toNullableText = (val) => (val === null || val === undefined ? null : String(val));

    if (!USE_PG) {
      const inserted = list.map((e) => {
        const oldVal = e.oldValue !== undefined ? e.oldValue : e.old_value;
        const newVal = e.newValue !== undefined ? e.newValue : e.new_value;
        const oldForm = e.oldFormula !== undefined ? e.oldFormula : e.old_formula;
        const newForm = e.newFormula !== undefined ? e.newFormula : e.new_formula;
        const actorName = e.actorName !== undefined ? e.actorName : e.actor_name;
        const row = {
          id: crypto.randomUUID(),
          tenant_id: clean,
          node_id: nodeId,
          rev: Number(e.rev ?? 1),
          tab_name: String(e.tabName ?? e.tab_name ?? 'Planilha1'),
          cell_ref: String(e.cellRef ?? e.cell_ref ?? 'A1'),
          old_value: toNullableText(oldVal),
          new_value: toNullableText(newVal),
          old_formula: toNullableText(oldForm),
          new_formula: toNullableText(newForm),
          actor_email: String(e.actorEmail ?? e.actor_email ?? ''),
          actor_name: toNullableText(actorName),
          created_at: nowIso,
        };
        mem.sheetCellHistory.push(row);
        return normalizeSheetCellHistoryRow({ ...row });
      });
      return inserted;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = [];
      for (const e of list) {
        const oldVal = e.oldValue !== undefined ? e.oldValue : e.old_value;
        const newVal = e.newValue !== undefined ? e.newValue : e.new_value;
        const oldForm = e.oldFormula !== undefined ? e.oldFormula : e.old_formula;
        const newForm = e.newFormula !== undefined ? e.newFormula : e.new_formula;
        const actorName = e.actorName !== undefined ? e.actorName : e.actor_name;
        const { rows } = await client.query(
          `INSERT INTO storage_svc.sheet_cell_history
           (tenant_id, node_id, rev, tab_name, cell_ref, old_value, new_value, old_formula, new_formula, actor_email, actor_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING *`,
          [
            clean,
            nodeId,
            Number(e.rev ?? 1),
            String(e.tabName ?? e.tab_name ?? 'Planilha1'),
            String(e.cellRef ?? e.cell_ref ?? 'A1'),
            toNullableText(oldVal),
            toNullableText(newVal),
            toNullableText(oldForm),
            toNullableText(newForm),
            String(e.actorEmail ?? e.actor_email ?? ''),
            toNullableText(actorName),
          ],
        );
        inserted.push(normalizeSheetCellHistoryRow(rows[0]));
      }
      await client.query('COMMIT');
      return inserted;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async listSheetCellHistory(tenantId, nodeId, { tabName, cellRef, limit = 100 } = {}) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId)) return [];
    const safeLimit = Math.max(1, Math.min(500, Math.round(Number(limit || 100))));

    if (!USE_PG) {
      const matched = mem.sheetCellHistory.filter((h) => {
        if (!matchTenant(h.tenant_id, clean) || h.node_id !== nodeId) return false;
        if (tabName && h.tab_name !== tabName) return false;
        if (cellRef && h.cell_ref !== cellRef) return false;
        return true;
      });
      return matched
        .slice(-safeLimit)
        .reverse()
        .map((h) => normalizeSheetCellHistoryRow({ ...h }));
    }

    const params = [clean, nodeId];
    const where = ['tenant_id = $1', 'node_id = $2'];
    if (tabName) {
      params.push(tabName);
      where.push(`tab_name = $${params.length}`);
    }
    if (cellRef) {
      params.push(cellRef);
      where.push(`cell_ref = $${params.length}`);
    }
    params.push(safeLimit);

    const { rows } = await pool.query(
      `SELECT * FROM storage_svc.sheet_cell_history
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return rows.map(normalizeSheetCellHistoryRow);
  },

  // ---------------------------------------------------------------------------
  // 6.8 Desktop Edit Auto-Sync Sessions (Agente Windows / Excel & Apps Nativos)
  // ---------------------------------------------------------------------------
  async createDesktopEditSession(
    tenantId,
    nodeId,
    { tokenHash, userEmail, userName = null, userRole = 'collaborator', lastVersion = 1, expiresAt },
  ) {
    const clean = requireCleanTenantId(tenantId);
    if (!isUuid(nodeId)) {
      const err = new Error('Arquivo inválido.');
      err.statusCode = 400;
      throw err;
    }
    const nowIso = new Date().toISOString();
    const expIso = toIso(expiresAt);
    const safeVer = Math.max(1, Math.round(Number(lastVersion || 1)));

    if (!USE_PG) {
      const created = {
        id: crypto.randomUUID(),
        tenant_id: clean,
        node_id: nodeId,
        token_hash: String(tokenHash),
        user_email: String(userEmail).toLowerCase(),
        user_name: userName || null,
        user_role: String(userRole || 'collaborator'),
        status: 'pending',
        sync_count: 0,
        last_version: safeVer,
        last_synced_at: null,
        opened_at: null,
        expires_at: expIso,
        closed_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      };
      mem.desktopEditSessions.push(created);
      return normalizeDesktopEditSessionRow({ ...created });
    }

    const { rows } = await pool.query(
      `INSERT INTO storage_svc.desktop_edit_sessions
       (tenant_id, node_id, token_hash, user_email, user_name, user_role, status, sync_count, last_version, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',0,$7,$8)
       RETURNING *`,
      [clean, nodeId, String(tokenHash), String(userEmail).toLowerCase(), userName || null, String(userRole || 'collaborator'), safeVer, expIso],
    );
    return normalizeDesktopEditSessionRow(rows[0]);
  },

  async getDesktopEditSessionByTokenHash(tokenHash) {
    if (!tokenHash) return null;
    if (!USE_PG) {
      const found = mem.desktopEditSessions.find((s) => s.token_hash === String(tokenHash));
      return found ? normalizeDesktopEditSessionRow({ ...found }) : null;
    }
    const { rows } = await pool.query(
      'SELECT * FROM storage_svc.desktop_edit_sessions WHERE token_hash = $1 LIMIT 1',
      [String(tokenHash)],
    );
    return normalizeDesktopEditSessionRow(rows[0]);
  },

  async updateDesktopEditSession(sessionId, patch = {}) {
    if (!isUuid(sessionId)) return null;
    const nowIso = new Date().toISOString();
    if (!USE_PG) {
      const idx = mem.desktopEditSessions.findIndex((s) => s.id === sessionId);
      if (idx === -1) return null;
      const prev = mem.desktopEditSessions[idx];
      const next = {
        ...prev,
        status: patch.status !== undefined ? String(patch.status) : prev.status,
        opened_at: patch.openedAt !== undefined ? toIso(patch.openedAt) : prev.opened_at,
        sync_count:
          patch.incrementSync
            ? Number(prev.sync_count || 0) + 1
            : patch.syncCount !== undefined
              ? Math.max(0, Math.round(Number(patch.syncCount)))
              : prev.sync_count,
        last_version:
          patch.lastVersion !== undefined
            ? Math.max(1, Math.round(Number(patch.lastVersion)))
            : prev.last_version,
        last_synced_at:
          patch.lastSyncedAt !== undefined ? toIso(patch.lastSyncedAt) : prev.last_synced_at,
        expires_at: patch.expiresAt !== undefined ? toIso(patch.expiresAt) : prev.expires_at,
        closed_at: patch.closedAt !== undefined ? toIso(patch.closedAt) : prev.closed_at,
        updated_at: nowIso,
      };
      mem.desktopEditSessions[idx] = next;
      return normalizeDesktopEditSessionRow({ ...next });
    }

    const sets = ['updated_at = NOW()'];
    const params = [sessionId];
    if (patch.status !== undefined) {
      params.push(String(patch.status));
      sets.push(`status = $${params.length}`);
    }
    if (patch.openedAt !== undefined) {
      params.push(toIso(patch.openedAt));
      sets.push(`opened_at = COALESCE(opened_at, $${params.length})`);
    }
    if (patch.incrementSync) {
      sets.push('sync_count = sync_count + 1');
    } else if (patch.syncCount !== undefined) {
      params.push(Math.max(0, Math.round(Number(patch.syncCount))));
      sets.push(`sync_count = $${params.length}`);
    }
    if (patch.lastVersion !== undefined) {
      params.push(Math.max(1, Math.round(Number(patch.lastVersion))));
      sets.push(`last_version = $${params.length}`);
    }
    if (patch.lastSyncedAt !== undefined) {
      params.push(toIso(patch.lastSyncedAt));
      sets.push(`last_synced_at = $${params.length}`);
    }
    if (patch.expiresAt !== undefined) {
      params.push(toIso(patch.expiresAt));
      sets.push(`expires_at = $${params.length}`);
    }
    if (patch.closedAt !== undefined) {
      params.push(toIso(patch.closedAt));
      sets.push(`closed_at = COALESCE(closed_at, $${params.length})`);
    }

    const { rows } = await pool.query(
      `UPDATE storage_svc.desktop_edit_sessions
       SET ${sets.join(', ')}
       WHERE id = $1
       RETURNING *`,
      params,
    );
    return normalizeDesktopEditSessionRow(rows[0]);
  },
};
