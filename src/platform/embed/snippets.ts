/** Copy-paste embed snippets, shared by the docs page and the back office. */

/** Where this site is served from, e.g. "https://studio.github.io/webgames/". */
export const siteBase = () => new URL("./", location.href.split("#")[0]).href;

export interface EmbedTarget {
  game?: string;
  portal?: string;
  client?: string;
  title: string;
}

export function embedUrl(t: EmbedTarget, base = siteBase()) {
  if (t.portal) return `${base}#/embed/portal/${t.portal}`;
  return `${base}#/embed/${t.game}${t.client ? `?client=${t.client}` : ""}`;
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function iframeSnippet(t: EmbedTarget, base = siteBase()) {
  return `<iframe src="${attr(embedUrl(t, base))}"
  title="${attr(t.title)}" allow="autoplay; fullscreen; gamepad" allowfullscreen
  style="display:block;width:100%;height:min(80vh,720px);border:0"></iframe>`;
}

export function sdkSnippet(t: EmbedTarget, base = siteBase()) {
  const target = t.portal ? `portal: "${t.portal}"` : `game: "${t.game}"${t.client ? `, client: "${t.client}"` : ""}`;
  return `<div id="webgame" style="width:100%;height:min(80vh,720px)"></div>
<script src="${base}embed.js"></script>
<script>
  const game = WebGames.mount(document.getElementById("webgame"), {
    ${target},
    title: "${t.title.replace(/"/g, '\\"')}",
    onEvent: (e) => console.log("webgames", e), // ready, start, end { score }, pause, ...
  });
  // game.pause(); game.resume(); game.mute(); game.unmute(); game.destroy();
</script>`;
}
