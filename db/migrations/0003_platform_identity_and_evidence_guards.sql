-- FireControl 360 | Platform identity and evidence invariants
-- Follow-up migration only. It does not recreate user_invitations,
-- notification_outbox or equipment_photo_uploads from the already-applied 0002.

CREATE TABLE IF NOT EXISTS platform_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL UNIQUE,
  full_name VARCHAR(180) NOT NULL,
  password_hash TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

ALTER TABLE user_invitations
  ADD COLUMN IF NOT EXISTS created_by_platform_admin_id UUID
  REFERENCES platform_admins(id);

DO $$
BEGIN
  ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_status_check;
  ALTER TABLE equipment ADD CONSTRAINT equipment_status_check
    CHECK (status IN ('PENDING_PHOTO','ACTIVE','INACTIVE','RETIRED','UNDER_MAINTENANCE'));
END $$;

CREATE OR REPLACE FUNCTION firecontrol_reject_equipment_photo_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'equipment photo evidence is append-only';
END;
$$;
DROP TRIGGER IF EXISTS equipment_photos_immutable ON equipment_photos;
CREATE TRIGGER equipment_photos_immutable
BEFORE UPDATE OR DELETE ON equipment_photos
FOR EACH ROW EXECUTE FUNCTION firecontrol_reject_equipment_photo_mutation();

CREATE OR REPLACE FUNCTION firecontrol_require_initial_equipment_photo()
RETURNS trigger LANGUAGE plpgsql AS $$
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

-- Apply this migration with a controlled migration role. Do not run it
-- automatically at API startup and do not use the runtime API database role.
