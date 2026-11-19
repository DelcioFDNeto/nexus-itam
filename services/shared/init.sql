-- =============================================================================
-- NEXUS ITAM v3.0 — PostgreSQL 16 Multi-Schema DDL (Schema-per-Service Pattern)
-- =============================================================================
-- Isola logicamente os dados de cada microsserviço em schemas dedicados,
-- garantindo baixo acoplamento, integridade transacional ACID e multi-tenancy.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS auth_svc;
CREATE SCHEMA IF NOT EXISTS assets_svc;
CREATE SCHEMA IF NOT EXISTS tickets_svc;
CREATE SCHEMA IF NOT EXISTS compliance_svc;
CREATE SCHEMA IF NOT EXISTS telemetry_svc;
CREATE SCHEMA IF NOT EXISTS storage_svc;

-- -----------------------------------------------------------------------------
-- 1. SCHEMA: auth_svc (API Gateway / Identidade, Tenants & RBAC)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_svc.tenants (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    cnpj VARCHAR(24),
    plan VARCHAR(32) NOT NULL DEFAULT 'enterprise',
    asset_prefix VARCHAR(12) NOT NULL DEFAULT 'SHL',
    agent_token_hash VARCHAR(128) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'active',
    primary_color VARCHAR(32),
    logo_url TEXT,
    overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
    custom_contract JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE auth_svc.tenants ADD COLUMN IF NOT EXISTS primary_color VARCHAR(32);
ALTER TABLE auth_svc.tenants ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE auth_svc.tenants ADD COLUMN IF NOT EXISTS overrides JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE auth_svc.tenants ADD COLUMN IF NOT EXISTS custom_contract JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS auth_svc.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL REFERENCES auth_svc.tenants(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    email VARCHAR(180) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'member', 'operator', 'viewer', 'collaborator', 'superadmin')),
    department VARCHAR(120) DEFAULT 'Tecnologia da Informação',
    job_title VARCHAR(120) DEFAULT 'Analista',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_tenant_email ON auth_svc.users(tenant_id, email);

ALTER TABLE auth_svc.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE auth_svc.users ADD CONSTRAINT users_role_check
    CHECK (role IN ('owner', 'admin', 'manager', 'member', 'operator', 'viewer', 'collaborator', 'superadmin'));

-- -----------------------------------------------------------------------------
-- 2. SCHEMA: assets_svc (Microsserviço 1 — Gestão de Ativos & Patrimônio)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assets_svc.assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    internal_id VARCHAR(64) NOT NULL,
    type VARCHAR(64) NOT NULL,
    brand VARCHAR(80) NOT NULL,
    model VARCHAR(120) NOT NULL,
    serial_number VARCHAR(120),
    status VARCHAR(40) NOT NULL DEFAULT 'Disponível',
    location VARCHAR(120) DEFAULT 'Matriz - TI',
    department VARCHAR(120) DEFAULT 'Estoque TI',
    assigned_to_name VARCHAR(160),
    assigned_to_email VARCHAR(180),
    purchase_value NUMERIC(12, 2) DEFAULT 0,
    specs JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_assets_tenant_internal_id UNIQUE (tenant_id, internal_id)
);

