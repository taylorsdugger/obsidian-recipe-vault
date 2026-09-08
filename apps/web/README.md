# @recipe-vault/web

The household web app. One Cloudflare Worker serves everything: Hono handles
`/api/*`, Workers static assets serve the Vite build from `dist/`, and D1 is
the database. See `docs/web-app-plan.md` step 2 for what goes where.

This is scaffolding. Login works, the shell and the tab bar work, and
`/api/import/preview` really parses a URL. Every other route answers 501.

## Running it

Auth is on, so you need the two secrets before the app will let you in:

```
npm run hash-password -w @recipe-vault/web
```

That prompts for a password and prints an `AUTH_PASSWORD_HASH` and an
`AUTH_COOKIE_SECRET`. Put both in `apps/web/.dev.vars`, which is gitignored and
only used locally. `.dev.vars.example` shows the shape.

```
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
3. `wrangler secret put AUTH_PASSWORD_HASH` and `wrangler secret put
   AUTH_COOKIE_SECRET`. The deployed worker's secrets are separate from
   `.dev.vars`, so they can be a different password if you want.
4. `npm run deploy -w @recipe-vault/web`.

Rotating `AUTH_COOKIE_SECRET` signs every device out. That's the recovery move
if a phone goes missing.

Nothing here touches the plugin or the GitHub Pages site in `docs/`.
