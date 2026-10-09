-- Installation state is separate from tenant data and is never accessible to end users.
CREATE TABLE public.instance_setup (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  reservation uuid,
  email text,
  user_id uuid REFERENCES auth.users(id),
  completed_at timestamptz,
  blocked boolean NOT NULL DEFAULT false
);
ALTER TABLE public.instance_setup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instance_setup FROM anon, authenticated;
GRANT ALL ON public.instance_setup TO service_role;
INSERT INTO public.instance_setup(singleton, blocked)
SELECT true, EXISTS(SELECT 1 FROM public.organizations) OR EXISTS(SELECT 1 FROM auth.users);

CREATE OR REPLACE FUNCTION public.reserve_instance_setup(p_email text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE state public.instance_setup; existing record;
BEGIN
  SELECT * INTO state FROM public.instance_setup WHERE singleton FOR UPDATE;
  IF NOT FOUND OR state.blocked OR state.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Setup unavailable'; END IF;
  IF EXISTS(SELECT 1 FROM public.organizations) OR EXISTS(SELECT 1 FROM public.super_admins) THEN RAISE EXCEPTION 'Setup unavailable'; END IF;
  IF state.reservation IS NOT NULL AND state.email <> p_email THEN RAISE EXCEPTION 'Setup already reserved for another administrator'; END IF;
  -- Only a previously reserved bootstrap identity may exist during a retry.
  FOR existing IN SELECT id, email, raw_app_meta_data FROM auth.users LOOP
    IF state.reservation IS NULL OR existing.email <> p_email OR
       existing.raw_app_meta_data->>'petrios_setup' IS DISTINCT FROM state.reservation::text THEN
      RAISE EXCEPTION 'Existing account: setup unavailable';
    END IF;
  END LOOP;
  IF state.reservation IS NULL THEN
    state.reservation := gen_random_uuid();
    UPDATE public.instance_setup SET reservation=state.reservation, email=p_email WHERE singleton;
  END IF;
  RETURN state.reservation;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_instance_setup(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_instance_setup(text) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_instance_setup(p_reservation uuid, p_user uuid, p_org text, p_department text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE state public.instance_setup; org uuid := gen_random_uuid(); dept uuid := gen_random_uuid();
BEGIN
  SELECT * INTO state FROM public.instance_setup WHERE singleton FOR UPDATE;
  IF NOT FOUND OR state.blocked OR state.completed_at IS NOT NULL OR state.reservation IS DISTINCT FROM p_reservation THEN RAISE EXCEPTION 'Setup unavailable'; END IF;
  IF EXISTS(SELECT 1 FROM public.organizations) OR EXISTS(SELECT 1 FROM public.super_admins) THEN RAISE EXCEPTION 'Setup unavailable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user AND lower(email)=state.email AND raw_app_meta_data->>'petrios_setup'=p_reservation::text) THEN RAISE EXCEPTION 'Bootstrap identity mismatch'; END IF;
  IF length(trim(p_org)) NOT BETWEEN 1 AND 120 OR length(trim(p_department)) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Invalid name'; END IF;
  INSERT INTO public.organizations(id,name,created_by) VALUES(org,trim(p_org),p_user);
  INSERT INTO public.organization_members(org_id,user_id,role) VALUES(org,p_user,'org_admin');
  INSERT INTO public.departments(id,org_id,name,created_by) VALUES(dept,org,trim(p_department),p_user);
  INSERT INTO public.department_members(org_id,department_id,user_id,role) VALUES(org,dept,p_user,'department_admin');
  INSERT INTO public.super_admins(user_id) VALUES(p_user);
  UPDATE public.instance_setup SET user_id=p_user,completed_at=now() WHERE singleton;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_instance_setup(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_instance_setup(uuid,uuid,text,text) TO service_role;

CREATE TABLE public.instance_jobs (
  name text PRIMARY KEY,
  interval_seconds integer NOT NULL CHECK (interval_seconds >= 300),
  last_success timestamptz,
  lease uuid,
  lease_until timestamptz,
  last_error text
);
ALTER TABLE public.instance_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instance_jobs FROM anon, authenticated;
GRANT ALL ON public.instance_jobs TO service_role;
INSERT INTO public.instance_jobs(name,interval_seconds) VALUES
('session-reminders',3600),('post-session-reports',3600),('recall-send',86400),('recall-awards',900),('ops-synthesis',86400),('ops-weekly',604800);
CREATE OR REPLACE FUNCTION public.claim_instance_job(p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE claimed uuid;
BEGIN
  UPDATE public.instance_jobs SET lease=gen_random_uuid(),lease_until=now()+interval '30 minutes'
  WHERE name=p_name AND (lease_until IS NULL OR lease_until < now())
    AND (last_success IS NULL OR last_success+make_interval(secs=>interval_seconds) <= now())
  RETURNING lease INTO claimed;
  RETURN claimed;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_instance_job(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_instance_job(text) TO service_role;
