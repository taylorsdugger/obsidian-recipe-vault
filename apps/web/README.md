# @recipe-vault/web

The household web app. One Cloudflare Worker serves everything: Hono handles
`/api/*`, Workers static assets serve the Vite build from `dist/`, and D1 is
the database. See `docs/web-app-plan.md` step 2 for what goes where.

This is scaffolding. Login works, the shell and the tab bar work, and
`/api/import/preview` really parses a URL. Every other route answers 501.

## Running it

```
cp .dev.vars.example .dev.vars     # set a passcode
npm run build -w @recipe-vault/web # wrangler serves dist/, so build first
npm run db:migrate:local -w @recipe-vault/web
npm run dev -w @recipe-vault/web   # http://localhost:8787
```

`npm run dev` is `wrangler dev`, which runs the Worker and the built client
together. For client hot reload, run `vite` separately — it proxies `/api` to
port 8787.

Check the parser still runs on workerd:

```
curl http://localhost:8787/api/health
```

`{"ok":true,"parser":true}` means cheerio loaded under `nodejs_compat` and
parsed a fixture. That was the one real unknown in the plan (2a) and it holds.

## Before the first deploy

1. `wrangler d1 create recipe-vault`, put the id in `wrangler.toml`.
2. `npm run db:migrate -w @recipe-vault/web`.
3. `wrangler secret put HOUSEHOLD_PASSCODE` and `wrangler secret put
   HOUSEHOLD_SECRET`.
4. `npm run deploy -w @recipe-vault/web`.

Nothing here touches the plugin or the GitHub Pages site in `docs/`.
