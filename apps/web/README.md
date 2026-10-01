# @recipe-vault/web

The household web app. One Cloudflare Worker serves everything: Hono handles
`/api/*`, Workers static assets serve the Vite build from `dist/`, and D1 is
the database. See `docs/web-app-plan.md` step 2 for what goes where.

It has recipes (browse, search, cook from, edit, mark made), the week plan,
the shopping list, and URL import. Recipes and the shopping list live in the
synced Obsidian vault, so the app and Obsidian share them.

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
together. For client hot reload, run `vite` separately. It proxies `/api` to
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

## Deploying a new migration

When a change adds a file to `migrations/`, run it before deploying:

```
npm run db:migrate -w @recipe-vault/web
```

`0005_settings.sql` is the latest. It adds the `settings` table that holds the
"Save new recipes as" choice. Until it runs, imports keep saving markdown.

## The vault is the source of truth

The Obsidian vault syncs to the `obsidian` R2 bucket, and the recipes under
`Recipes/All recipes/` are already in this app's format: markdown notes from
the plugin's template, and Cooklang `.cook` files. R2 holds the recipes; D1 is
an index of them that can be thrown away and rebuilt. The `markdown` column
holds whichever the file is, as written, and the key's extension says which.

Every change the app makes to a recipe is written to the note first, then the
index row is rebuilt from what landed:

- **Mark made** rewrites `times_made` and `last_made` in the frontmatter, or
  `times made` and `last made` in a `.cook` file.
- **Edit** saves the text you typed.
- **Delete** deletes the file.
- **Importing a URL** writes a new file under `Recipes/All recipes/`, so it
  turns up in Obsidian like any other recipe. It's a note or a `.cook` file
  depending on "Save new recipes as" on the Import screen. That choice is
  stored in D1 for every device, and it's separate from the plugin's own
  setting.

Remotely Save syncs both directions, so a note written here reaches Obsidian on
its next run, and a note edited in Obsidian reaches the app on the next sync
from the Import screen. Neither is instant.

A write is conditional on the note's R2 etag matching what the app last read.
If Obsidian changed the note in between, the write is refused with a 409 and
the app says to sync first - it never overwrites a change it hasn't seen.

Syncing only reads. It copies notes in, rebuilds the index, and drops recipes
whose note has gone. Nothing the app did can be lost by running it, because
everything the app did is already in the vault.

Nothing pushes from R2 - no cron, no queue, nothing billable. The app syncs
itself when it opens and when it comes back to the foreground, throttled to
once every two minutes. A sync with nothing to do is one request and under a
second: the bucket listing carries each note's etag, so a note matching the
index is skipped without being read. The "Sync now" button on the Import
screen is the fallback for when you've just saved something in Obsidian and
don't want to wait for the app to notice.

That leaves Remotely Save's own schedule as the only real delay in either
direction, which is why a push from R2 wouldn't buy much.

A note whose photo is a vault-local `[[image.jpg]]` gets served out of the same
bucket through `/api/vault/media/…`, resolved by filename the way Obsidian
resolves a wikilink. A `.cook` file's photo is the vault path in its `image:`
front matter, or failing that the image next to it with the same name
(`Leek Soup.jpg` for `Leek Soup.cook`), served the same way. Those
files are full-size camera photos, a few MB each.

A `.cook` file next to a note of the same name is the plugin's Cooklang export
of that note, so sync skips it and only the note gets a row.

The recipe screen shows a `.cook` file's steps as plain text. The ingredient,
cookware and timer highlighting the plugin's Cooklang view has isn't here yet.

The shopping list is the vault's `Shopping List.md`, edited a line at a time
(`src/worker/shopping-store.ts`). The week plan lives only in D1 and has no
vault representation yet.

`wrangler dev` reads the real bucket while D1 stays local, so a sync can be
tried out without touching deployed data. That only works with plain `wrangler
dev`. `--local` turns off remote bindings. Careful with the write paths in that
mode: they go to the real bucket. To exercise writes, run `--local` and seed
the local bucket with `wrangler r2 object put … --local` instead (note that the
CLI can't handle a key with spaces in it).

## Icons

`npm run icons -w @recipe-vault/web` redraws everything in `public/` from
`scripts/make-icons.mjs`. The shapes are signed distance fields and the PNG is
written by hand, so there's no image dependency and no binary source file to
keep in sync. Output is deterministic: a run with no edits changes nothing.

Nothing here touches the plugin or the GitHub Pages site in `docs/`.
