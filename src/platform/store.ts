import { GAMES } from "../games";
import type { ClientAds, ClientConfig, ClientSite, ClientTheme } from "../kit/theme";

/**
 * Client (operator) data for the portals and the back office. With VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set
 * at build time everything lives in Supabase (see supabase/README.md). Without them the platform runs in local demo
 * mode: clients are kept in this browser's localStorage, seeded with two examples, so it can be tried before setup.
 */
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";
export const supabaseConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

export interface ClientGame { game_id: string; enabled: boolean; sort: number }

export interface ClientRecord {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  theme: ClientTheme;
  ads: ClientAds;
  site: ClientSite;
  games: ClientGame[];
  /** Custom domains (lowercase host names) that open this client's portal. */
  domains?: string[];
  updated_at?: string;
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

export function toConfig(r: ClientRecord): ClientConfig {
  const games = [...r.games].filter((g) => g.enabled).sort((a, b) => a.sort - b.sort || a.game_id.localeCompare(b.game_id));
  return { slug: r.slug, name: r.name, theme: r.theme, ads: r.ads, site: r.site, games: games.map((g) => g.game_id) };
}

// ------------------------------------------------------------------ portal (read path, no SDK: one small fetch)

/** Loads one client's portal config, or null if it doesn't exist or is switched off. */
export async function loadPortal(slug: string): Promise<ClientConfig | null> {
  if (!SLUG_RE.test(slug)) return null;
  if (!supabaseConfigured) {
    const r = localClients().find((c) => c.slug === slug && c.active);
    return r ? toConfig(r) : null;
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/portal_config`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_slug: slug }),
  });
  if (!res.ok) throw new Error(`Could not load this portal (${res.status}).`);
  return (await res.json()) as ClientConfig | null;
}

/** Client portal for the current host name (a client's custom domain), or null for studio hosts. */
export async function portalSlugForHost(host: string): Promise<string | null> {
  host = host.toLowerCase();
  if (!host || host === "localhost" || /(^|\.)(github\.io|pages\.dev)$/.test(host) || /^[\d.]+$/.test(host)) return null;
  if (!supabaseConfigured) return localClients().find((c) => c.active && c.domains?.includes(host))?.slug ?? null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/portal_slug_for_host`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_host: host }),
    });
    return res.ok ? ((await res.json()) as string | null) : null;
  } catch { return null; }
}

// ------------------------------------------------------------------ local demo mode

const LOCAL_KEY = "platform.clients.v1";

const DEMO: ClientRecord[] = [
  {
    id: "demo-neon", slug: "demo", name: "Neon Play", active: true,
    theme: { accent: "#22d3ee", accent2: "#7c5cff" },
    ads: { provider: "test" },
    site: { headline: "Play instantly", tagline: "Free games, no downloads." },
    games: GAMES.map((g, sort) => ({ game_id: g.id, enabled: true, sort })),
  },
  {
    id: "demo-sunny", slug: "sunny-casino", name: "Sunny Casino", active: true,
    theme: { accent: "#ff9f1c", accent2: "#ffd166", panel: "#2b1a0e", text: "#fff6e8", recolorGames: true, font: "Poppins" },
    ads: { provider: "none" },
    site: { headline: "Sunny Arcade", tagline: "Quick games between the big wins.", footer: "© Sunny Casino" },
    games: ["slide2048", "arrowpuzzle"].map((game_id, sort) => ({ game_id, enabled: true, sort })),
  },
];

export function localClients(): ClientRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return JSON.parse(raw) as ClientRecord[];
  } catch { /* storage blocked: fall back to the demo data */ }
  return DEMO;
}

function saveLocal(list: ClientRecord[]) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

// ------------------------------------------------------------------ back office

export interface AdminStore {
  mode: "supabase" | "local";
  /** Signed-in admin email, null when signed out. */
  session(): Promise<string | null>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Throws a readable message when the signed-in user is not in the admins table. */
  list(): Promise<ClientRecord[]>;
  save(r: ClientRecord): Promise<ClientRecord>;
  remove(id: string): Promise<void>;
}

const localStore: AdminStore = {
  mode: "local",
  async session() { return "local demo"; },
  async signIn() {},
  async signOut() {},
  async list() { return localClients(); },
  async save(r) {
    const list = localClients();
    const rec = { ...r, id: r.id || `local-${Date.now().toString(36)}`, updated_at: new Date().toISOString() };
    if (list.some((c) => c.slug === rec.slug && c.id !== rec.id)) throw new Error(`The address "${rec.slug}" is already used.`);
    const i = list.findIndex((c) => c.id === rec.id);
    if (i >= 0) list[i] = rec; else list.push(rec);
    saveLocal(list);
    return rec;
  },
  async remove(id) { saveLocal(localClients().filter((c) => c.id !== id)); },
};

async function supabaseStore(): Promise<AdminStore> {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const check = <T>(r: { data: T; error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  return {
    mode: "supabase",
    async session() { return (await sb.auth.getSession()).data.session?.user.email ?? null; },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
    },
    async signOut() { await sb.auth.signOut(); },
    async list() {
      const uid = (await sb.auth.getUser()).data.user?.id;
      const admin = check(await sb.from("admins").select("user_id").eq("user_id", uid ?? "").maybeSingle());
      if (!admin) throw new Error(`This account is not an admin yet. In the Supabase SQL editor run:\ninsert into admins (user_id, email) values ('${uid}', '<your email>');`);
      const rows = check(await sb.from("clients").select("*, games:client_games(game_id, enabled, sort)").order("name"));
      return rows as ClientRecord[];
    },
    async save(r) {
      const fields = { slug: r.slug, name: r.name, active: r.active, theme: r.theme, ads: r.ads, site: r.site, domains: r.domains ?? [] };
      const saved = check(r.id
        ? await sb.from("clients").update(fields).eq("id", r.id).select().single()
        : await sb.from("clients").insert(fields).select().single()) as ClientRecord;
      const rows = r.games.map((g) => ({ ...g, client_id: saved.id }));
      if (rows.length) check(await sb.from("client_games").upsert(rows));
      const keep = r.games.map((g) => g.game_id);
      let del = sb.from("client_games").delete().eq("client_id", saved.id);
      if (keep.length) del = del.not("game_id", "in", `(${keep.map((k) => `"${k}"`).join(",")})`);
      check(await del);
      return { ...saved, games: r.games };
    },
    async remove(id) { check(await sb.from("clients").delete().eq("id", id)); },
  };
}

let storePromise: Promise<AdminStore> | null = null;
export const adminStore = () => (storePromise ??= supabaseConfigured ? supabaseStore() : Promise.resolve(localStore));
