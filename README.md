# MunchiesKK

Ordering, loyalty (Monsta Coins) and arcade web app for MunchiesKK, a burger shop in Kota Kinabalu, Sabah.
React 19 + Vite, Supabase database, hosted on Vercel at https://www.munchieskk.my.

- **Where things are:** [`docs/REPO_MAP.md`](docs/REPO_MAP.md)
- **Rules for developers and AI agents:** [`AGENTS.md`](AGENTS.md)
- **Loyalty rules:** [`docs/POINTS_SYSTEM.md`](docs/POINTS_SYSTEM.md)
- **For the content and marketing teams:** [`docs/CONTENT_TEAM_SYNC.md`](docs/CONTENT_TEAM_SYNC.md)

## Run it locally

```bash
npm ci
# create .env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (the public anon key only)
npm run dev
```

## Checks (all must pass before a change is merged)

```bash
npm run lint
npm run build
npm run test:db    # needs a local Postgres, see supabase/tests/run-db-tests.sh
npm run test:e2e   # browser tests, Playwright
```
