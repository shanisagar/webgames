import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { GAMES, type GameEntry } from "../../games";
import { EmbedTab } from "../embed/AdminEmbed";
import { clientBrand } from "../Portal";
import { Showcase } from "../Showcase";
import { adminStore, SLUG_RE, toConfig, type AdminStore, type ClientGame, type ClientRecord, type GameFlags } from "../store";
import "./admin.css";

const blank = (): ClientRecord => ({
  id: "", slug: "", name: "", active: true,
  theme: { accent: "#22d3ee", accent2: "#7c5cff" },
  ads: { provider: "h5", testMode: true },
  site: {},
  games: GAMES.map((g, sort) => ({ game_id: g.id, enabled: true, sort })),
});

/** Every known game in the client's order; games added to the platform later show up at the end, switched off. */
function withAllGames(r: ClientRecord): ClientGame[] {
  const list = [...r.games].filter((g) => GAMES.some((x) => x.id === g.game_id)).sort((a, b) => a.sort - b.sort);
  for (const g of GAMES) if (!list.some((x) => x.game_id === g.id)) list.push({ game_id: g.id, enabled: false, sort: list.length });
  return list.map((g, sort) => ({ ...g, sort }));
}

const portalUrl = (slug: string) => `${location.origin}${location.pathname}#/c/${slug}`;

export default function Admin() {
  const [store, setStore] = useState<AdminStore | null>(null);
  const [user, setUser] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    document.title = "Back office";
    adminStore().then(async (s) => { setStore(s); setUser(await s.session()); });
  }, []);
  if (!store || user === undefined) return <div className="loading">Loading…</div>;
  if (!user) return <Login store={store} onIn={setUser} />;
  return <Dashboard store={store} user={user} onOut={() => store.signOut().then(() => setUser(null))} />;
}

function Login({ store, onIn }: { store: AdminStore; onIn: (u: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="adm adm-login">
      <form onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setError("");
        try { await store.signIn(email, password); onIn((await store.session()) ?? email); } catch (err) { setError((err as Error).message); }
        setBusy(false);
      }}>
        <h1>Back office</h1>
        <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="adm-error">{error}</p>}
        <button className="adm-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}

