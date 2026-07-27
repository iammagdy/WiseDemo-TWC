
ALTER TABLE public.demos
  ADD COLUMN IF NOT EXISTS steel_session_id text,
  ADD COLUMN IF NOT EXISTS live_view_url text,
  ADD COLUMN IF NOT EXISTS session_viewer_url text,
  ADD COLUMN IF NOT EXISTS recording_url text;

-- Extend demo_status enum with 'starting' if not already there
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'demo_status' AND e.enumlabel = 'starting'
  ) THEN
    ALTER TYPE public.demo_status ADD VALUE 'starting' BEFORE 'scanning';
  END IF;
END $$;