CREATE TABLE IF NOT EXISTS assets_svc.asset_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    asset_id UUID NOT NULL REFERENCES assets_svc.assets(id) ON DELETE CASCADE,
    action VARCHAR(80) NOT NULL,
    actor_name VARCHAR(160) NOT NULL,
    actor_email VARCHAR(180),
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assets_tenant ON assets_svc.assets(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_assigned_email ON assets_svc.assets(tenant_id, assigned_to_email);
CREATE INDEX IF NOT EXISTS idx_asset_history_asset ON assets_svc.asset_history(tenant_id, asset_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 3. SCHEMA: tickets_svc (Microsserviço 2 — Helpdesk & Autoatendimento)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets_svc.tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    protocol VARCHAR(32) NOT NULL UNIQUE,
    tenant_id VARCHAR(64) NOT NULL,
    requester_name VARCHAR(160) NOT NULL,
    requester_email VARCHAR(180) NOT NULL,
    department VARCHAR(120),
    asset_id VARCHAR(64),
    asset_tag VARCHAR(64),
    category VARCHAR(64) NOT NULL,
    priority VARCHAR(24) NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(32) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    assigned_tech_name VARCHAR(160),
    resolution_notes TEXT,
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
    sla_due_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tickets_svc.ticket_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets_svc.tickets(id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL,
    author_name VARCHAR(160) NOT NULL,
    author_email VARCHAR(180) NOT NULL,
    author_role VARCHAR(32) NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tickets_svc.tickets
    ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE tickets_svc.ticket_comments
    ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_tickets_tenant_status ON tickets_svc.tickets(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_requester ON tickets_svc.tickets(tenant_id, requester_email);

-- -----------------------------------------------------------------------------
-- 4. SCHEMA: compliance_svc (Microsserviço 3 — Termos CLT & Hash-Chain Audit)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compliance_svc.responsibility_terms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    term_type VARCHAR(32) NOT NULL CHECK (term_type IN ('entrega', 'devolucao', 'emprestimo')),
    employee_name VARCHAR(160) NOT NULL,
    employee_email VARCHAR(180) NOT NULL,
    employee_cpf VARCHAR(24),
    department VARCHAR(120),
    assets_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
    legal_clause TEXT NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'revoked')),
    document_hash VARCHAR(64) NOT NULL,
    signature_hash VARCHAR(64),
    signer_ip VARCHAR(64),
    signer_user_agent VARCHAR(255),
    issued_by VARCHAR(160) NOT NULL,
    signed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS compliance_svc.audit_chain (
    seq BIGSERIAL PRIMARY KEY,
    id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    actor_email VARCHAR(180) NOT NULL,
    actor_role VARCHAR(32) NOT NULL,
    action VARCHAR(80) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    resource_id VARCHAR(120) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    prev_hash VARCHAR(64) NOT NULL,
    entry_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_terms_tenant_email ON compliance_svc.responsibility_terms(tenant_id, employee_email);
CREATE INDEX IF NOT EXISTS idx_audit_chain_tenant_seq ON compliance_svc.audit_chain(tenant_id, seq ASC);

-- -----------------------------------------------------------------------------
-- 5. SCHEMA: telemetry_svc (Microsserviço 4 — Telemetria RMM & Comandos)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telemetry_svc.device_telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    device_key VARCHAR(120) NOT NULL,
    hostname VARCHAR(120) NOT NULL,
    serial_number VARCHAR(120),
    os_version VARCHAR(120) DEFAULT 'Windows 11 Pro 24H2',
    agent_version VARCHAR(32) DEFAULT '3.2.0',
    ip_address VARCHAR(64),
    logged_user VARCHAR(120),
    cpu_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
    ram_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
    disk_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
    antivirus_active BOOLEAN NOT NULL DEFAULT TRUE,
    firewall_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_telemetry_tenant_device UNIQUE (tenant_id, device_key)
);

CREATE TABLE IF NOT EXISTS telemetry_svc.remote_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    device_key VARCHAR(120) NOT NULL,
    command_type VARCHAR(64) NOT NULL,
    payload TEXT,
    issued_by VARCHAR(180) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'queued',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_tenant_seen ON telemetry_svc.device_telemetry(tenant_id, last_seen_at DESC);

-- -----------------------------------------------------------------------------
-- 6. SCHEMA: storage_svc (Microsserviço 5 — Nexus Cloud Vault & Conector VPS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS storage_svc.vps_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) UNIQUE NOT NULL,
    provider_type VARCHAR(24) NOT NULL CHECK (provider_type IN ('sftp', 'agent_node', 's3', 'webdav')),
    label VARCHAR(160),
    host VARCHAR(255),
    port INT,
    username VARCHAR(120),
    root_path VARCHAR(512) NOT NULL DEFAULT '/srv/nexus-vault',
    endpoint_url TEXT,
    bucket VARCHAR(160),
    region VARCHAR(64),
    encrypted_credentials TEXT NOT NULL,
    quota_bytes BIGINT NOT NULL DEFAULT 107374182400 CHECK (quota_bytes >= 0),
    used_bytes BIGINT NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
    status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'error', 'disconnected')),
    last_check_at TIMESTAMPTZ,
    last_error TEXT,
    latency_ms INT,
    free_bytes BIGINT,
    total_bytes BIGINT,
    initialized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS storage_svc.storage_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    parent_id UUID REFERENCES storage_svc.storage_nodes(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    node_type VARCHAR(24) NOT NULL CHECK (node_type IN ('folder', 'file', 'spreadsheet')),
    virtual_path TEXT NOT NULL,
    mime_type VARCHAR(160),
    size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    sha256_hash VARCHAR(64),
    current_version INT NOT NULL DEFAULT 1 CHECK (current_version >= 1),
    department_scope VARCHAR(120),
    locked_by_email VARCHAR(255),
    locked_at TIMESTAMPTZ,
    is_trashed BOOLEAN NOT NULL DEFAULT FALSE,
    trashed_at TIMESTAMPTZ,
    trashed_by_email VARCHAR(255),
    original_parent_id UUID,
    original_virtual_path TEXT,
    trash_key VARCHAR(255),
    created_by_email VARCHAR(255),
    updated_by_email VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_storage_nodes_active_path
    ON storage_svc.storage_nodes(tenant_id, virtual_path)
    WHERE is_trashed = FALSE;

CREATE INDEX IF NOT EXISTS idx_storage_nodes_tenant_parent
    ON storage_svc.storage_nodes(tenant_id, parent_id, is_trashed);

CREATE INDEX IF NOT EXISTS idx_storage_nodes_tenant_trashed
    ON storage_svc.storage_nodes(tenant_id, is_trashed, trashed_at DESC);

CREATE INDEX IF NOT EXISTS idx_storage_nodes_tenant_sha256
    ON storage_svc.storage_nodes(tenant_id, sha256_hash);

CREATE TABLE IF NOT EXISTS storage_svc.storage_acls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    node_id UUID NOT NULL REFERENCES storage_svc.storage_nodes(id) ON DELETE CASCADE,
    target_type VARCHAR(24) NOT NULL CHECK (target_type IN ('department', 'role', 'user')),
    target_value VARCHAR(255) NOT NULL,
    access_level VARCHAR(24) NOT NULL CHECK (access_level IN ('none', 'viewer_online', 'reader', 'editor', 'full_control')),
    granted_by_email VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_storage_acls_target UNIQUE (tenant_id, node_id, target_type, target_value)
);

