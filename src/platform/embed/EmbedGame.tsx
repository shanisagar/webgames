import { Suspense, useEffect, useLayoutEffect, useState } from "react";
import { GAMES } from "../../games";
import { AdService } from "../../kit/ads";
import { GameNav } from "../../kit/nav";
import { currentClient, setClient, type ClientConfig } from "../../kit/theme";
import { Boundary } from "../Boundary";
import { themeVars } from "../Showcase";
import { loadPortal } from "../store";
import "./embed.css";

type State = { status: "loading" } | { status: "unavailable"; text: string } | { status: "ok"; client: ClientConfig | null };

/**
 * #/embed/<game>[?client=<slug>]: the bare game for an operator's iframe. Full-bleed, no site chrome and no way out
 * (GameNav.home stays null, so the kit shows no ALL GAMES / home buttons). With `client`, that client's theme and ads
 * apply, and only games enabled for an active client play.
 */
export function EmbedGame({ gameId, slug }: { gameId: string; slug: string | null }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const game = GAMES.find((g) => g.id === gameId);

  useEffect(() => {
    let live = true;
    const apply = (client: ClientConfig | null) => {
      // Ads can't switch publisher once a game started them: a different client (or none) gets a fresh page.
      if (AdService.started && currentClient()?.slug !== client?.slug) { location.reload(); return; }
      setClient(client);
      setState({ status: "ok", client });
    };
    if (!game) { setState({ status: "unavailable", text: "This game is not available." }); return; }
    if (!slug) { apply(null); return; }
    setState({ status: "loading" });
    loadPortal(slug)
      .then((client) => {
        if (!live) return;
        if (!client || (client.games && !client.games.includes(game.id))) {
          setState({ status: "unavailable", text: "This game is not available here." });
          return;
        }
        apply(client);
      })
      .catch(() => live && setState({ status: "unavailable", text: "This game could not be loaded. Please try again later." }));
    return () => { live = false; };
  }, [game, slug]);

  useEffect(() => { if (game) document.title = game.name; }, [game]);
  // No home button inside an embed: the operator's page is the "home".
  useLayoutEffect(() => { GameNav.home = null; }, []);

  if (state.status === "loading") return <div className="loading">Loading…</div>;
  if (state.status === "unavailable" || !game) {
    return <div className="embed-unavailable" role="status">{state.status === "unavailable" ? state.text : "Unavailable."}</div>;
  }
  const Game = game.component;
  return (
    <div className="frame embed-frame" data-game={game.id} style={themeVars(state.client?.theme)}>
      <Boundary back={location.hash}>
        <Suspense fallback={<div className="loading">Loading {game.name}…</div>}>
          <Game />
        </Suspense>
      </Boundary>
    </div>
  );
}
