-- FireControl 360 | PostgreSQL bootstrap schema
-- Tenant isolation: API must set app.tenant_id per transaction after authentication.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name VARCHAR(180) NOT NULL,
  trade_name VARCHAR(180),
  tax_id VARCHAR(20),
  status VARCHAR(20) NOT NULL DEFAULT 'TRIAL' CHECK (status IN ('TRIAL','ACTIVE','SUSPENDED','CANCELLED')),
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/Monterrey',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tenants_tax_id_uq ON tenants(tax_id) WHERE tax_id IS NOT NULL;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  email CITEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(180) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INVITED','DISABLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email), UNIQUE (tenant_id, id)
);
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id),
  code VARCHAR(40) NOT NULL, name VARCHAR(100) NOT NULL, UNIQUE (tenant_id, code), UNIQUE (tenant_id, id)
);
CREATE TABLE user_roles (
  tenant_id UUID NOT NULL REFERENCES tenants(id), user_id UUID NOT NULL, role_id UUID NOT NULL,
  PRIMARY KEY (tenant_id, user_id, role_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id)
);
CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id),
  code VARCHAR(40) NOT NULL, name VARCHAR(160) NOT NULL, address TEXT, status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (tenant_id, code), UNIQUE (tenant_id, id)
);
CREATE TABLE areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), branch_id UUID NOT NULL,
  code VARCHAR(40) NOT NULL, name VARCHAR(160) NOT NULL, description TEXT,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id), UNIQUE (tenant_id, branch_id, code), UNIQUE (tenant_id, id)
);
CREATE TABLE equipment_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id),
  code VARCHAR(40) NOT NULL, name VARCHAR(120) NOT NULL, description TEXT,
  inspection_checklist JSONB NOT NULL DEFAULT '[]'::jsonb, active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code), UNIQUE (tenant_id, id)
);
CREATE TABLE equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id),
  equipment_type_id UUID NOT NULL, branch_id UUID NOT NULL, area_id UUID,
  asset_code VARCHAR(60) NOT NULL, qr_token UUID NOT NULL DEFAULT gen_random_uuid(),
  manufacturer VARCHAR(120), model VARCHAR(120), serial_number VARCHAR(120), capacity VARCHAR(60),
  installed_at DATE, last_maintenance_at DATE, next_maintenance_at DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','RETIRED','UNDER_MAINTENANCE')),
  created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, equipment_type_id) REFERENCES equipment_types(tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, area_id) REFERENCES areas(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id),
  UNIQUE (tenant_id, asset_code), UNIQUE (qr_token), UNIQUE (tenant_id, id)
);
CREATE TABLE equipment_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), equipment_id UUID NOT NULL,
  object_key TEXT NOT NULL, photo_type VARCHAR(20) NOT NULL CHECK (photo_type IN ('INITIAL','INSPECTION','MAINTENANCE','OTHER')),
  captured_at TIMESTAMPTZ NOT NULL, uploaded_by UUID NOT NULL, checksum_sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, equipment_id) REFERENCES equipment(tenant_id, id),
  FOREIGN KEY (tenant_id, uploaded_by) REFERENCES users(tenant_id, id),
  UNIQUE (tenant_id, object_key), UNIQUE (tenant_id, id)
);
-- Exactly one initial photo per asset; photo rows are append-only by application policy.
CREATE UNIQUE INDEX equipment_one_initial_photo_uq ON equipment_photos(tenant_id, equipment_id) WHERE photo_type = 'INITIAL';

