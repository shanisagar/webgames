import { useEffect } from "react";
import type { GameEntry } from "../games";
import { STUDIO } from "./Showcase";

/** Studio showcase page for one game: what it is, plus a demo request. The game itself only plays in client portals. */
export function GameDetail({ game, games }: { game: GameEntry; games: GameEntry[] }) {
  useEffect(() => { document.title = `${game.name} · ${STUDIO.name}`; window.scrollTo(0, 0); }, [game]);
  const more = games.filter((g) => g.genre === game.genre && g.id !== game.id).slice(0, 4);
  const subject = encodeURIComponent(`Demo request: ${game.name}`);
  return (
    <div className="site">
      <header className="site-bar">
        <a className="site-brand" href="#/"><span className="site-mark" aria-hidden>▲</span><span>{STUDIO.name}</span></a>
        <a className="site-count" href="#/">All games</a>
      </header>
      <section className="detail">
        <div className="detail-art">
          {game.feature ? <img src={game.feature} alt="" /> : <img className="detail-icon-big" src={game.icon} alt="" />}
        </div>
        <div className="detail-copy">
          <img className="detail-icon" src={game.icon} alt="" width={96} height={96} />
          <span className="site-genre">{game.genre}</span>
          <h1>{game.name}</h1>
          <p className="detail-tagline">{game.tagline}</p>
          <p>{game.description}</p>
          <ul className="detail-facts">
            <li>Runs in any browser, phone or desktop</li>
            <li>White-label: your colours, logo and ads</li>
            <li>Embed in your site or app with one line</li>
          </ul>
          {STUDIO.contactEmail ? (
            <a className="site-cta" href={`mailto:${STUDIO.contactEmail}?subject=${subject}`}>Request a demo <span aria-hidden>→</span></a>
          ) : (
            <p className="detail-note">Ask us for a demo portal to play it.</p>
          )}
        </div>
      </section>
      {more.length > 0 && (
        <section className="site-section">
          <h2>More {game.genre.toLowerCase()} games</h2>
          <div className="site-grid">
            {more.map((g) => (
              <a key={g.id} className="site-card" href={`#/${g.id}`}>
                <img src={g.icon} alt="" loading="lazy" width={256} height={256} />
                <div><h3>{g.name}</h3><span className="site-genre">{g.genre}</span><p>{g.tagline}</p></div>
              </a>
            ))}
          </div>
        </section>
      )}
      <footer className="site-foot">{STUDIO.footer}</footer>
    </div>
  );
}
