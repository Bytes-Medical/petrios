-- Allow same department names across organizations, but enforce uniqueness within an org
ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_name_key;
DROP INDEX IF EXISTS departments_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS departments_org_id_name_key
  ON departments(org_id, name);
