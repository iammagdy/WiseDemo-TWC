-- =========================================================
-- Enums
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TYPE public.plan_tier AS ENUM ('indie', 'director', 'studio');
CREATE TYPE public.credential_kind AS ENUM ('none', 'cookie', 'password');
CREATE TYPE public.site_map_source AS ENUM ('firecrawl', 'manual');
CREATE TYPE public.demo_status AS ENUM ('pending','scanning','planning','recording','rendering','ready','failed');

-- =========================================================
-- updated_at helper
-- =========================================================
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- =========================================================
-- profiles
-- =========================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  plan public.plan_tier NOT NULL DEFAULT 'indie',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  INSERT INTO public.subscriptions (user_id) VALUES (NEW.id);
  RETURN NEW;
END; $$;

-- =========================================================
-- user_roles + has_role
-- =========================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own roles read" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- =========================================================
-- projects
-- =========================================================
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  description TEXT,
  site_map_md TEXT,
  site_map_source public.site_map_source,
  site_map_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own projects all" ON public.projects FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE TRIGGER projects_updated BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX projects_owner_idx ON public.projects (owner_id, created_at DESC);

-- =========================================================
-- project_credentials  (encrypted; only service_role reads)
-- =========================================================
CREATE TABLE public.project_credentials (
  project_id UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.credential_kind NOT NULL DEFAULT 'none',
  login_url TEXT,
  username_hint TEXT,             -- non-secret label so users know what's stored
  ciphertext TEXT,                -- base64 iv|tag|ct of JSON secret payload
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Do NOT grant SELECT to authenticated: ciphertext must never reach the browser.
GRANT INSERT, UPDATE, DELETE ON public.project_credentials TO authenticated;
GRANT ALL ON public.project_credentials TO service_role;
ALTER TABLE public.project_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own creds write" ON public.project_credentials FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE TRIGGER creds_updated BEFORE UPDATE ON public.project_credentials FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Safe view for the client: metadata only, no ciphertext
CREATE OR REPLACE VIEW public.project_credentials_public AS
  SELECT project_id, owner_id, kind, login_url, username_hint, updated_at
  FROM public.project_credentials;
GRANT SELECT ON public.project_credentials_public TO authenticated;

-- =========================================================
-- demos
-- =========================================================
CREATE TABLE public.demos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  feature_prompt TEXT NOT NULL,
  scene_script JSONB,
  status public.demo_status NOT NULL DEFAULT 'pending',
  progress_pct SMALLINT NOT NULL DEFAULT 0,
  current_step TEXT,
  mp4_url TEXT,
  thumbnail_url TEXT,
  duration_seconds INTEGER,
  share_slug TEXT UNIQUE,
  is_public BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  browserbase_session_id TEXT,
  creatomate_render_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demos TO authenticated;
GRANT SELECT ON public.demos TO anon;  -- public share_slug reads gated by policy
GRANT ALL ON public.demos TO service_role;
ALTER TABLE public.demos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own demos all" ON public.demos FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "public shared demos read" ON public.demos FOR SELECT TO anon USING (is_public = true AND share_slug IS NOT NULL AND status = 'ready');
CREATE POLICY "public shared demos read auth" ON public.demos FOR SELECT TO authenticated USING (is_public = true AND share_slug IS NOT NULL AND status = 'ready');
CREATE TRIGGER demos_updated BEFORE UPDATE ON public.demos FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX demos_owner_idx ON public.demos (owner_id, created_at DESC);
CREATE INDEX demos_project_idx ON public.demos (project_id, created_at DESC);
CREATE INDEX demos_share_slug_idx ON public.demos (share_slug) WHERE share_slug IS NOT NULL;

-- =========================================================
-- demo_events (progress log)
-- =========================================================
CREATE TABLE public.demo_events (
  id BIGSERIAL PRIMARY KEY,
  demo_id UUID NOT NULL REFERENCES public.demos(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info',
  step TEXT NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.demo_events TO authenticated;
GRANT ALL ON public.demo_events TO service_role;
ALTER TABLE public.demo_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own events read" ON public.demo_events FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE INDEX demo_events_demo_idx ON public.demo_events (demo_id, id DESC);

-- Realtime for events + demo status
ALTER PUBLICATION supabase_realtime ADD TABLE public.demo_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.demos;

-- =========================================================
-- subscriptions
-- =========================================================
CREATE TABLE public.subscriptions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan public.plan_tier NOT NULL DEFAULT 'indie',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  demos_used_this_period INTEGER NOT NULL DEFAULT 0,
  period_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
  period_end TIMESTAMPTZ NOT NULL DEFAULT (date_trunc('month', now()) + interval '1 month'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sub read" ON public.subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER subs_updated BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Now safe to add the auth trigger (references subscriptions table)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();