-- 034: Org-scoped address book of external (no-account) contacts, plus named
-- groups used as audiences for teaching-slot publications (035). Contacts are
-- auto-captured from external teacher invitations/RSVPs and managed manually
-- in Settings by org managers (org admins + department moderators).

CREATE TABLE public.external_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  role_note TEXT,                 -- optional role/title, e.g. 'Consultant Anaesthetist'
  archived_at TIMESTAMPTZ,        -- soft archive; archived contacts hidden from pickers
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX external_contacts_org_email_key
  ON public.external_contacts (org_id, lower(email));
CREATE INDEX external_contacts_org_idx
  ON public.external_contacts (org_id, archived_at);

CREATE TABLE public.contact_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX contact_groups_org_name_key
  ON public.contact_groups (org_id, lower(name));

CREATE TABLE public.contact_group_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.contact_groups(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.external_contacts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, contact_id)
);

-- Deny-all RLS: all access goes through the service-role DAL
-- (lib/db/external-contacts.ts) after requireOrgManager() in server actions —
-- the same pattern as notifications (033).
ALTER TABLE public.external_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_group_members ENABLE ROW LEVEL SECURITY;
