/**
 * "Add to Home screen" / "Install app" opens the manifest's start_url. The static manifest starts at the studio page;
 * on a game or client portal we swap in one that starts at that exact page, named after it.
 */
export function updateManifest(name: string, shortName: string) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) return;
  const base = new URL("./", location.href).href;
  if (!location.hash || location.hash === "#/") {
    link.href = "./manifest.webmanifest";
    return;
  }
  const m = {
    name,
    short_name: shortName.slice(0, 12),
    start_url: location.href,
    scope: base,
    id: location.href,
    display: "standalone",
    orientation: "any",
    background_color: "#0b0d17",
    theme_color: "#0b0d17",
    icons: [
      { src: base + "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: base + "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: base + "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  link.href = "data:application/manifest+json," + encodeURIComponent(JSON.stringify(m));
}
