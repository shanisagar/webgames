import { useEffect, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Login gate for the dev preview site (<site>/dev/): only back-office admins (rows in the admins table) get in.
 * It keeps casual visitors out of unreleased work; the built files themselves stay public on the static host.
 * Uses the realtime settings the dev preview is built with (the studio's Supabase project), so the dev back office
 * can stay in local demo mode. Without them it stays locked.
 */
const env = import.meta.env as Record<string, string | undefined>;
const URL_ = (env.VITE_REALTIME_URL ?? env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
const KEY = env.VITE_REALTIME_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? "";

let clientPromise: Promise<SupabaseClient> | null = null;
const client = () => (clientPromise ??= import("@supabase/supabase-js").then(({ createClient }) =>
  createClient(URL_, KEY, { auth: { storageKey: "dev-gate-auth" } })));

type State = { kind: "checking" } | { kind: "locked"; error: string } | { kind: "in"; email: string };

async function adminEmail(sb: SupabaseClient): Promise<string | null> {
  const user = (await sb.auth.getUser()).data.user;
  if (!user) return null;
  const { data, error } = await sb.rpc("is_admin");
  if (error) throw new Error(error.message);
  return data === true ? user.email ?? "admin" : null;
}

export default function DevGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "checking" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    if (!URL_ || !KEY) { setState({ kind: "locked", error: "This preview is not connected to the studio's login." }); return; }
    client().then(adminEmail)
      .then((e) => setState(e ? { kind: "in", email: e } : { kind: "locked", error: "" }))
      .catch((err: Error) => setState({ kind: "locked", error: err.message }));
  }, []);

  if (state.kind === "in") {
    return (
      <>
        {children}
        <button className="devgate-out" onClick={() => client().then((sb) => sb.auth.signOut()).then(() => location.reload())}>
          Dev preview · {state.email} · Sign out
        </button>
      </>
    );
  }
  if (state.kind === "checking") return <div className="loading">Loading…</div>;

  const signIn = async () => {
    setBusy(true);
    try {
      const sb = await client();
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      const e = await adminEmail(sb);
      if (!e) { await sb.auth.signOut(); throw new Error("This account is not a studio admin."); }
      setState({ kind: "in", email: e });
    } catch (err) {
      const msg = (err as Error).message;
      setState({ kind: "locked", error: /fetch|network/i.test(msg) ? "Could not reach the login server. Check your connection." : msg });
    }
    setBusy(false);
  };

  return (
    <div className="devgate">
      <form onSubmit={(e) => { e.preventDefault(); void signIn(); }}>
        <h1>Dev preview</h1>
        <p>Unreleased work. Sign in with your back-office admin account.</p>
        <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {state.error && <p className="devgate-error">{state.error}</p>}
        <button disabled={busy || !URL_}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
