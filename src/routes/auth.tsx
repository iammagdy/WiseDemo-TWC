import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — DemoForge" },
      { name: "description", content: "Sign in to DemoForge and start filming cinematic demos of your SaaS." },
      { property: "og:title", content: "Sign in — DemoForge" },
      { property: "og:description", content: "Sign in to DemoForge and start filming cinematic demos of your SaaS." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // 1) If already signed in, jump straight in.
    supabase.auth.getSession().then(({ data }) => {
      if (alive && data.session) navigate({ to: "/dashboard", replace: true });
    });
    // 2) Also react when the OAuth popup finishes and sets the session
    //    after signInWithOAuth has already returned.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return;
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
        navigate({ to: "/dashboard", replace: true });
      }
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/dashboard` },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/dashboard", replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        setError(result.error.message ?? "Google sign-in failed");
        return;
      }
      if (result.redirected) return;
      navigate({ to: "/dashboard", replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
    }
  }

  return (
    <div className="grid min-h-screen bg-background text-foreground lg:grid-cols-2">
      {/* Left cinematic pane */}
      <aside className="relative hidden overflow-hidden border-r border-border bg-card/40 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,color-mix(in_oklab,var(--color-primary)_25%,transparent),transparent_60%)]" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Link to="/" className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-primary animate-record" />
            <span className="font-mono-tight text-sm font-semibold tracking-tight">DemoForge</span>
          </Link>
          <div>
            <p className="font-mono-tight text-xs uppercase tracking-widest text-primary">/// On set</p>
            <blockquote className="mt-4 max-w-md text-3xl font-semibold leading-tight tracking-tight">
              "Uploaded my URL Tuesday. Had a launch video on X by Wednesday. Zero editors, zero takes."
            </blockquote>
            <p className="mt-6 font-mono-tight text-xs uppercase tracking-widest text-muted-foreground">
              — Solo founder, indie SaaS
            </p>
          </div>
          <p className="font-mono-tight text-[11px] uppercase tracking-widest text-muted-foreground">
            SCENE 00 — TAKE 01
          </p>
        </div>
      </aside>

      {/* Right form */}
      <main className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-10 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            ← Back to site
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">
            {mode === "signin" ? "Welcome back to set." : "Get on the call sheet."}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "signin"
              ? "Sign in to keep filming."
              : "Create an account — 3 free demos, no card."}
          </p>

          <button
            onClick={handleGoogle}
            className="mt-8 flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition hover:border-primary/60"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <div className="my-6 flex items-center gap-3 font-mono-tight text-[11px] uppercase tracking-widest text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or with email <span className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleEmail} className="space-y-3">
            <Field
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Field
              label="Password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Rolling…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
            <button
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="font-medium text-primary hover:underline"
            >
              {mode === "signin" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}

function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono-tight text-[11px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <input
        {...rest}
        className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
      />
    </label>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.5 14.6 2.5 12 2.5 6.8 2.5 2.5 6.7 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.9 9.1-9.3 0-.6-.07-1.1-.15-1.7z" />
    </svg>
  );
}