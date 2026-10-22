# Embedding the games

Operators can put any game, or their whole branded portal, on their own site or app inside an `<iframe>`.
The live developer page with copy-paste snippets, a preview and an event log is at `#/embed-docs`.
The back office has an **Embed** tab for each client with ready-made snippets for that client's games.

## Addresses

| URL (after the site address, e.g. `https://<user>.github.io/webgames/`) | Shows |
| --- | --- |
| `#/embed/<game>?client=<slug>` | One game, full-bleed, with the client's theme, font and ads. No site header, no home or "all games" buttons. The client is required: without it, or if the client is switched off or doesn't have the game enabled, a short "not available" note shows instead. |
| `#/embed/portal/<slug>` | The client's whole portal. Games inside it go back to the embedded list. |
| `…?sound=0` / `…&sound=0` | Start muted. |

Query parameters go after `?` inside the hash. Game ids are the `id`s in `src/games.ts` (for example `slide2048`, `fruitfusion`).

## Plain iframe

```html
<iframe src="https://<user>.github.io/webgames/#/embed/slide2048?client=demo"
  title="Slide 2048" allow="autoplay; fullscreen; gamepad" allowfullscreen
  style="display:block;width:100%;height:min(80vh,720px);border:0"></iframe>
```

## SDK (`public/embed.js`, about 3 KB, no dependencies)

```html
<div id="webgame" style="width:100%;height:min(80vh,720px)"></div>
<script src="https://<user>.github.io/webgames/embed.js"></script>
<script>
  const game = WebGames.mount(document.getElementById("webgame"), {
    game: "slide2048",        // or portal: "demo"
    client: "demo",           // required: your client address (theme, ads and the games enabled for you)
    sound: true,              // false = start muted
    onEvent: (e) => console.log(e),
  });
  // game.pause(); game.resume(); game.mute(); game.unmute(); game.destroy(); game.iframe
</script>
```

Other options: `title` (the iframe's title), `height` (used only when the element has no height), and `base` (where the
games are hosted; the default is the folder `embed.js` was loaded from). Commands sent before the game page is up are
queued. Events are accepted only from the SDK's own iframe.

## Messages

Game to host, posted with `parent.postMessage(msg, "*")`:

```js
{ source: "webgames", version: 1, event: { type: "end", game: "slide2048", score: 1840, victory: false, stars: null, seconds: 74 } }
```

| `event.type` | Extra fields | When |
| --- | --- | --- |
| `loaded` | `view: "game" \| "portal"`, `game`, `client` | The embed page is up (once per iframe load). |
| `ready` | `game` | The game loaded and shows its title screen. |
| `start` | `game` | A round started. |
| `end` | `game`, `score` (number or null), `victory`, `stars` (0–3 or null), `seconds` | A round ended. |
| `revive` | `game` | The player continued after losing. |
| `pause` / `resume` | `game` | The round paused or resumed. |
| `ad` | `game`, `kind` (`interstitial` \| `rewarded`), `outcome` (`shown` \| `rewarded` \| `skipped` \| `unavailable`) | An ad break. |

Host to game:

```js
iframe.contentWindow.postMessage({ source: "webgames-host", command: "pause" }, "*"); // pause | resume | mute | unmute
```

The game only accepts commands from the page that embeds it (`event.source === window.parent`). `pause` has no effect
on title or result screens, or in Arrow Puzzle (no clock). `mute` silences every game without changing the player's
saved sound settings.

When you listen without the SDK, check `e.source === yourIframe.contentWindow` and `e.data.source === "webgames"`.

## Hosting and security

- The games must be frameable. GitHub Pages sends no `X-Frame-Options` and no CSP `frame-ancestors`, so any site can
  embed them. Do not add those headers (for example in `public/_headers` for Cloudflare Pages, or on a CDN) unless you
  want to restrict embedding to a list of operator domains (`Content-Security-Policy: frame-ancestors https://operator.example`).
- Operators with a Content Security Policy must allow the games' origin in `frame-src` (and `script-src` for `embed.js`).
- Saved progress lives in the player's browser for the games' origin. Browsers that partition or block third-party
  storage keep it per operator site, or only for the session.
- Ads inside an embed are the ones configured for the client in the back office.

## Code

- Routes: `src/App.tsx` (`#/embed/...`, `#/embed-docs`)
- Bare game: `src/platform/embed/EmbedGame.tsx`; embedded portal: `Portal` with `embedded` in `src/platform/Portal.tsx`
- postMessage bridge and mute: `src/platform/embed/bridge.ts`
- Snippets: `src/platform/embed/snippets.ts`; docs page: `EmbedDocs.tsx`; back office tab: `AdminEmbed.tsx`
- SDK: `public/embed.js`
