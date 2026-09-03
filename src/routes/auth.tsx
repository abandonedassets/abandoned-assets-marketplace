import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Authenticate — Magic Link" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

// Only allow same-origin relative paths
function safePath(raw?: string): string {
  if (!raw) return "/";
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Auto-redirect if already authenticated
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      const stored =
        typeof window !== "undefined"
          ? window.localStorage.getItem("post_auth_redirect") ?? undefined
          : undefined;
      window.localStorage.removeItem("post_auth_redirect");
      navigate({ to: safePath(search.redirect ?? stored), replace: true });
    });
  }, [navigate, search.redirect]);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const target = safePath(search.redirect);
      // Survives providers/allow-lists that strip the redirect query param.
      window.localStorage.setItem("post_auth_redirect", target);
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth?redirect=${encodeURIComponent(target)}`,
        },
      });
      if (error) throw error;
      setSent(true);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to send magic link");
    } finally {
      setLoading(false);
    }
  }


  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold text-card-foreground">
          Authenticate
        </h1>
        <p className="text-xs text-muted-foreground">
          Zero-trust passwordless access. Enter your admin email to receive a
          secure magic link.
        </p>

        {sent ? (
          <div className="space-y-3">
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3">
              <p className="text-sm font-medium text-emerald-700">
                Magic link sent
              </p>
              <p className="mt-1 text-xs text-emerald-600/80">
                Check your inbox for <strong>{email}</strong>. Click the link to
                authenticate instantly.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSent(false)}
              className="w-full text-xs text-muted-foreground hover:text-foreground"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={sendMagicLink} className="space-y-4">
            <input
              type="email"
              required
              placeholder="admin@yourdomain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            {err && <p className="text-sm text-destructive">{err}</p>}
            <button
              disabled={loading}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send Magic Link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
