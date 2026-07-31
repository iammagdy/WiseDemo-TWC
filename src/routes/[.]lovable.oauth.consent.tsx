import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";

import { supabase } from "@/integrations/supabase/client";

type OAuthNamespace = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: Error | null }>;
  approveAuthorization: (id: string) => Promise<{ data: RedirectPayload | null; error: Error | null }>;
  denyAuthorization: (id: string) => Promise<{ data: RedirectPayload | null; error: Error | null }>;
};

type RedirectPayload = { redirect_url?: string; redirect_to?: string };
type AuthorizationDetails = RedirectPayload & { client?: { name?: string } };

function oauth(): OAuthNamespace {
  return (supabase.auth as unknown as { oauth: OAuthNamespace }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
    if (error) throw error;
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-md px-6 py-24 text-foreground">
      <h1 className="text-xl font-semibold">Authorization failed</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {String((error as Error)?.message ?? error)}
      </p>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientName = details?.client?.name ?? "this app";

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16 text-foreground">
      <p className="font-mono-tight text-[11px] uppercase tracking-widest text-primary">/// Agent access</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">
        Connect {clientName} to your account
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {clientName} will be able to read your projects, product maps and demo recordings, and update your
        product maps — acting as you.
      </p>
      {error && (
        <p role="alert" className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          {error}
        </p>
      )}
      <div className="mt-8 flex gap-3">
        <button
          disabled={busy}
          onClick={() => decide(true)}
          className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Working…" : "Approve"}
        </button>
        <button
          disabled={busy}
          onClick={() => decide(false)}
          className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium transition hover:border-primary/60 disabled:opacity-50"
        >
          Deny
        </button>
      </div>
    </main>
  );
}