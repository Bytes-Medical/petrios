-- A user may moderate departments in only one organization at a time.
-- Granting department_admin in a new organization demotes their moderator
-- memberships in every other organization to faculty, preserving access and
-- historical membership rather than deleting it.

-- Normalize any pre-existing cross-organization moderator assignments. The
-- organization containing the most recently created moderator membership wins;
-- org_id provides a deterministic tie-breaker for identical timestamps.
WITH moderator_organizations AS (
  SELECT
    user_id,
    org_id,
    MAX(created_at) AS latest_grant
  FROM public.department_members
  WHERE role = 'department_admin'
  GROUP BY user_id, org_id
),
ranked_moderator_organizations AS (
  SELECT
    user_id,
    org_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY latest_grant DESC, org_id DESC
    ) AS organization_rank
  FROM moderator_organizations
)
UPDATE public.department_members AS department_member
SET role = 'faculty'
FROM ranked_moderator_organizations AS ranked
WHERE ranked.organization_rank > 1
  AND department_member.user_id = ranked.user_id
  AND department_member.org_id = ranked.org_id
  AND department_member.role = 'department_admin';

-- Keep the organization-level role projection aligned after the backfill.
-- org_admin is deliberately untouched: it is a separate, higher authority.
UPDATE public.organization_members AS organization_member
SET role = 'faculty'
WHERE organization_member.role = 'department_admin'
  AND NOT EXISTS (
    SELECT 1
    FROM public.department_members AS department_member
    WHERE department_member.user_id = organization_member.user_id
      AND department_member.org_id = organization_member.org_id
      AND department_member.role = 'department_admin'
  );

CREATE OR REPLACE FUNCTION public.enforce_single_moderator_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM 'department_admin' THEN
    RETURN NEW;
  END IF;

  -- Serialize grants for the same user so concurrent assignments cannot leave
  -- two winning organizations. Hash collisions only serialize unrelated users.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::TEXT, 0));
  PERFORM set_config('row_security', 'off', true);

  UPDATE public.department_members
  SET role = 'faculty'
  WHERE user_id = NEW.user_id
    AND org_id <> NEW.org_id
    AND role = 'department_admin';

  UPDATE public.organization_members
  SET role = 'faculty'
  WHERE user_id = NEW.user_id
    AND org_id <> NEW.org_id
    AND role = 'department_admin';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS department_members_single_moderator_organization
  ON public.department_members;

CREATE TRIGGER department_members_single_moderator_organization
  BEFORE INSERT OR UPDATE OF role, org_id, user_id
  ON public.department_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_single_moderator_organization();

