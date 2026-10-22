# Back office setup (Supabase)

The admin panel (`#/admin`) and the client portals (`#/c/<client>`) read their data from Supabase.
Until it is connected, the site runs in **local demo mode**: the admin panel works, but its clients are kept only in
your own browser.

## 1. Create the project
1. Sign in at https://supabase.com and create a project (the free tier is enough).
2. Open **SQL Editor**, paste all of [`migrations/0001_platform.sql`](migrations/0001_platform.sql) and run it.

## 2. Create your admin login
1. **Authentication → Users → Add user**: enter your email and a password and tick *Auto confirm*.
2. In the **SQL Editor**, run (replace the email):
   ```sql
   insert into admins (user_id, email)
   select id, email from auth.users where email = 'you@example.com';
   ```
3. Optional: under **Authentication → Providers → Email**, switch off *Allow new users to sign up*, so nobody else can
   create an account. Accounts that are not in `admins` can't change anything anyway.

## 3. Connect the site
**Project Settings → API** shows the *Project URL* and the *anon public* key. The anon key is meant to be public:
row-level security only lets it read live clients and their enabled games.

- GitHub: repository **Settings → Secrets and variables → Actions → Variables**, add `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY`, then re-run the *Deploy to GitHub Pages* workflow.
- Local development: put the same two lines in `.env.local` (`VITE_SUPABASE_URL=...`).

## Using it
- `#/admin`: sign in, create a client, choose its portal address, colours, font, logo, ads and games.
- Each client's players open `https://<site>/#/c/<address>`. Switching a game off removes it from that portal at once.
- New games added to the platform appear in every client's list switched **off**, so operators opt in.

## Tables
| table | contents |
|---|---|
| `clients` | slug (portal address), name, active, `theme`, `ads` and `site` JSON |
| `client_games` | one row per client and game: `enabled`, `sort` |
| `admins` | back-office users (auth user ids) |

`portal_config(slug)` returns everything a portal needs in one call.
