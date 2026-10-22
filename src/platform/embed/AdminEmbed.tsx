import { useState } from "react";
import { GAMES, type GameEntry } from "../../games";
import { SLUG_RE, toConfig, type ClientRecord } from "../store";
import { embedUrl, iframeSnippet, sdkSnippet, siteBase, type EmbedTarget } from "./snippets";

/** Back office: ready-to-copy embed snippets for one client's portal and enabled games (saved state). */
export function EmbedTab({ saved }: { saved: ClientRecord }) {
  const [kind, setKind] = useState<"iframe" | "sdk">("iframe");
  const [status, setStatus] = useState("");
  if (!saved.id || !SLUG_RE.test(saved.slug)) return <p className="adm-dim">Save the client first: embed codes use its address.</p>;

  const base = siteBase();
  const ids = toConfig(saved).games ?? GAMES.map((g) => g.id);
  const games = ids.map((id) => GAMES.find((g) => g.id === id)).filter((g): g is GameEntry => !!g);
  const snippet = (t: EmbedTarget) => (kind === "iframe" ? iframeSnippet(t, base) : sdkSnippet(t, base));
  const copy = (text: string, what: string) => navigator.clipboard?.writeText(text).then(() => setStatus(`Copied: ${what}`));
  const portal: EmbedTarget = { portal: saved.slug, title: saved.name };

  return (
    <div className="adm-embed">
      {!saved.active && <p className="adm-error">This portal is switched off: embedded games show "not available" until it is live again.</p>}
      <p className="adm-dim">
        Send these to {saved.name}'s developers. They paste a snippet into any page of their site; the games use this client's theme
        and ads. Full guide with events and commands: <a href="#/embed-docs" target="_blank" rel="noreferrer">{base}#/embed-docs</a>
      </p>
      <div className="adm-games-tools">
        <span className="adm-seg">
          <button className={kind === "iframe" ? "on" : ""} onClick={() => setKind("iframe")}>iframe</button>
          <button className={kind === "sdk" ? "on" : ""} onClick={() => setKind("sdk")}>SDK (with events)</button>
        </span>
        {status && <span className="adm-status">{status}</span>}
      </div>

      <h3>Whole portal</h3>
      <div className="adm-snippet">
        <div className="adm-snippet-bar">
          <a href={embedUrl(portal, base)} target="_blank" rel="noreferrer">{embedUrl(portal, base)}</a>
          <button onClick={() => copy(snippet(portal), "portal")}>Copy</button>
        </div>
        <pre><code>{snippet(portal)}</code></pre>
      </div>

      <h3>Single games ({games.length})</h3>
      {games.length === 0 && <p className="adm-dim">No games are enabled for this client.</p>}
      <ul className="adm-games">
        {games.map((g) => {
          const t: EmbedTarget = { game: g.id, client: saved.slug, title: g.name };
          return (
            <li key={g.id}>
              <img src={g.icon} alt="" width={44} height={44} loading="lazy" />
              <span><b>{g.name}</b><small><a href={embedUrl(t, base)} target="_blank" rel="noreferrer">{embedUrl(t, base)}</a></small></span>
              <button onClick={() => copy(snippet(t), g.name)}>Copy {kind === "iframe" ? "iframe" : "SDK"}</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
