ALTER TYPE public.demo_status ADD VALUE IF NOT EXISTS 'starting' BEFORE 'scanning';

ALTER TABLE public.demos
  ADD COLUMN IF NOT EXISTS steel_session_id text,
  ADD COLUMN IF NOT EXISTS live_view_url text,
  ADD COLUMN IF NOT EXISTS session_viewer_url text,
  ADD COLUMN IF NOT EXISTS recording_url text;