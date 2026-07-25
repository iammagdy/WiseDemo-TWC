import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — DemoForge" },
      { name: "description", content: "Your DemoForge projects, demos, and render queue." },
    ],
  }),
  component: Dashboard,
});

type ProjectRow = {
  id: string;
  name: string;
  base_url: string;
  created_at: string;
};

function Dashboard() {
  const navigate = useNavigate();
  const { user } = Route.useRouteContext();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [open, setOpen] = useState(false);

  const loadProjects = useCallback(async () => {
    const { data } = await supabase
      .from("projects")
      .select("id, name, base_url, created_at")
      .order("created_at", { ascending: false });
    setProjects((data as ProjectRow[]) ?? []);
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-primary animate-record" />
            <span className="font-mono-tight text-sm font-semibold">DemoForge</span>
            <span className="ml-2 rounded-sm border border-border px-1.5 py-0.5 font-mono-tight text-[10px] uppercase text-muted-foreground">
              Studio
            </span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted-foreground md:inline">{user?.email}</span>
            <button
              onClick={signOut}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-primary/60"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex items-end justify-between gap-6">
          <div>
            <p className="font-mono-tight text-xs uppercase tracking-widest text-primary">/// Call sheet</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Your productions</h1>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-90"
          >
            + New project
          </button>
        </div>

        <div className="mt-10">
          {projects === null ? (
            <div className="rounded-xl border border-border bg-card/50 p-8 text-sm text-muted-foreground">
              Loading dailies…
            </div>
          ) : projects.length === 0 ? (
            <EmptyState onNew={() => setOpen(true)} />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {projects.map((p) => (
                <li
                  key={p.id}
                  className="rounded-xl border border-border bg-card p-5 transition hover:border-primary/50"
                >
                  <div className="font-mono-tight text-[11px] uppercase text-muted-foreground">
                    {new Date(p.created_at).toLocaleDateString()}
                  </div>
                  <div className="mt-1 text-lg font-semibold tracking-tight">{p.name}</div>
                  <div className="mt-1 truncate text-sm text-muted-foreground">{p.base_url}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {open && (
        <NewProjectDialog
          onClose={() => setOpen(false)}
          onCreated={async () => {
            setOpen(false);
            await loadProjects();
          }}
          ownerId={user!.id}
        />
      )}
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-dashed border-border bg-card/40 p-12 text-center">
      <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="7" width="14" height="10" rx="2" />
          <path d="M16 10l6-3v10l-6-3z" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold tracking-tight">The set is empty.</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        Add your first SaaS URL and DemoForge will map, script, and film a 60-second cut.
      </p>
      <button
        onClick={onNew}
        className="mt-6 inline-flex rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-90"
      >
        + Start your first project
      </button>
      <p className="mt-4 font-mono-tight text-[11px] uppercase tracking-widest text-muted-foreground">
        Recording engine wires up next release
      </p>
    </div>
  );
}

function NewProjectDialog({
  onClose,
  onCreated,
  ownerId,
}: {
  onClose: () => void;
  onCreated: () => void;
  ownerId: string;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const clean = url.trim().replace(/^https?:\/\//i, "");
      const finalUrl = `https://${clean}`;
      const { error } = await supabase.from("projects").insert({
        owner_id: ownerId,
        name: name.trim(),
        base_url: finalUrl,
      });
      if (error) throw error;
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-glow)]"
      >
        <p className="font-mono-tight text-[11px] uppercase tracking-widest text-primary">
          /// New production
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight">Add a project</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We'll map the site next. You can add login credentials later.
        </p>

        <div className="mt-5 space-y-3">
          <label className="block">
            <span className="mb-1.5 block font-mono-tight text-[11px] uppercase tracking-widest text-muted-foreground">
              Project name
            </span>
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Analytics"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block font-mono-tight text-[11px] uppercase tracking-widest text-muted-foreground">
              Site URL
            </span>
            <div className="flex items-center rounded-lg border border-border bg-background focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20">
              <span className="pl-3 font-mono-tight text-xs text-muted-foreground">https://</span>
              <input
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="yoursaas.com"
                className="flex-1 bg-transparent px-2 py-2.5 text-sm outline-none"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </label>
          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
              {error}
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm hover:border-primary/60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}