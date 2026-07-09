-- 035: Calendly-style open teaching slots + publications to audiences.
--
-- Slot lifecycle: OPEN -> CLAIMED (atomic first-come-first-served) or
-- CLOSED (moderator). An OPEN slot past date_start is treated as expired
-- purely by query filter + the claim-time guard — no status write, no cron.
-- A CLAIMED slot never auto-reopens: deleting its session sets session_id
-- NULL ("Claimed — session removed" in the UI) and the moderator closes the
-- stale slot and creates a fresh one to re-offer the time.

CREATE TABLE public.teaching_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  date_start TIMESTAMPTZ NOT NULL,
  date_end TIMESTAMPTZ NOT NULL CHECK (date_end > date_start),
  location_type TEXT NOT NULL CHECK (location_type IN ('MS_TEAMS','IN_PERSON','HYBRID')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLAIMED','CLOSED')),
  session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  claimed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_by_contact_id UUID REFERENCES public.external_contacts(id) ON DELETE SET NULL,
  claimed_name TEXT,              -- display snapshot of the claimer
  claimed_at TIMESTAMPTZ,
  topic_suggestion TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX teaching_slots_dept_idx
  ON public.teaching_slots (department_id, status, date_start);

-- Double-booking guard: at most one active slot per department at the same
-- start time. Overlapping (non-identical) times are allowed deliberately —
-- parallel-track teaching is legitimate; the bulk picker warns instead.
CREATE UNIQUE INDEX teaching_slots_dept_start_active_key
  ON public.teaching_slots (department_id, date_start)
  WHERE status IN ('OPEN','CLAIMED');

-- One row per "publish availability" action; audience kept as a JSONB
-- snapshot ({groupIds, allDepartmentMembers, allOrgMembers}) for audit.
CREATE TABLE public.slot_publications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  audience JSONB NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.slot_publication_slots (
  publication_id UUID NOT NULL REFERENCES public.slot_publications(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES public.teaching_slots(id) ON DELETE CASCADE,
  PRIMARY KEY (publication_id, slot_id)
);

-- One row per recipient per publication. claim_code is the public capability
-- token for external contacts (no account); registered members claim in-app,
-- authorized by the existence of their row.
CREATE TABLE public.slot_claim_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  publication_id UUID NOT NULL REFERENCES public.slot_publications(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.external_contacts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  claim_code TEXT UNIQUE,
  emailed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((user_id IS NULL) <> (contact_id IS NULL))
);

CREATE INDEX slot_claim_links_user_idx
  ON public.slot_claim_links (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX slot_claim_links_pub_idx
  ON public.slot_claim_links (publication_id);

-- RLS: org members may read slots (the calendar shows 'Available' events);
-- every write is service-role (claimers are not moderators, so the sessions/
-- session_teachers INSERT policies could never allow claim-time writes).
-- Publications and claim links are deny-all, service-role only.
ALTER TABLE public.teaching_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members can view teaching slots"
  ON public.teaching_slots FOR SELECT
  USING (org_id = get_user_org_id());

ALTER TABLE public.slot_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_publication_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_claim_links ENABLE ROW LEVEL SECURITY;
