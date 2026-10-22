import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from "react";
import { GAMES } from "./games";
import { AdService } from "./kit/ads";
import { currentClient, setClient } from "./kit/theme";
import { installEmbedBridge } from "./platform/embed/bridge";
import { EmbedGame } from "./platform/embed/EmbedGame";
import { GameDetail } from "./platform/GameDetail";
import { GameFrame, Notice, Portal } from "./platform/Portal";
import { Showcase, STUDIO } from "./platform/Showcase";

/** Development only: #/dev/<folder> opens any game folder (src/games/<folder>/index.tsx), registered or not. */
const devGames = import.meta.env.DEV ? import.meta.glob<{ default: ComponentType }>("./games/*/index.tsx") : {};

/** The back office is its own chunk (it pulls in the Supabase SDK). */
const Admin = lazy(() => import("./platform/admin/Admin"));
/** Developer page for operators embedding the games. */
const EmbedDocs = lazy(() => import("./platform/embed/EmbedDocs"));

/** Build with VITE_GAME=<id> to ship a single game that opens straight away (for embedding or previews). */
const ONLY_GAME = import.meta.env.VITE_GAME as string | undefined;
/** The hash path without its query: "#/embed/slide2048?client=demo" → "embed/slide2048". */
const currentRoute = () => ONLY_GAME ?? decodeURIComponent(location.hash.replace(/^#\/?/, "").split("?")[0]).replace(/\/$/, "");
/** Query parameters inside the hash (after "?"). */
const hashQuery = () => new URLSearchParams(location.hash.split("?").slice(1).join("?"));

const studioBrand = { ...STUDIO, base: "#/" };

/**
 * Hash routing so every page has its own link and GitHub Pages needs no server rewrites:
 *   #/                 studio showcase          #/<game>            a game
 *   #/c/<client>       a client's portal        #/c/<client>/<game> a game inside that portal
 *   #/admin            back office
 *   #/embed/<game>[?client=<slug>&sound=0]   bare game for an operator's iframe
 *   #/embed/portal/<client>[/<game>]          a client's portal inside an iframe
 *   #/embed-docs       how to embed (snippets, events, commands)
 */
export default function App() {
  const [route, setRoute] = useState(currentRoute);
  const [hash, setHash] = useState(() => location.hash); // also re-renders when only the hash query changes
  useEffect(() => {
    const onHash = () => { setRoute(currentRoute()); setHash(location.hash); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const devLoader = route.startsWith("dev/") ? devGames[`./games/${route.slice(4)}/index.tsx`] : undefined;
  const DevGame = useMemo(() => (devLoader ? lazy(devLoader) : null), [devLoader]);
  if (DevGame) return <Suspense fallback={<div className="loading">Loading…</div>}><DevGame /></Suspense>;

  const parts = route.split("/");
  if (parts[0] === "embed" && parts[1]) {
    const q = hashQuery();
    const portal = parts[1] === "portal";
    const client = portal ? parts[2] ?? null : q.get("client");
    installEmbedBridge({ muted: q.get("sound") === "0", view: portal ? "portal" : "game", game: portal ? null : parts[1], client });
    if (portal) return <Portal slug={parts[2] ?? ""} gameId={parts[3] ?? ""} embedded />;
    return <EmbedGame key={hash} gameId={parts[1]} slug={client} />;
  }
  if (parts[0] === "embed-docs") return <Suspense fallback={<div className="loading">Loading…</div>}><EmbedDocs /></Suspense>;
  if (parts[0] === "c" && parts[1]) return <Portal slug={parts[1]} gameId={parts[2] ?? ""} />;
  if (parts[0] === "admin") return <Suspense fallback={<div className="loading">Loading…</div>}><Admin /></Suspense>;
  return <Studio id={route} />;
}

function Studio({ id }: { id: string }) {
  // Studio pages use the studio's own look and ads. This must happen before a game boots, so it runs during render.
  if (currentClient()) {
    if (AdService.started) location.reload();
    setClient(null);
  }
  // The studio site is a showcase: games play only inside a client portal or a client embed (single-game builds aside).
  if (!id) return <Showcase games={GAMES} brand={studioBrand} playable={false} />;
  const game = GAMES.find((g) => g.id === id);
  if (!game) return <Notice title="Game not found" text={`There is no game called "${id}".`} />;
  if (ONLY_GAME) return <GameFrame game={game} back="#/" />;
  return <GameDetail game={game} games={GAMES} />;
}