CREATE TABLE inspection_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(160) NOT NULL, frequency_type VARCHAR(20) NOT NULL CHECK (frequency_type IN ('MONTHLY','QUARTERLY','SEMIANNUAL','CUSTOM')),
  interval_value INTEGER, scope_type VARCHAR(20) NOT NULL CHECK (scope_type IN ('EQUIPMENT','AREA','BRANCH','TENANT')),
  branch_id UUID, area_id UUID, starts_on DATE NOT NULL, ends_on DATE, timezone VARCHAR(64) NOT NULL DEFAULT 'America/Monterrey',
  active BOOLEAN NOT NULL DEFAULT true, created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((frequency_type = 'CUSTOM' AND interval_value > 0) OR (frequency_type <> 'CUSTOM' AND interval_value IS NULL)),
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, area_id) REFERENCES areas(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id), UNIQUE (tenant_id, id)
);
CREATE TABLE schedule_equipment (
  tenant_id UUID NOT NULL REFERENCES tenants(id), schedule_id UUID NOT NULL, equipment_id UUID NOT NULL,
  PRIMARY KEY (tenant_id, schedule_id, equipment_id),
  FOREIGN KEY (tenant_id, schedule_id) REFERENCES inspection_schedules(tenant_id, id),
  FOREIGN KEY (tenant_id, equipment_id) REFERENCES equipment(tenant_id, id)
);
CREATE TABLE inspection_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), schedule_id UUID NOT NULL,
  equipment_id UUID NOT NULL, scheduled_for DATE NOT NULL, assigned_to UUID, status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED','OVERDUE','RESCHEDULED','CANCELLED')),
  original_event_id UUID, reschedule_reason TEXT, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, schedule_id) REFERENCES inspection_schedules(tenant_id, id),
  FOREIGN KEY (tenant_id, equipment_id) REFERENCES equipment(tenant_id, id),
  FOREIGN KEY (tenant_id, assigned_to) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, original_event_id) REFERENCES inspection_calendar(tenant_id, id), UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, schedule_id, equipment_id, scheduled_for)
);
CREATE INDEX inspection_calendar_due_idx ON inspection_calendar(tenant_id, scheduled_for, status);
CREATE TABLE inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), calendar_id UUID NOT NULL,
  equipment_id UUID NOT NULL, inspector_id UUID NOT NULL, started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ, result VARCHAR(20) CHECK (result IN ('PASS','FAIL','CONDITIONAL')),
  notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, calendar_id) REFERENCES inspection_calendar(tenant_id, id),
  FOREIGN KEY (tenant_id, equipment_id) REFERENCES equipment(tenant_id, id),
  FOREIGN KEY (tenant_id, inspector_id) REFERENCES users(tenant_id, id), UNIQUE (tenant_id, id)
);
CREATE TABLE inspection_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), inspection_id UUID NOT NULL,
  item_code VARCHAR(80) NOT NULL, question TEXT NOT NULL, answer VARCHAR(30) NOT NULL CHECK (answer IN ('OK','NOT_OK','NA')),
  comment TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, inspection_id) REFERENCES inspections(tenant_id, id), UNIQUE (tenant_id, inspection_id, item_code)
);
CREATE TABLE inspection_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), inspection_id UUID NOT NULL,
  equipment_id UUID NOT NULL, object_key TEXT NOT NULL, captured_at TIMESTAMPTZ NOT NULL, uploaded_by UUID NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, inspection_id) REFERENCES inspections(tenant_id, id),
  FOREIGN KEY (tenant_id, equipment_id) REFERENCES equipment(tenant_id, id),
  FOREIGN KEY (tenant_id, uploaded_by) REFERENCES users(tenant_id, id), UNIQUE (tenant_id, object_key)
);
CREATE TABLE inspection_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), calendar_id UUID NOT NULL,
  days_before SMALLINT NOT NULL CHECK (days_before IN (7,1)), scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ, delivery_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (delivery_status IN ('PENDING','SENT','FAILED','CANCELLED')),
  idempotency_key VARCHAR(180) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, calendar_id) REFERENCES inspection_calendar(tenant_id, id), UNIQUE (tenant_id, idempotency_key)
);
CREATE TABLE findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), inspection_id UUID NOT NULL,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')), description TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','CLOSED')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, inspection_id) REFERENCES inspections(tenant_id, id), UNIQUE (tenant_id, id)
);
CREATE TABLE corrective_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), finding_id UUID NOT NULL,
  assigned_to UUID, due_date DATE, description TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'OPEN', closed_at TIMESTAMPTZ,
  FOREIGN KEY (tenant_id, finding_id) REFERENCES findings(tenant_id, id),
  FOREIGN KEY (tenant_id, assigned_to) REFERENCES users(tenant_id, id)
);
CREATE TABLE maintenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), equipment_id UUID NOT NULL,
  provider_name VARCHAR(180), service_type VARCHAR(80) NOT NULL, performed_at DATE, next_due_at DATE, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), FOREIGN KEY (tenant_id, equipment_id) REFERENCES equipment(tenant_id, id)
);
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES tenants(id), actor_user_id UUID,
  action VARCHAR(100) NOT NULL, entity_type VARCHAR(80) NOT NULL, entity_id UUID, before_data JSONB, after_data JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(), request_id VARCHAR(100),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES users(tenant_id, id)
);

-- Enable RLS on tenant-owned tables. The API must set app.tenant_id transaction-locally.
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['users','roles','user_roles','branches','areas','equipment_types','equipment','equipment_photos',
    'inspection_schedules','schedule_equipment','inspection_calendar','inspections','inspection_answers','inspection_evidence',
    'inspection_reminders','findings','corrective_actions','maintenance','audit_logs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

-- NOTE: tenant provisioning/migrations must use a dedicated database owner role.
-- Runtime API role must not own tables and must not have BYPASSRLS.
