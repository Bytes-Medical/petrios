-- 037: Petrios Meet — built-in Jitsi video rooms as a session location type.
--
-- Adds 'JITSI' to the location_type CHECK on sessions and teaching_slots.
-- No new columns: the room is derived from the session id
-- (lib/jitsi.ts jitsiRoomName), so a JITSI session always has a video room
-- without anyone pasting a link. Both constraints were declared inline, so
-- Postgres named them <table>_location_type_check.

ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_location_type_check;
ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_location_type_check
  CHECK (location_type IN ('MS_TEAMS', 'IN_PERSON', 'HYBRID', 'JITSI'));

ALTER TABLE public.teaching_slots
  DROP CONSTRAINT IF EXISTS teaching_slots_location_type_check;
ALTER TABLE public.teaching_slots
  ADD CONSTRAINT teaching_slots_location_type_check
  CHECK (location_type IN ('MS_TEAMS', 'IN_PERSON', 'HYBRID', 'JITSI'));
