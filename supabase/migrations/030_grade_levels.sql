-- 030: Collapse trainee grades to Level 1 Trainee / Level 2 Trainee / Consultant.
-- Legacy values are remapped (FY1..ST3 -> Level 1, ST4..ST8 -> Level 2) including
-- pending member_onboarding_requests: completeOnboarding copies request.grade
-- into profiles/department_members, so a stale 'ST3' would violate the new CHECK.

-- The CHECKs were created inline with ADD COLUMN in 022, so Postgres named them
-- <table>_grade_check.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_grade_check;
ALTER TABLE public.department_members
  DROP CONSTRAINT IF EXISTS department_members_grade_check;
ALTER TABLE public.member_onboarding_requests
  DROP CONSTRAINT IF EXISTS member_onboarding_requests_grade_check;

UPDATE public.profiles SET grade = CASE
    WHEN grade IN ('FY1','FY2','ST1','ST2','ST3') THEN 'Level 1 Trainee'
    WHEN grade IN ('ST4','ST5','ST6','ST7','ST8') THEN 'Level 2 Trainee'
    ELSE grade
  END
  WHERE grade IS NOT NULL;

UPDATE public.department_members SET grade = CASE
    WHEN grade IN ('FY1','FY2','ST1','ST2','ST3') THEN 'Level 1 Trainee'
    WHEN grade IN ('ST4','ST5','ST6','ST7','ST8') THEN 'Level 2 Trainee'
    ELSE grade
  END
  WHERE grade IS NOT NULL;

UPDATE public.member_onboarding_requests SET grade = CASE
    WHEN grade IN ('FY1','FY2','ST1','ST2','ST3') THEN 'Level 1 Trainee'
    WHEN grade IN ('ST4','ST5','ST6','ST7','ST8') THEN 'Level 2 Trainee'
    ELSE grade
  END
  WHERE grade IS NOT NULL;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_grade_check
  CHECK (grade IN ('Level 1 Trainee','Level 2 Trainee','Consultant'));
ALTER TABLE public.department_members
  ADD CONSTRAINT department_members_grade_check
  CHECK (grade IN ('Level 1 Trainee','Level 2 Trainee','Consultant'));
ALTER TABLE public.member_onboarding_requests
  ADD CONSTRAINT member_onboarding_requests_grade_check
  CHECK (grade IN ('Level 1 Trainee','Level 2 Trainee','Consultant'));
