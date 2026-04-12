-- 022: Department codes, trainee grade, session types

-- Helper: generate a unique 6-digit numeric department code
CREATE OR REPLACE FUNCTION public.generate_department_code()
RETURNS TEXT AS $$
DECLARE
  v_code TEXT;
  v_exists BOOLEAN;
BEGIN
  LOOP
    v_code := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
    SELECT EXISTS(SELECT 1 FROM public.departments WHERE department_code = v_code) INTO v_exists;
    IF NOT v_exists THEN
      RETURN v_code;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- 1a. Add department_code to departments
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS department_code TEXT UNIQUE;

-- Backfill existing departments
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.departments WHERE department_code IS NULL LOOP
    UPDATE public.departments SET department_code = public.generate_department_code() WHERE id = r.id;
  END LOOP;
END;
$$;

ALTER TABLE public.departments ALTER COLUMN department_code SET NOT NULL;
ALTER TABLE public.departments ALTER COLUMN department_code SET DEFAULT public.generate_department_code();

-- 1b. Add grade to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS grade TEXT
  CHECK (grade IN ('FY1','FY2','ST1','ST2','ST3','ST4','ST5','ST6','ST7','ST8','Consultant'));

-- 1c. Add session_type to sessions
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS session_type TEXT
  CHECK (session_type IN ('STEPP','CLINICAL_SKILLS','SIMULATION','ACADEMIC'));

-- 1d. Add grade to department_members
ALTER TABLE public.department_members ADD COLUMN IF NOT EXISTS grade TEXT
  CHECK (grade IN ('FY1','FY2','ST1','ST2','ST3','ST4','ST5','ST6','ST7','ST8','Consultant'));

-- 1e. Add grade to member_onboarding_requests so it survives the async email flow
ALTER TABLE public.member_onboarding_requests ADD COLUMN IF NOT EXISTS grade TEXT
  CHECK (grade IN ('FY1','FY2','ST1','ST2','ST3','ST4','ST5','ST6','ST7','ST8','Consultant'));

-- Index for code lookups
CREATE INDEX IF NOT EXISTS idx_departments_department_code ON public.departments(department_code);
