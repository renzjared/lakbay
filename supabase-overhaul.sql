-- Lakbay workspace expansion
-- The current app stores trip plans, notes, and expenses on public.trips.
-- This JSONB column keeps the new trip-scoped workspace data on the same row
-- and therefore uses the existing trips table RLS rules.
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS workspace_data jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.trips.workspace_data IS
  'Lakbay workspace data: trip dates, food planning, forum, payments, groups, and trip preferences.';

-- Short invite codes let signed-in users join with either a code or a link.
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS invite_code text;
UPDATE public.trips
SET invite_code = upper(substr(md5(id::text || random()::text), 1, 8))
WHERE invite_code IS NULL;
ALTER TABLE public.trips ALTER COLUMN invite_code SET DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
ALTER TABLE public.trips ALTER COLUMN invite_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS trips_invite_code_unique ON public.trips (invite_code);

CREATE OR REPLACE FUNCTION public.join_trip_by_invite(p_code text)
RETURNS SETOF public.trips
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_trip public.trips%ROWTYPE;
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in is required to join a trip';
  END IF;

  SELECT * INTO v_trip
  FROM public.trips
  WHERE upper(invite_code) = upper(trim(p_code))
     OR id::text = trim(p_code)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF v_trip.owner_id <> v_user AND NOT EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = v_trip.id AND user_id = v_user
  ) THEN
    BEGIN
      INSERT INTO public.trip_members (trip_id, user_id, role)
      VALUES (v_trip.id, v_user, 'viewer');
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END IF;

  RETURN NEXT v_trip;
END;
$$;

REVOKE ALL ON FUNCTION public.join_trip_by_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_trip_by_invite(text) TO authenticated;
