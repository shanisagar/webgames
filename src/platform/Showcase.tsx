import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { GameEntry } from "../games";
import { updateManifest } from "./manifest";
import type { ClientTheme } from "../kit/theme";

/** Studio branding. The name is a placeholder until the studio is named. */
export const STUDIO = {
  name: "Shani Sagar Games",
  headline: "Games that load before you blink.",
  tagline: "Arcade, puzzle and casual hits built for the browser. No installs, no waiting: tap and play on any phone or desktop.",
  footer: "© Shani Sagar Games. All games run in your browser.",
};

export interface Branding {
  name: string;
  headline: string;
  tagline: string;
  footer: string;
  logoUrl?: string;
  homeUrl?: string;
  theme?: ClientTheme;
  /** Hash prefix for game links: "#/" for the studio, "#/c/<slug>/" for a client portal. */
  base: string;
}

const RECENT_KEY = "site.recent";
export function rememberPlayed(id: string) {
  try {
    const list = [id, ...recent().filter((x) => x !== id)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* storage blocked */ }
}
function recent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]; } catch { return []; }
}

/** CSS variables for a client theme (falls back to the studio look). */
export function themeVars(t?: ClientTheme): CSSProperties {
  const v: Record<string, string> = {};
  if (t?.accent) v["--accent"] = t.accent;
  if (t?.accent2) v["--accent2"] = t.accent2;
  if (t?.panel) v["--panel"] = t.panel;
  if (t?.text) v["--text"] = t.text;
  if (t?.bgTop) v["--bg-top"] = t.bgTop;
  if (t?.bgBottom) v["--bg-bottom"] = t.bgBottom;
  if (t?.font) v["--font"] = `"${t.font}", system-ui, sans-serif`;
  return v as CSSProperties;
}

export function Showcase({ games, brand }: { games: GameEntry[]; brand: Branding }) {
  const [genre, setGenre] = useState("All");
  const [query, setQuery] = useState("");
  useEffect(() => { document.title = brand.name; updateManifest(brand.name, brand.name); }, [brand.name]);

  const genres = useMemo(() => ["All", ...new Set(games.map((g) => g.genre))], [games]);
  const shown = games.filter((g) =>
    (genre === "All" || g.genre === genre) &&
    (!query || `${g.name} ${g.genre} ${g.tagline}`.toLowerCase().includes(query.toLowerCase())));
  const recentGames = recent().map((id) => games.find((g) => g.id === id)).filter((g): g is GameEntry => !!g).slice(0, 6);
  const featured = games.filter((g) => g.feature).slice(0, 5);
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    if (featured.length < 2) return;
    const t = setInterval(() => setSlide((s) => (s + 1) % featured.length), 6000);
    return () => clearInterval(t);
  }, [featured.length]);
  const hero = featured[slide % Math.max(1, featured.length)];

  return (
    <div className="site" style={themeVars(brand.theme)}>
      <header className="site-bar">
        <a className="site-brand" href={brand.homeUrl ?? brand.base}>
          {brand.logoUrl ? <img src={brand.logoUrl} alt="" /> : <span className="site-mark" aria-hidden>▲</span>}
          <span>{brand.name}</span>
        </a>
        <span className="site-count">{games.length} games</span>
      </header>

      <section className="site-hero">
        {hero && <img key={hero.id} className="site-hero-bg" src={hero.feature} alt="" />}
        <div className="site-hero-copy">
          <h1>{brand.headline}</h1>
          <p>{brand.tagline}</p>
          {hero && (
            <a className="site-cta" href={`${brand.base}${hero.id}`}>
              Play {hero.name} <span aria-hidden>→</span>
            </a>
          )}
          {featured.length > 1 && (
            <div className="site-dots">
              {featured.map((g, i) => (
                <button key={g.id} aria-label={g.name} className={i === slide % featured.length ? "on" : ""} onClick={() => setSlide(i)} />
              ))}
            </div>
          )}
        </div>
      </section>

      {recentGames.length > 0 && (
        <section className="site-section">
          <h2>Continue playing</h2>
          <div className="site-row">
            {recentGames.map((g) => (
              <a key={g.id} className="site-mini" href={`${brand.base}${g.id}`}>
                <img src={g.icon} alt="" loading="lazy" width={72} height={72} />
                <span>{g.name}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="site-section">
        <div className="site-tools">
          <div className="site-chips" role="tablist">
            {genres.map((x) => (
              <button key={x} role="tab" aria-selected={x === genre} className={x === genre ? "on" : ""} onClick={() => setGenre(x)}>{x}</button>
            ))}
          </div>
          <input className="site-search" type="search" placeholder="Search games" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="site-grid">
          {shown.map((g) => (
            <a key={g.id} className="site-card" href={`${brand.base}${g.id}`}>
              <img src={g.icon} alt="" loading="lazy" width={256} height={256} />
              <div>
                <h3>{g.name}</h3>
                <span className="site-genre">{g.genre}</span>
                <p>{g.tagline}</p>
              </div>
            </a>
          ))}
          {shown.length === 0 && <p className="site-empty">No games match.</p>}
        </div>
      </section>

      <footer className="site-foot">{brand.footer}</footer>
    </div>
  );
}
