DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill for anyone who signed up before the trigger existed
INSERT INTO public.profiles (id, display_name, avatar_url)
SELECT u.id,
       COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email,'@',1)),
       u.raw_user_meta_data->>'avatar_url'
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

INSERT INTO public.subscriptions (user_id)
SELECT u.id FROM auth.users u
LEFT JOIN public.subscriptions s ON s.user_id = u.id
WHERE s.user_id IS NULL;