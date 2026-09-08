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

1. `npx wrangler login`, if you haven't on this machine.
2. `npx wrangler d1 create recipe-vault` from `apps/web`, and put the id it
   prints into `wrangler.toml` where it says `REPLACE_ME`.
3. `npm run db:migrate -w @recipe-vault/web` to create the tables remotely.
4. `npm run deploy -w @recipe-vault/web`. Do this before the secrets: they
   attach to a Worker that has to exist first, and `wrangler secret put` on a
   Worker that was never deployed just tells you to deploy it.
5. `npm run secret:password -w @recipe-vault/web` and `npm run secret:cookie
   -w @recipe-vault/web`. The deployed worker's secrets are separate from
   `.dev.vars`, so they can be a different password if you want.

Between 4 and 5 the app is up but every login throws, because
`AUTH_PASSWORD_HASH` isn't set yet. Secrets take effect on their own, so
there's no need to redeploy after step 5.

Rotating `AUTH_COOKIE_SECRET` signs every device out. That's the recovery move
if a phone goes missing.

Every `wrangler` command reads `wrangler.toml`, which lives here in
`apps/web`. Run them from this directory, or use the `-w @recipe-vault/web`
scripts above from anywhere in the repo. Running bare `npx wrangler …` at the
repo root fails with "Required Worker name missing" because there's no config
up there to find.

## Icons

`npm run icons -w @recipe-vault/web` redraws everything in `public/` from
`scripts/make-icons.mjs`. The shapes are signed distance fields and the PNG is
written by hand, so there's no image dependency and no binary source file to
keep in sync. Output is deterministic: a run with no edits changes nothing.

Nothing here touches the plugin or the GitHub Pages site in `docs/`.
