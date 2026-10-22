import { Suspense, useEffect, useState } from "react";
import { GAMES, type GameEntry } from "../games";
import { AdService } from "../kit/ads";
import { currentClient, setClient, type ClientConfig } from "../kit/theme";
import { rememberPlayed, Showcase, themeVars, type Branding } from "./Showcase";
import { loadPortal } from "./store";

/** Full-screen game with a small "back to games" button. */
export function GameFrame({ game, back, brand }: { game: GameEntry; back: string; brand?: Branding }) {
  useEffect(() => {
    document.title = brand ? `${game.name} · ${brand.name}` : game.name;
    rememberPlayed(game.id);
  }, [game, brand]);
  const Game = game.component;
  return (
    <div className="frame" style={themeVars(brand?.theme)}>
      <Suspense fallback={<div className="loading">Loading {game.name}…</div>}>
        <Game />
      </Suspense>
      <a className="frame-back" href={back} aria-label="All games" title="All games">
        <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
      </a>
    </div>
  );
}

export function clientBrand(c: ClientConfig): Branding {
  return {
    name: c.name,
    headline: c.site?.headline || c.name,
    tagline: c.site?.tagline || "Play instantly in your browser.",
    footer: c.site?.footer || `© ${c.name}`,
    logoUrl: c.theme.logoUrl,
    homeUrl: c.site?.homeUrl,
    theme: c.theme,
    base: `#/c/${c.slug}/`,
  };
}

type State = { status: "loading" } | { status: "missing" } | { status: "error"; message: string } | { status: "ok"; client: ClientConfig };

/** #/c/<slug> (the client's game list) and #/c/<slug>/<game>. */
export function Portal({ slug, gameId }: { slug: string; gameId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    loadPortal(slug)
      .then((client) => {
        if (!live) return;
        if (!client) { setState({ status: "missing" }); return; }
        // Ads can't switch publisher once a game started them, so a different client gets a fresh page.
        const prev = currentClient();
        if (AdService.started && prev?.slug !== client.slug) { location.reload(); return; }
        setClient(client);
        setState({ status: "ok", client });
      })
      .catch((e: Error) => live && setState({ status: "error", message: e.message }));
    return () => { live = false; };
  }, [slug]);

  if (state.status === "loading") return <div className="loading">Loading…</div>;
  if (state.status === "missing") return <Notice title="Portal not found" text={`There is no active games portal at "${slug}".`} />;
  if (state.status === "error") return <Notice title="Something went wrong" text={state.message} />;

  const client = state.client;
  const brand = clientBrand(client);
  const ids = client.games ?? GAMES.map((g) => g.id);
  const games = ids.map((id) => GAMES.find((g) => g.id === id)).filter((g): g is GameEntry => !!g);
  if (gameId) {
    const game = games.find((g) => g.id === gameId);
    if (!game) return <Notice title="Game unavailable" text="This game is not available here." link={brand.base} />;
    return <GameFrame game={game} back={brand.base} brand={brand} />;
  }
  return <Showcase games={games} brand={brand} />;
}

export function Notice({ title, text, link = "#/" }: { title: string; text: string; link?: string }) {
  return (
    <main className="notice">
      <h1>{title}</h1>
      <p>{text}</p>
      <a href={link}>Back to games</a>
    </main>
  );
}
