import { useEffect, useMemo, useRef, useState } from "react";
import { GAMES } from "../../games";
import { STUDIO } from "../Showcase";
import { embedUrl, iframeSnippet, sdkSnippet, siteBase, type EmbedTarget } from "./snippets";
import "./embed.css";

interface MountedGame { pause(): void; resume(): void; mute(): void; unmute(): void; destroy(): void }
interface WebGamesSdk { mount(el: HTMLElement, o: Record<string, unknown>): MountedGame }

/** Loads public/embed.js once (the same file operators use). */
let sdkPromise: Promise<WebGamesSdk> | null = null;
function loadSdk() {
  return (sdkPromise ??= new Promise<WebGamesSdk>((resolve, reject) => {
    const w = window as unknown as { WebGames?: WebGamesSdk };
    if (w.WebGames) { resolve(w.WebGames); return; }
    const s = document.createElement("script");
    s.src = `${siteBase()}embed.js`;
    s.onload = () => (w.WebGames ? resolve(w.WebGames) : reject(new Error("embed.js did not load")));
    s.onerror = () => { sdkPromise = null; reject(new Error("embed.js did not load")); };
    document.head.appendChild(s);
  }));
}

const EVENTS: [string, string, string][] = [
  ["loaded", "The embed page is up (sent once per iframe load, before the game). Commands sent earlier are queued by the SDK until this arrives.", `{ "type": "loaded", "view": "game", "game": "slide2048", "client": "demo" }`],
  ["ready", "The game finished loading and shows its title screen.", `{ "type": "ready", "game": "slide2048" }`],
  ["start", "A round started.", `{ "type": "start", "game": "slide2048" }`],
  ["end", "A round ended. score is the game's main number (points, level, or seconds for time-based games), or null. stars is 0–3 where the game has stars.", `{ "type": "end", "game": "slide2048", "score": 1840, "victory": false, "stars": null, "seconds": 74 }`],
  ["revive", "The player continued after losing (usually after a rewarded ad).", `{ "type": "revive", "game": "lumiloop" }`],
  ["pause", "The game paused (pause button, tab hidden, or your pause command).", `{ "type": "pause", "game": "slide2048" }`],
  ["resume", "The game resumed.", `{ "type": "resume", "game": "slide2048" }`],
  ["ad", "An ad break happened. kind: interstitial | rewarded; outcome: shown | rewarded | skipped | unavailable.", `{ "type": "ad", "game": "slide2048", "kind": "interstitial", "outcome": "shown" }`],
];

const COMMANDS: [string, string][] = [
  ["pause", "Pauses the current round and shows the game's pause menu. No effect on title or result screens, or on Arrow Puzzle (a puzzle without a clock)."],
  ["resume", "Resumes a paused round."],
  ["mute", "Silences all game audio. Does not change the player's own saved sound settings."],
  ["unmute", "Restores audio (respecting the player's own sound settings)."],
];

function Code({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ed-code">
      <div className="ed-code-bar">
        <span>{label}</span>
        <button onClick={() => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre><code>{text}</code></pre>
    </div>
  );
}

function Preview({ target, sound }: { target: EmbedTarget; sound: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const game = useRef<MountedGame | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setLog([]);
    loadSdk().then((sdk) => {
      if (!live || !box.current) return;
      game.current = sdk.mount(box.current, {
        game: target.game, portal: target.portal, client: target.client, title: target.title, sound,
        onEvent: (e: unknown) => setLog((l) => [JSON.stringify(e), ...l].slice(0, 40)),
      });
    }, (e: Error) => setError(e.message));
    return () => { live = false; game.current?.destroy(); game.current = null; };
  }, [target.game, target.portal, target.client, target.title, sound]);
  return (
    <div className="ed-preview">
      <div className="ed-stage" ref={box} />
      <div className="ed-console">
        <div className="ed-cmds">
          {(["pause", "resume", "mute", "unmute"] as const).map((c) => (
            <button key={c} onClick={() => game.current?.[c]()}>{c}()</button>
          ))}
        </div>
        <p className="ed-dim">onEvent log (newest first)</p>
        <ol className="ed-log" aria-live="polite">
          {error && <li className="ed-err">{error}</li>}
          {log.map((l, i) => <li key={log.length - i}>{l}</li>)}
          {!log.length && !error && <li className="ed-dim">Waiting for events… start a round in the preview.</li>}
        </ol>
      </div>
    </div>
  );
}

