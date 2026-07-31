import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Loader2, Plus, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { createProject, listProjects, type ProjectListItem } from "@/lib/studio.functions";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — WiseDemo" },
      { name: "description", content: "Your WiseDemo projects, demos, and render queue." },
      { property: "og:title", content: "Dashboard — WiseDemo" },
      { property: "og:description", content: "Your WiseDemo projects, demos, and render queue." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

type ProjectRow = ProjectListItem;

function Dashboard() {
  const fetchProjects = useServerFn(listProjects);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [open, setOpen] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      const rows = await fetchProjects();
      setProjects(rows);
    } catch {
      setProjects([]);
    }
  }, [fetchProjects]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-primary animate-record" />
            <span className="font-mono-tight text-sm font-semibold">WiseDemo</span>
            <span className="ml-2 hidden rounded-sm border border-border px-1.5 py-0.5 font-mono-tight text-[10px] uppercase text-muted-foreground sm:inline">
              Studio
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-3 text-sm">
            <span className="hidden font-mono-tight text-[11px] uppercase tracking-widest text-muted-foreground md:inline">
              Open workspace
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end sm:gap-6">
          <div className="min-w-0">
            <p className="font-mono-tight text-xs uppercase tracking-widest text-primary">/// Call sheet</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl md:text-4xl">Your productions</h1>
          </div>
          <Button
            onClick={() => setOpen(true)}
            className="w-full sm:w-auto"
          >
            <Plus />
            New project
          </Button>
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
                  className="rounded-xl border border-border bg-card transition hover:border-primary/50"
                >
                  <Link to="/projects/$projectId" params={{ projectId: p.id }} className="block p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-mono-tight text-[11px] uppercase text-muted-foreground">
                          {new Date(p.created_at).toLocaleDateString()}
                        </div>
                        <div className="mt-1 truncate text-lg font-semibold">{p.name}</div>
                        <div className="mt-1 truncate text-sm text-muted-foreground">{p.base_url}</div>
                      </div>
                      <span className="mt-2 rounded-md border border-border p-2 text-muted-foreground">
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    </div>
                  </Link>
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
        />
      )}
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-dashed border-border bg-card/40 p-12 text-center">
      <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Video className="h-5 w-5" />
      </div>
      <h2 className="text-xl font-semibold tracking-tight">The set is empty.</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        Add your first SaaS URL and WiseDemo will map, script, and film a 60-second cut.
      </p>
      <Button
        onClick={onNew}
        className="mt-6"
      >
        <Plus />
        Start your first project
      </Button>
    </div>
  );
}

function NewProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const navigate = useNavigate();
  const createProjectAction = useServerFn(createProject);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const project = await createProjectAction({ data: { name, baseUrl: url } });
      onCreated();
      navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
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
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={saving}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Plus />}
            {saving ? "Creating…" : "Create project"}
          </Button>
        </div>
      </form>
    </div>
  );
}