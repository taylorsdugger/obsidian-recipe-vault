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

## The vault is the source of truth

The Obsidian vault syncs to the `obsidian` R2 bucket, and the recipe notes
under `Recipes/All recipes/` are already in this app's format. R2 holds the
recipes; D1 is an index of them that can be thrown away and rebuilt.

Every change the app makes to a recipe is written to the note first, then the
index row is rebuilt from what landed:

- **Mark made** rewrites `times_made` and `last_made` in the frontmatter.
- **Edit** saves the markdown you typed.
- **Delete** deletes the note.
- **Importing a URL** writes a new note under `Recipes/All recipes/`, so it
  turns up in Obsidian like any other recipe.

Remotely Save syncs both directions, so a note written here reaches Obsidian on
its next run, and a note edited in Obsidian reaches the app on the next sync
from the Import screen. Neither is instant.

A write is conditional on the note's R2 etag matching what the app last read.
If Obsidian changed the note in between, the write is refused with a 409 and
the app says to sync first - it never overwrites a change it hasn't seen.

Syncing only reads. It copies notes in, rebuilds the index, and drops recipes
whose note has gone. Nothing the app did can be lost by running it, because
everything the app did is already in the vault.

A note whose photo is a vault-local `[[image.jpg]]` gets served out of the same
bucket through `/api/vault/media/…`, resolved by filename the way Obsidian
resolves a wikilink. Those files are full-size camera photos, a few MB each.

The week plan and the shopping list live only in D1. They have no vault
representation yet.

`wrangler dev` reads the real bucket while D1 stays local, so a sync can be
tried out without touching deployed data. That only works with plain `wrangler
dev` - `--local` disables remote bindings. Careful with the write paths in that
mode: they go to the real bucket. To exercise writes, run `--local` and seed
the local bucket with `wrangler r2 object put … --local` instead (note that the
CLI can't handle a key with spaces in it).

## Icons

`npm run icons -w @recipe-vault/web` redraws everything in `public/` from
`scripts/make-icons.mjs`. The shapes are signed distance fields and the PNG is
written by hand, so there's no image dependency and no binary source file to
keep in sync. Output is deterministic: a run with no edits changes nothing.

Nothing here touches the plugin or the GitHub Pages site in `docs/`.
