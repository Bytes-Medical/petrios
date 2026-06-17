-- Personal workspaces
-- Flags an organization as an auto-provisioned personal workspace for an
-- individual (non-enterprise) user. Personal orgs reuse the full
-- session/attendance/certificate/feedback pipeline but are hidden from
-- enterprise/super-admin organization listings.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS is_personal BOOLEAN NOT NULL DEFAULT false;

-- Partial index so personal-org lookups (and excluding them from admin lists)
-- stay cheap as the table grows.
CREATE INDEX IF NOT EXISTS idx_organizations_is_personal
  ON public.organizations(is_personal)
  WHERE is_personal = true;
