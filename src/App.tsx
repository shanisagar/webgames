import { Suspense, useEffect, useState } from "react";
import { GAMES } from "./games";

const currentId = () => decodeURIComponent(location.hash.replace(/^#\/?/, ""));

/** Hash routing (#/arrowpuzzle) so every game has its own link and GitHub Pages needs no server rewrites. */
export default function App() {
  const [id, setId] = useState(currentId);
  useEffect(() => {
    const onHash = () => setId(currentId());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const game = GAMES.find((g) => g.id === id);
  if (game) {
    const Game = game.component;
    return (
      <Suspense fallback={<div className="loading">Loading {game.name}…</div>}>
        <Game />
      </Suspense>
    );
  }
  return <Catalog />;
}

function Catalog() {
  useEffect(() => { document.title = "Games by Shani Sagar"; }, []);
  return (
    <main className="catalog">
      <header>
        <h1>Games by <span>Shani Sagar</span></h1>
        <p>Browser-native versions: small, fast to load, built with React and Phaser.</p>
      </header>
      <div className="catalog-grid">
        {GAMES.map((g) => (
          <a key={g.id} className="catalog-card" href={`#/${g.id}`}>
            <img src={g.image} alt={`${g.name} feature graphic`} width={1024} height={500} />
            <div className="catalog-body">
              <span className="catalog-genre">{g.genre} · {g.tagline}</span>
              <h2>{g.name}</h2>
              <p>{g.description}</p>
              <span className="catalog-play">Play now →</span>
            </div>
          </a>
        ))}
      </div>
    </main>
  );
}