function Dashboard({ store, user, onOut }: { store: AdminStore; user: string; onOut: () => void }) {
  const [clients, setClients] = useState<ClientRecord[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<ClientRecord | null>(null);
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<"clients" | "catalogue">("clients");
  const [flags, setFlags] = useState<GameFlags>({});

  const reload = useCallback(async () => {
    try { setClients(await store.list()); setError(""); } catch (e) { setError((e as Error).message); setClients([]); }
    try { setFlags(await store.flags()); } catch (e) { setError((e as Error).message); }
  }, [store]);
  useEffect(() => { void reload(); }, [reload]);

  const open = (r: ClientRecord) => { setSelected(r.id); setDraft({ ...r, games: withAllGames(r) }); };
  const shown = (clients ?? []).filter((c) => !filter || `${c.name} ${c.slug}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="adm">
      <header className="adm-bar">
        <strong>Back office</strong>
        <nav className="adm-views">
          <button className={view === "clients" ? "on" : ""} onClick={() => setView("clients")}>Clients</button>
          <button className={view === "catalogue" ? "on" : ""} onClick={() => setView("catalogue")}>Game catalogue</button>
        </nav>
        {store.mode === "local" && <span className="adm-badge" title="Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to use the shared database">Local demo mode: changes stay in this browser</span>}
        <span className="adm-spacer" />
        <span className="adm-user">{user}</span>
        {store.mode === "supabase" && <button onClick={onOut}>Sign out</button>}
      </header>
      {error && <p className="adm-error adm-pad">{error}</p>}
      {view === "catalogue" ? <Catalogue store={store} initial={flags} onSaved={setFlags} /> : (
      <div className="adm-body">
        <aside className="adm-list">
          <button className="adm-primary" onClick={() => { setSelected(""); setDraft(blank()); }}>+ New client</button>
          <input type="search" placeholder="Find a client" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {clients === null && <p className="adm-dim">Loading…</p>}
          {shown.map((c) => (
            <button key={c.id} className={`adm-client${selected === c.id ? " on" : ""}`} onClick={() => open(c)}>
              <span className="adm-swatch" style={{ background: c.theme.accent ?? "#22d3ee" }} />
              <span><b>{c.name}</b><small>/{c.slug} · {c.games.filter((g) => g.enabled).length} games</small></span>
              {!c.active && <em>off</em>}
            </button>
          ))}
        </aside>
        <main className="adm-main">
          {draft ? (
            <Editor key={selected ?? "new"} store={store} initial={draft} flags={flags} onSaved={async (r) => { await reload(); open(r); }}
              onDeleted={async () => { setSelected(null); setDraft(null); await reload(); }} />
          ) : (
            <div className="adm-empty">
              <h2>Clients</h2>
              <p>Each client (operator) gets a branded games portal at its own address, with its own colours, ads and selection of games.</p>
              <p>Pick a client on the left or create a new one.</p>
            </div>
          )}
        </main>
      </div>
      )}
    </div>
  );
}

/** Platform-wide feature flag per game: a game switched off here is hidden from the studio site, every portal and every embed. */
function Catalogue({ store, initial, onSaved }: { store: AdminStore; initial: GameFlags; onSaved: (f: GameFlags) => void }) {
  const [flags, setFlags] = useState(initial);
  const [genre, setGenre] = useState("All");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const isOn = (id: string) => flags[id] !== false;
  const dirty = GAMES.some((g) => isOn(g.id) !== (initial[g.id] !== false));
  const genres = ["All", ...new Set(GAMES.map((g) => g.genre))];
  const shown = GAMES.filter((g) => genre === "All" || g.genre === genre);
  const setMany = (ids: string[], on: boolean) => setFlags((f) => ({ ...f, ...Object.fromEntries(ids.map((id) => [id, on])) }));
  const save = async () => {
    setBusy(true); setStatus("");
    const all = Object.fromEntries(GAMES.map((g) => [g.id, isOn(g.id)]));
    try { await store.saveFlags(all); onSaved(all); setStatus("Saved. Players see the change on their next visit."); }
    catch (e) { setStatus((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="adm-catalogue">
      <div className="adm-head">
        <div>
          <h2>Game catalogue</h2>
          <p className="adm-dim">Switch a game off to hide it everywhere: the studio site, every client portal and every embed. Clients keep their own selection; a game they have on comes back when you switch it on again.</p>
        </div>
        <div className="adm-actions">
          {status && <span className="adm-status">{status}</span>}
          <button className="adm-primary" onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
      <div className="adm-games-tools">
        <span><b>{GAMES.filter((g) => isOn(g.id)).length}</b> of {GAMES.length} games live</span>
        <select value={genre} onChange={(e) => setGenre(e.target.value)}>{genres.map((g) => <option key={g}>{g}</option>)}</select>
        <button onClick={() => setMany(shown.map((g) => g.id), true)}>Enable {genre === "All" ? "all" : genre}</button>
        <button onClick={() => setMany(shown.map((g) => g.id), false)}>Disable {genre === "All" ? "all" : genre}</button>
      </div>
      <ul className="adm-games">
        {shown.map((g) => (
          <li key={g.id} className={isOn(g.id) ? "" : "off"}>
            <img src={g.icon} alt="" width={44} height={44} />
            <span><b>{g.name}</b><small>{g.genre}</small></span>
            <label className="adm-switch">
              <input type="checkbox" checked={isOn(g.id)} onChange={(e) => setMany([g.id], e.target.checked)} />
              <span />
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Tab = "general" | "games" | "theme" | "ads" | "preview" | "embed";

function Editor({ store, initial, flags, onSaved, onDeleted }: {
  store: AdminStore; initial: ClientRecord; flags: GameFlags; onSaved: (r: ClientRecord) => void; onDeleted: () => void;
}) {
  const [r, setR] = useState(initial);
  const [tab, setTab] = useState<Tab>(initial.id ? "games" : "general");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(r) !== JSON.stringify(initial);
  const set = (patch: Partial<ClientRecord>) => setR((x) => ({ ...x, ...patch }));

  const problems = [
    !r.name.trim() && "Enter a name.",
    !SLUG_RE.test(r.slug) && "The address must be 2 to 41 lowercase letters, digits or dashes.",
    r.ads.provider === "h5" && r.ads.publisherId && !/^ca-pub-\d{10,20}$/.test(r.ads.publisherId) && "The AdSense publisher id looks like ca-pub-1234567890123456.",
  ].filter(Boolean) as string[];

  const save = async () => {
    if (problems.length) { setStatus(problems[0]); return; }
    setBusy(true); setStatus("");
    try { const saved = await store.save({ ...r, name: r.name.trim() }); setStatus("Saved."); onSaved(saved); }
    catch (e) { setStatus((e as Error).message); }
    setBusy(false);
  };
  const remove = async () => {
    if (!confirm(`Delete ${r.name}? Its portal stops working immediately.`)) return;
    setBusy(true);
    try { await store.remove(r.id); onDeleted(); } catch (e) { setStatus((e as Error).message); setBusy(false); }
  };

  return (
    <div className="adm-editor">
      <div className="adm-head">
        <div>
          <h2>{r.name || "New client"}</h2>
          {r.id && SLUG_RE.test(initial.slug) && (
            <p className="adm-link">
              <a href={`#/c/${initial.slug}`} target="_blank" rel="noreferrer">{portalUrl(initial.slug)}</a>
              <button onClick={() => navigator.clipboard?.writeText(portalUrl(initial.slug)).then(() => setStatus("Link copied."))}>Copy</button>
            </p>
          )}
        </div>
        <div className="adm-actions">
          {status && <span className="adm-status">{status}</span>}
          {r.id && <button className="adm-danger" onClick={remove} disabled={busy}>Delete</button>}
          <button className="adm-primary" onClick={save} disabled={busy || (!dirty && !!r.id)}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
      <nav className="adm-tabs">
        {(["general", "games", "theme", "ads", "preview", "embed"] as Tab[]).map((t) => (
          <button key={t} className={t === tab ? "on" : ""} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </nav>
      {tab === "general" && <General r={r} set={set} />}
      {tab === "games" && <Games r={r} set={set} flags={flags} />}
      {tab === "theme" && <ThemeTab r={r} set={set} />}
      {tab === "ads" && <AdsTab r={r} set={set} />}
      {tab === "embed" && <EmbedTab saved={initial} />}
      {tab === "preview" && (
        <div className="adm-preview" onClickCapture={(e) => e.preventDefault()}><div className="adm-preview-inner"><Showcase games={toConfig(r).games!.filter((id) => flags[id] !== false).map((id) => GAMES.find((g) => g.id === id)!)} brand={{ ...clientBrand(toConfig(r)), base: `#/c/${r.slug}/` }} /></div></div>
      )}
    </div>
  );
}

type TabProps = { r: ClientRecord; set: (p: Partial<ClientRecord>) => void };

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="adm-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function General({ r, set }: TabProps) {
  const site = (p: Partial<ClientRecord["site"]>) => set({ site: { ...r.site, ...p } });
  return (
    <div className="adm-form">
      <Field label="Client name"><input value={r.name} onChange={(e) => set({ name: e.target.value, slug: r.id || r.slug ? r.slug : autoSlug(e.target.value) })} /></Field>
      <Field label="Portal address" hint={`Players open ${portalUrl(r.slug || "<address>")}`}>
        <input value={r.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
      </Field>
      <label className="adm-check"><input type="checkbox" checked={r.active} onChange={(e) => set({ active: e.target.checked })} /> Portal is live (switch off to take it down)</label>
      <Field label="Headline"><input value={r.site.headline ?? ""} placeholder={r.name} onChange={(e) => site({ headline: e.target.value })} /></Field>
      <Field label="Tagline"><input value={r.site.tagline ?? ""} placeholder="Play instantly in your browser." onChange={(e) => site({ tagline: e.target.value })} /></Field>
      <Field label="Footer"><input value={r.site.footer ?? ""} placeholder={`© ${r.name}`} onChange={(e) => site({ footer: e.target.value })} /></Field>
      <Field label="Logo links to" hint="Optional: the operator's own website."><input type="url" value={r.site.homeUrl ?? ""} onChange={(e) => site({ homeUrl: e.target.value || undefined })} /></Field>
      <Field label="Custom domains" hint="Optional, comma-separated, e.g. games.client.com. Point each domain at the site (see docs/HOSTING.md); visiting it opens this portal.">
        <DomainsInput value={r.domains ?? []} onChange={(domains) => set({ domains })} />
      </Field>
    </div>
  );
}

/** Comma-separated host names; parsed on blur so typing commas and spaces isn't fought by re-renders. */
function DomainsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  const parse = () => {
    const list = text.split(/[,\s]+/).map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean);
    onChange([...new Set(list)]);
    setText(list.join(", "));
  };
  return <input value={text} placeholder="games.client.com" onChange={(e) => setText(e.target.value)} onBlur={parse} />;
}

const autoSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 41);

function Games({ r, set, flags }: TabProps & { flags: GameFlags }) {
  const [genre, setGenre] = useState("All");
  const byId = useMemo(() => new Map(GAMES.map((g) => [g.id, g])), []);
  const genres = ["All", ...new Set(GAMES.map((g) => g.genre))];
  const list = r.games;
  const update = (games: ClientGame[]) => set({ games: games.map((g, sort) => ({ ...g, sort })) });
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };
  const setAll = (enabled: boolean) => update(list.map((g) => (genre === "All" || byId.get(g.game_id)?.genre === genre ? { ...g, enabled } : g)));
  const on = list.filter((g) => g.enabled).length;
  return (
    <div>
      <div className="adm-games-tools">
        <span><b>{on}</b> of {list.length} games enabled</span>
        <select value={genre} onChange={(e) => setGenre(e.target.value)}>{genres.map((g) => <option key={g}>{g}</option>)}</select>
        <button onClick={() => setAll(true)}>Enable {genre === "All" ? "all" : genre}</button>
        <button onClick={() => setAll(false)}>Disable {genre === "All" ? "all" : genre}</button>
      </div>
      <ul className="adm-games">
        {list.map((cg, i) => {
          const g = byId.get(cg.game_id) as GameEntry;
          if (genre !== "All" && g.genre !== genre) return null;
          return (
            <li key={cg.game_id} className={cg.enabled ? "" : "off"}>
              <img src={g.icon} alt="" width={44} height={44} />
              <span><b>{g.name}</b><small>{g.genre}{flags[g.id] === false && " · off in the game catalogue"}</small></span>
              <span className="adm-order">
                <button aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                <button aria-label="Move down" onClick={() => move(i, 1)} disabled={i === list.length - 1}>↓</button>
              </span>
              <label className="adm-switch">
                <input type="checkbox" checked={cg.enabled} onChange={(e) => update(list.map((x) => (x === cg ? { ...x, enabled: e.target.checked } : x)))} />
                <span />
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Color({ label, value, onChange }: { label: string; value?: string; onChange: (v: string | undefined) => void }) {
  return (
    <Field label={label}>
      <span className="adm-color">
        <input type="color" value={value ?? "#000000"} onChange={(e) => onChange(e.target.value)} />
        <code>{value ?? "game default"}</code>
        {value && <button onClick={(e) => { e.preventDefault(); onChange(undefined); }}>Reset</button>}
      </span>
    </Field>
  );
}

const FONTS = ["", "Poppins", "Montserrat", "Nunito", "Fredoka", "Baloo 2", "Rubik", "Lilita One", "Orbitron", "Inter"];

function ThemeTab({ r, set }: TabProps) {
  const t = (p: Partial<ClientRecord["theme"]>) => set({ theme: { ...r.theme, ...p } });
  return (
    <div className="adm-form">
      <div className="adm-cols">
        <Color label="Accent" value={r.theme.accent} onChange={(accent) => t({ accent })} />
        <Color label="Second accent" value={r.theme.accent2} onChange={(accent2) => t({ accent2 })} />
        <Color label="Panels" value={r.theme.panel} onChange={(panel) => t({ panel })} />
        <Color label="Text" value={r.theme.text} onChange={(text) => t({ text })} />
        <Color label="Background top" value={r.theme.bgTop} onChange={(bgTop) => t({ bgTop })} />
        <Color label="Background bottom" value={r.theme.bgBottom} onChange={(bgBottom) => t({ bgBottom })} />
      </div>
      <label className="adm-check"><input type="checkbox" checked={!!r.theme.recolorGames} onChange={(e) => t({ recolorGames: e.target.checked })} />
        Paint the games in these colours too (otherwise only the portal and game menus use them)</label>
      <Field label="Font" hint="Any Google Fonts family.">
        <input list="adm-fonts" value={r.theme.font ?? ""} placeholder="Default" onChange={(e) => t({ font: e.target.value || undefined })} />
        <datalist id="adm-fonts">{FONTS.filter(Boolean).map((f) => <option key={f} value={f} />)}</datalist>
      </Field>
      <Field label="Logo URL" hint="PNG, SVG or WebP, shown in the portal header (about 34px high).">
        <input type="url" value={r.theme.logoUrl ?? ""} onChange={(e) => t({ logoUrl: e.target.value || undefined })} />
      </Field>
    </div>
  );
}

function AdsTab({ r, set }: TabProps) {
  const a = (p: Partial<ClientRecord["ads"]>) => set({ ads: { ...r.ads, ...p } });
  const num = (v: string) => (v === "" ? undefined : Math.max(0, Math.round(Number(v))));
  return (
    <div className="adm-form">
      <Field label="Ads">
        <select value={r.ads.provider ?? "h5"} onChange={(e) => a({ provider: e.target.value as "h5" | "test" | "none" })}>
          <option value="h5">Google AdSense (H5 Games Ads)</option>
          <option value="test">Test ads (placeholder countdown)</option>
          <option value="none">No ads</option>
        </select>
      </Field>
      {r.ads.provider !== "none" && r.ads.provider !== "test" && (
        <>
          <Field label="AdSense publisher id" hint="The client's own ca-pub id, so the revenue is theirs. Leave empty to use the studio's.">
            <input value={r.ads.publisherId ?? ""} placeholder="ca-pub-…" onChange={(e) => a({ publisherId: e.target.value.trim() || undefined })} />
          </Field>
          <label className="adm-check"><input type="checkbox" checked={r.ads.testMode ?? true} onChange={(e) => a({ testMode: e.target.checked })} />
            Google test ads (switch off once AdSense approves H5 games ads for the site)</label>
        </>
      )}
      {r.ads.provider !== "none" && (
        <div className="adm-cols">
          <Field label="Interstitial every N games" hint="Default 3"><input type="number" min={1} value={r.ads.interstitialEveryRuns ?? ""} onChange={(e) => a({ interstitialEveryRuns: num(e.target.value) })} /></Field>
          <Field label="Seconds between ads" hint="Default 120"><input type="number" min={0} value={r.ads.minSecondsBetweenAds ?? ""} onChange={(e) => a({ minSecondsBetweenAds: num(e.target.value) })} /></Field>
          <Field label="Ad-free first games" hint="Default 3"><input type="number" min={0} value={r.ads.graceRuns ?? ""} onChange={(e) => a({ graceRuns: num(e.target.value) })} /></Field>
        </div>
      )}
    </div>
  );
}
