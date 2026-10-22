import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from "react";
import { GAMES } from "./games";
import { AdService } from "./kit/ads";
import { currentClient, setClient } from "./kit/theme";
import { GameFrame, Notice, Portal } from "./platform/Portal";
import { Showcase, STUDIO } from "./platform/Showcase";

/** Development only: #/dev/<folder> opens any game folder (src/games/<folder>/index.tsx), registered or not. */
const devGames = import.meta.env.DEV ? import.meta.glob<{ default: ComponentType }>("./games/*/index.tsx") : {};

/** The back office is its own chunk (it pulls in the Supabase SDK). */
const Admin = lazy(() => import("./platform/admin/Admin"));

/** Build with VITE_GAME=<id> to ship a single game that opens straight away (for embedding or previews). */
const ONLY_GAME = import.meta.env.VITE_GAME as string | undefined;
const currentRoute = () => ONLY_GAME ?? decodeURIComponent(location.hash.replace(/^#\/?/, "")).replace(/\/$/, "");

const studioBrand = { ...STUDIO, base: "#/" };

/**
 * Hash routing so every page has its own link and GitHub Pages needs no server rewrites:
 *   #/                 studio showcase          #/<game>            a game
 *   #/c/<client>       a client's portal        #/c/<client>/<game> a game inside that portal
 *   #/admin            back office
 */
export default function App() {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const onHash = () => { setRoute(currentRoute()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const devLoader = route.startsWith("dev/") ? devGames[`./games/${route.slice(4)}/index.tsx`] : undefined;
  const DevGame = useMemo(() => (devLoader ? lazy(devLoader) : null), [devLoader]);
  if (DevGame) return <Suspense fallback={<div className="loading">Loading…</div>}><DevGame /></Suspense>;

  const parts = route.split("/");
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
  if (!id) return <Showcase games={GAMES} brand={studioBrand} />;
  const game = GAMES.find((g) => g.id === id);
  if (!game) return <Notice title="Game not found" text={`There is no game called "${id}".`} />;
  return <GameFrame game={game} back="#/" />;
}
