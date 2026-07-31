ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_owner_id_fkey;
ALTER TABLE public.demos DROP CONSTRAINT IF EXISTS demos_owner_id_fkey;
ALTER TABLE public.demo_events DROP CONSTRAINT IF EXISTS demo_events_owner_id_fkey;
ALTER TABLE public.project_credentials DROP CONSTRAINT IF EXISTS project_credentials_owner_id_fkey;

DROP POLICY IF EXISTS "own projects all" ON public.projects;
DROP POLICY IF EXISTS "own demos all" ON public.demos;
DROP POLICY IF EXISTS "public shared demos read" ON public.demos;
DROP POLICY IF EXISTS "public shared demos read auth" ON public.demos;
DROP POLICY IF EXISTS "own events read" ON public.demo_events;
DROP POLICY IF EXISTS "own creds write" ON public.project_credentials;

REVOKE ALL ON public.projects FROM anon, authenticated;
REVOKE ALL ON public.demos FROM anon, authenticated;
REVOKE ALL ON public.demo_events FROM anon, authenticated;
REVOKE ALL ON public.project_credentials FROM anon, authenticated;

GRANT ALL ON public.projects TO service_role;
GRANT ALL ON public.demos TO service_role;
GRANT ALL ON public.demo_events TO service_role;
GRANT ALL ON public.project_credentials TO service_role;