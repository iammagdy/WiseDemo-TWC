-- Durable recording metadata and idempotency locks for the WiseDemo pipeline.
ALTER TABLE public.demos
  ADD COLUMN IF NOT EXISTS recording_object_path text,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS execution_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS execution_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalization_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finalization_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS recording_completed_at timestamptz;

CREATE INDEX IF NOT EXISTS demos_recording_work_idx
  ON public.demos (status, updated_at)
  WHERE status IN ('pending', 'starting', 'scanning', 'planning', 'recording', 'rendering');

-- Private by default. Completed recordings are served through a short-lived
-- server-generated signed URL; Steel and Supabase secrets never reach the app.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'demo-recordings',
  'demo-recordings',
  false,
  524288000,
  ARRAY['video/mp4']::text[]
)
ON CONFLICT (id) DO NOTHING;
