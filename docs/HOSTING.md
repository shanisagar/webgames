# Hosting, domains, analytics and error tracking

Everything below is optional and switched off until you add the keys; the site keeps working on GitHub Pages.
Variables go in GitHub: repository **Settings → Secrets and variables → Actions** (Variables tab unless marked secret).
After adding any of them, re-run the **Deploy** workflow (Actions → Deploy → Run workflow).

## Cloudflare Pages (recommended main hosting)
GitHub Pages is not meant for commercial services; Cloudflare Pages is free, faster worldwide and supports a custom
domain per client.

1. Create a free account at https://dash.cloudflare.com.
2. **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"** template (it includes Pages). Copy the token.
3. Your **Account ID** is on the right side of the Workers & Pages overview page.
4. In GitHub add two **secrets**: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
   Optional variable `CLOUDFLARE_PROJECT` (default `webgames`).
5. Re-run Deploy. The site appears at `https://webgames.pages.dev` (the GitHub Pages copy keeps working too).

`public/_headers` gives Cloudflare long-lived caching for game files and none for pages, so updates show at once.

## Custom domains per client
1. In Supabase run `supabase/migrations/0002_client_domains.sql` (adds a `domains` list to each client).
2. Cloudflare → Workers & Pages → webgames → **Custom domains → Set up a domain**, e.g. `games.clientname.com`.
   The client adds the CNAME record Cloudflare shows them (or you do, if the domain is on your Cloudflare account).
3. In the admin panel, add `games.clientname.com` to that client's domains. Visiting the domain now opens their
   branded portal directly.

## Analytics (PostHog)
1. Sign up at https://posthog.com (EU or US cloud; free tier is generous). Create a project.
2. Copy the **Project API key** (starts with `phc_`) into the variable `VITE_POSTHOG_KEY`.
   For the US cloud also set `VITE_POSTHOG_HOST` = `https://us.i.posthog.com` (default is the EU cloud).
3. Events sent (no cookies, anonymous player id):
   `$pageview` (route), `game_open`, `game_start`, `game_end` (score, victory, stars, seconds), `game_revive`,
   `ad` (interstitial / rewarded, outcome). Every event carries `client` (portal slug or `studio`) and `platform`
   (`web`, `installed`, `embed`, `android`, `ios`), so you can report per client and per game.

## Error tracking (Sentry)
1. Sign up at https://sentry.io, create a **Browser JavaScript** project, copy its **DSN**.
2. Put it in the variable `VITE_SENTRY_DSN`. Crashes from real players then show up in Sentry, tagged with the game,
   platform and release (commit). The Sentry code only downloads when a DSN is set.

## Offline play
The site installs a service worker (`public/sw.js`): the lobby and every game a player has opened before keep
working without a connection, and repeat visits start instantly. New deploys are picked up on the next page load.

## Private dev preview (Cloudflare Access)

The dev preview (the `dev` branch) is built on every deploy. Without Cloudflare it is published at `<site>/dev/`
behind the admin login screen, but its files stay public. With Cloudflare it moves to its own Pages project and can
be made truly private:

1. Add the repository secrets `CLOUDFLARE_API_TOKEN` (token with **Cloudflare Pages: Edit**) and
   `CLOUDFLARE_ACCOUNT_ID`. The next deploy publishes the dev preview to the Pages project `webgames-dev`
   (`https://webgames-dev.pages.dev`; set the repository variable `CLOUDFLARE_DEV_PROJECT` for another name) and stops
   publishing `/dev/` on GitHub Pages. The live site also deploys to the `webgames` project.
2. Cloudflare dashboard → **Zero Trust** (free up to 50 users) → **Access → Applications → Add an application →
   Self-hosted**: domain `webgames-dev.pages.dev`, policy **Allow** for your email addresses (login by one-time PIN
   e-mail). Add a second application for `*.webgames-dev.pages.dev` so preview links are covered too.
3. Optional: make the GitHub repository private. GitHub Pages on a private repository needs a paid GitHub plan; on the
   free plan, serve the live site from Cloudflare Pages instead (its address becomes `https://webgames.pages.dev` or
   your own domain), so update any links you have shared.
