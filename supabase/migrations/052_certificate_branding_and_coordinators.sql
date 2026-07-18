-- 052: Branded certificate coordination metadata.
--
-- Coordinator defaults belong to the department. Issued certificates keep an
-- immutable name snapshot so changing settings cannot rewrite the people shown
-- on an historical certificate.

ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS certificate_coordinator_names TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.certificates
  ADD COLUMN IF NOT EXISTS coordinator_names TEXT[] NOT NULL DEFAULT '{}';

-- Preserve the existing single Teaching Lead configuration as the first
-- coordinator. The old column remains for compatibility with older clients.
UPDATE public.departments
SET certificate_coordinator_names = ARRAY[trim(lead_name)]
WHERE cardinality(certificate_coordinator_names) = 0
  AND lead_name IS NOT NULL
  AND trim(lead_name) <> '';

-- Freeze the department setting onto certificates that predate this migration.
UPDATE public.certificates AS certificate
SET coordinator_names = department.certificate_coordinator_names
FROM public.departments AS department
WHERE certificate.department_id = department.id
  AND cardinality(certificate.coordinator_names) = 0
  AND cardinality(department.certificate_coordinator_names) > 0;

ALTER TABLE public.departments
  DROP CONSTRAINT IF EXISTS departments_certificate_coordinators_limit,
  ADD CONSTRAINT departments_certificate_coordinators_limit
    CHECK (cardinality(certificate_coordinator_names) <= 4);

ALTER TABLE public.certificates
  DROP CONSTRAINT IF EXISTS certificates_coordinator_snapshot_limit,
  ADD CONSTRAINT certificates_coordinator_snapshot_limit
    CHECK (cardinality(coordinator_names) <= 4);