/** #/embed-docs: how operators put the games on their own sites. */
export default function EmbedDocs() {
  useEffect(() => { document.title = `Embed our games · ${STUDIO.name}`; }, []);
  const [gameId, setGameId] = useState("slide2048");
  const [client, setClientSlug] = useState("demo");
  const [sound, setSound] = useState(true);
  const [filter, setFilter] = useState("");
  const base = siteBase();
  const game = GAMES.find((g) => g.id === gameId) ?? GAMES[0];
  const slug = client.trim().toLowerCase();
  const target = useMemo<EmbedTarget>(() => ({ game: game.id, client: slug || undefined, title: game.name }), [game, slug]);
  const shown = GAMES.filter((g) => !filter || `${g.name} ${g.id} ${g.genre}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="ed">
      <header className="ed-head">
        <a href="#/" className="ed-brand">{STUDIO.name}</a>
        <span className="ed-dim">Developer docs</span>
      </header>
      <main className="ed-main">
        <section>
          <h1>Embed our games on your site</h1>
          <p className="ed-lead">
            Every game (and your whole branded games portal) runs inside an <code>&lt;iframe&gt;</code> on your page. Paste one of the
            snippets below, or use the 3 KB SDK to also receive game events (start, end and score) and to pause or mute the game from
            your page. Games fill whatever box you give them and adapt to portrait and landscape.
          </p>
        </section>

        <section>
          <h2>Try it</h2>
          <div className="ed-controls">
            <label>Game
              <select value={game.id} onChange={(e) => setGameId(e.target.value)}>
                {GAMES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            <label>Client address
              <input value={client} placeholder="e.g. demo" onChange={(e) => setClientSlug(e.target.value.replace(/[^a-z0-9-]/gi, ""))} />
            </label>
            <label className="ed-check"><input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /> Sound on start</label>
          </div>
          <Preview target={target} sound={sound} />
          <div className="ed-two">
            <Code label="SDK (events + commands)" text={sdkSnippet(target, base)} />
            <Code label="Plain iframe" text={iframeSnippet(target, base)} />
          </div>
        </section>

        <section>
          <h2>Addresses and options</h2>
          <table className="ed-table">
            <thead><tr><th>URL</th><th>Shows</th></tr></thead>
            <tbody>
              <tr><td><code>{base}#/embed/&lt;game&gt;</code></td><td>One game, full-bleed, with no site header and no "all games" button.</td></tr>
              <tr><td><code>…#/embed/&lt;game&gt;?client=&lt;address&gt;</code></td><td>The game in your colours, font and ads. Shows a short "not available" note if the game is switched off for you.</td></tr>
              <tr><td><code>…#/embed/portal/&lt;address&gt;</code></td><td>Your whole portal (game list and games). Games return to the embedded list.</td></tr>
              <tr><td><code>…&amp;sound=0</code></td><td>Start muted (SDK: <code>sound: false</code>). Unmute later with the <code>unmute</code> command.</td></tr>
            </tbody>
          </table>
          <h3>SDK: <code>WebGames.mount(element, options)</code></h3>
          <table className="ed-table">
            <thead><tr><th>Option</th><th>Meaning</th></tr></thead>
            <tbody>
              <tr><td><code>game</code> or <code>portal</code></td><td>A game id (see the list below) or your portal address.</td></tr>
              <tr><td><code>client</code></td><td>Required with <code>game</code>: your client address. Only games enabled for you play, with your theme and ads.</td></tr>
              <tr><td><code>sound</code></td><td><code>false</code> starts muted. Default <code>true</code>.</td></tr>
              <tr><td><code>onEvent(e)</code></td><td>Called with every game event (below).</td></tr>
              <tr><td><code>title</code>, <code>height</code></td><td>The iframe's accessible title; a height used only when your element has none (default <code>min(80vh, 720px)</code>).</td></tr>
              <tr><td><code>base</code></td><td>Where the games are hosted. Default: the folder <code>embed.js</code> was loaded from.</td></tr>
            </tbody>
          </table>
          <p>It returns <code>{"{ pause(), resume(), mute(), unmute(), destroy(), iframe }"}</code>.</p>
        </section>

        <section>
          <h2>Events (game → your page)</h2>
          <p>Without the SDK, listen yourself. Check that the message comes from your iframe:</p>
          <Code label="JavaScript" text={`window.addEventListener("message", (e) => {
  if (e.source !== myIframe.contentWindow || e.data?.source !== "webgames") return;
  const { version, event } = e.data; // version: 1
  if (event.type === "end") console.log("score", event.score);
});`} />
          <table className="ed-table">
            <thead><tr><th>type</th><th>When</th><th>Example <code>event</code></th></tr></thead>
            <tbody>
              {EVENTS.map(([t, when, ex]) => <tr key={t}><td><code>{t}</code></td><td>{when}</td><td><code className="ed-json">{ex}</code></td></tr>)}
            </tbody>
          </table>
        </section>

        <section>
          <h2>Commands (your page → game)</h2>
          <Code label="JavaScript" text={`myIframe.contentWindow.postMessage({ source: "webgames-host", command: "pause" }, "*");`} />
          <table className="ed-table">
            <thead><tr><th>command</th><th>Effect</th></tr></thead>
            <tbody>{COMMANDS.map(([c, d]) => <tr key={c}><td><code>{c}</code></td><td>{d}</td></tr>)}</tbody>
          </table>
        </section>

        <section>
          <h2>All games</h2>
          <input className="ed-filter" type="search" placeholder="Filter games" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul className="ed-games">
            {shown.map((g) => {
              const t = { game: g.id, client: slug || undefined, title: g.name };
              return (
                <li key={g.id}>
                  <img src={g.icon} alt="" width={44} height={44} loading="lazy" />
                  <span><b>{g.name}</b><code>{g.id}</code></span>
                  <a href={embedUrl(t, base)} target="_blank" rel="noreferrer">Open</a>
                  <button onClick={() => { setGameId(g.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Preview</button>
                  <CopyButton text={iframeSnippet(t, base)} label="iframe" />
                  <CopyButton text={sdkSnippet(t, base)} label="SDK" />
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h2>Hosting notes</h2>
          <ul className="ed-notes">
            <li>The games may be framed by any site: we send no <code>X-Frame-Options</code> and no <code>frame-ancestors</code> policy (GitHub Pages sends neither). If you mirror the files on your own server or CDN, don't add those headers either.</li>
            <li>Keep <code>allow="autoplay; fullscreen"</code> on the iframe. Browsers start sound only after the player's first tap inside the game.</li>
            <li>If your page has a Content Security Policy, allow our address in <code>frame-src</code> (and <code>script-src</code> for the SDK).</li>
            <li>Saved progress and settings live in the player's browser, per game site. Browsers that block third-party storage keep them for the session only.</li>
            <li>Ads shown inside the game are the ones configured for your client address.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>
      {done ? "Copied" : `Copy ${label}`}
    </button>
  );
}
