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

-- -----------------------------------------------------------------------------
-- 1. SCHEMA: auth_svc (API Gateway / Identidade, Tenants & RBAC)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_svc.tenants (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    cnpj VARCHAR(24),
    plan VARCHAR(32) NOT NULL DEFAULT 'enterprise',
    asset_prefix VARCHAR(12) NOT NULL DEFAULT 'NEX',
    agent_token_hash VARCHAR(128) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_svc.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL REFERENCES auth_svc.tenants(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    email VARCHAR(180) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'operator', 'viewer', 'collaborator')),
    department VARCHAR(120) DEFAULT 'Tecnologia da Informação',
    job_title VARCHAR(120) DEFAULT 'Analista',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_tenant_email ON auth_svc.users(tenant_id, email);

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
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
