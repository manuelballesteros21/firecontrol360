-- FireControl 360 | Vertical integration
-- This migration is versioned and intentionally NOT executed by the application.
-- Review against the target database before applying with a dedicated migration role.

CREATE TABLE IF NOT EXISTS platform_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL UNIQUE,
  full_name VARCHAR(180) NOT NULL,
  password_hash TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  email CITEXT NOT NULL,
  full_name VARCHAR(180) NOT NULL,
  role_id UUID NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  accepted_by_user_id UUID,
  created_by_platform_admin_id UUID NOT NULL REFERENCES platform_admins(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id),
  FOREIGN KEY (tenant_id, accepted_by_user_id) REFERENCES users(tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS user_invitations_pending_idx
  ON user_invitations (tenant_id, expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  event_type VARCHAR(80) NOT NULL,
  recipient_email CITEXT NOT NULL,
  payload_ciphertext BYTEA NOT NULL,
  encryption_key_version VARCHAR(40) NOT NULL,
  idempotency_key VARCHAR(180) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED','DEAD')),
  attempts SMALLINT NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx
  ON notification_outbox (available_at, created_at)
  WHERE status IN ('PENDING','FAILED');

CREATE TABLE IF NOT EXISTS equipment_photo_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  equipment_id UUID NOT NULL,
  object_key TEXT NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  checksum_sha256 CHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','EXPIRED','FAILED')),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, equipment_id) REFERENCES equipment(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id),
  UNIQUE (tenant_id, object_key),
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS equipment_photo_uploads_expiry_idx
  ON equipment_photo_uploads (expires_at) WHERE status = 'PENDING';

DO $$
BEGIN
  ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_status_check;
  ALTER TABLE equipment ADD CONSTRAINT equipment_status_check
    CHECK (status IN ('PENDING_PHOTO','ACTIVE','INACTIVE','RETIRED','UNDER_MAINTENANCE'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_invitations','notification_outbox','equipment_photo_uploads'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END $$;

-- platform_admins is a platform-level identity table. It is accessed only by
-- the platform authentication/provisioning service using PROVISIONING_DATABASE_URL.
-- Do not expose that connection string to tenant-facing code.
-- The runtime API role must not own tenant tables and must not have BYPASSRLS.

-- Prevent historical initial-photo evidence from being silently changed or removed.
CREATE OR REPLACE FUNCTION firecontrol_reject_equipment_photo_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'equipment photo evidence is append-only';
END;
$$;
DROP TRIGGER IF EXISTS equipment_photos_immutable ON equipment_photos;
CREATE TRIGGER equipment_photos_immutable
BEFORE UPDATE OR DELETE ON equipment_photos
FOR EACH ROW EXECUTE FUNCTION firecontrol_reject_equipment_photo_mutation();

-- A piece of equipment cannot become ACTIVE unless its initial evidence exists.
CREATE OR REPLACE FUNCTION firecontrol_require_initial_equipment_photo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'ACTIVE' AND NOT EXISTS (
    SELECT 1 FROM equipment_photos p
    WHERE p.tenant_id = NEW.tenant_id
      AND p.equipment_id = NEW.id
      AND p.photo_type = 'INITIAL'
  ) THEN
    RAISE EXCEPTION 'equipment cannot become ACTIVE without an initial photo';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS equipment_requires_initial_photo ON equipment;
CREATE TRIGGER equipment_requires_initial_photo
BEFORE INSERT OR UPDATE OF status ON equipment
FOR EACH ROW EXECUTE FUNCTION firecontrol_require_initial_equipment_photo();