CREATE INDEX IF NOT EXISTS idx_storage_acls_tenant_node
    ON storage_svc.storage_acls(tenant_id, node_id);

CREATE TABLE IF NOT EXISTS storage_svc.storage_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    node_id UUID NOT NULL REFERENCES storage_svc.storage_nodes(id) ON DELETE CASCADE,
    version_number INT NOT NULL CHECK (version_number >= 1),
    storage_key TEXT,
    size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    sha256_hash VARCHAR(64),
    uploaded_by_email VARCHAR(255),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_storage_versions_node_ver UNIQUE (node_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_storage_versions_node
    ON storage_svc.storage_versions(tenant_id, node_id, version_number DESC);

CREATE TABLE IF NOT EXISTS storage_svc.storage_temp_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    node_id UUID NOT NULL REFERENCES storage_svc.storage_nodes(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) UNIQUE NOT NULL,
    password_hash TEXT,
    allow_download BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    access_count INT NOT NULL DEFAULT 0 CHECK (access_count >= 0),
    last_accessed_at TIMESTAMPTZ,
    created_by_email VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_storage_temp_links_tenant_node
    ON storage_svc.storage_temp_links(tenant_id, node_id, created_at DESC);

CREATE TABLE IF NOT EXISTS storage_svc.sheet_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    node_id UUID UNIQUE NOT NULL REFERENCES storage_svc.storage_nodes(id) ON DELETE CASCADE,
    rev INT NOT NULL DEFAULT 1 CHECK (rev >= 1),
    workbook_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_saved_by_email VARCHAR(255),
    last_saved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS storage_svc.sheet_cell_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    node_id UUID NOT NULL REFERENCES storage_svc.storage_nodes(id) ON DELETE CASCADE,
    rev INT NOT NULL,
    tab_name VARCHAR(120) NOT NULL,
    cell_ref VARCHAR(32) NOT NULL,
    old_value TEXT,
    new_value TEXT,
    old_formula TEXT,
    new_formula TEXT,
    actor_email VARCHAR(255) NOT NULL,
    actor_name VARCHAR(160),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sheet_cell_history_node
    ON storage_svc.sheet_cell_history(tenant_id, node_id, created_at DESC);

CREATE TABLE IF NOT EXISTS storage_svc.desktop_edit_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    node_id UUID NOT NULL REFERENCES storage_svc.storage_nodes(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) UNIQUE NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    user_name VARCHAR(160),
    user_role VARCHAR(32) NOT NULL DEFAULT 'collaborator',
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    sync_count INT NOT NULL DEFAULT 0 CHECK (sync_count >= 0),
    last_version INT NOT NULL DEFAULT 1 CHECK (last_version >= 1),
    last_synced_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_desktop_edit_sessions_tenant_node
    ON storage_svc.desktop_edit_sessions(tenant_id, node_id, created_at DESC);
