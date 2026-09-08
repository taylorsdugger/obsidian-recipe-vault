import { inArray } from "drizzle-orm";
import { Hono } from "hono";
import { parseRecipeSections } from "@recipe-vault/core/note/sections";
import { readFrontmatter } from "@recipe-vault/core/note/frontmatter";

import { db, schema } from "../db/client";
import { indexNote } from "../db/index-recipe";
import type { AppBindings } from "../env";
import { RECIPE_PREFIX } from "../vault-store";

/**
 * Notes *read* per request. Notes that haven't changed cost nothing - the
 * listing already carries their etag - so they don't count against this and a
 * sync with nothing to do finishes in one round trip.
 */
const BATCH = 25;

/** Ids per delete statement. D1 rejects a statement with too many of them. */
const DELETE_CHUNK = 50;

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"];

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

function extensionOf(key: string): string {
  const dot = key.lastIndexOf(".");
  return dot === -1 ? "" : key.slice(dot).toLowerCase();
}

/** What happened to one note. */
type Outcome = "added" | "updated" | "skipped";

/** Every `.md` under the prefix, with the etag the listing reports. */
async function listNotes(
  bucket: R2Bucket,
  prefix: string,
): Promise<{ key: string; etag: string }[]> {
  const notes: { key: string; etag: string }[] = [];
  let cursor: string | undefined;

  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const object of page.objects) {
      if (object.key.toLowerCase().endsWith(".md")) {
        notes.push({ key: object.key, etag: object.etag });
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return notes.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Filename to object key, for every image in the vault.
 *
 * Obsidian resolves `[[Photo.jpg]]` by filename wherever the file happens to
 * live, so a note can point at an image without naming its folder. Building
 * the index means one pass over the bucket instead of a search per photo.
 */
async function buildMediaIndex(bucket: R2Bucket): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  let cursor: string | undefined;

  do {
    const page = await bucket.list({ cursor, limit: 1000 });
    for (const object of page.objects) {
      if (!IMAGE_EXTENSIONS.includes(extensionOf(object.key))) continue;
      const name = object.key.slice(object.key.lastIndexOf("/") + 1);
      // First one wins; duplicate filenames in a vault are rare and either
      // copy is as good as the other.
      if (!index.has(name.toLowerCase())) index.set(name.toLowerCase(), object.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return index;
}

/**
 * Turn a vault-local photo path into a URL this app can serve. Tries the path
 * as written first, then falls back to matching on filename alone.
 */
function vaultPhotoUrl(
  photo: string,
  index: Map<string, string>,
): string | null {
  const name = photo.slice(photo.lastIndexOf("/") + 1).toLowerCase();
  const exact = [...index.values()].includes(photo) ? photo : null;
  const key = exact ?? index.get(name);
  return key ? `/api/vault/media/${key.split("/").map(encodeURIComponent).join("/")}` : null;
}

export const vaultRoutes = new Hono<AppBindings>()
  /** What's in the bucket, without writing anything. */
  .get("/list", async (c) => {
    const prefix = c.req.query("prefix") ?? RECIPE_PREFIX;
    const notes = await listNotes(c.env.VAULT, prefix);

    const imported = await db(c.env.DB)
      .select({ vaultKey: schema.recipes.vaultKey })
      .from(schema.recipes);
    const already = new Set(
      imported.map((row) => row.vaultKey).filter(Boolean) as string[],
    );

    return c.json({
      prefix,
      notes: notes.length,
      alreadyImported: notes.filter((n) => already.has(n.key)).length,
      sample: notes.slice(0, 20).map((n) => n.key),
    });
  })

  /** One object's text, for looking at what a note actually contains. */
  .get("/object", async (c) => {
    const key = c.req.query("key") ?? "";
    if (!key) return c.json({ error: "Pass ?key=" }, 400);

    const object = await c.env.VAULT.get(key);
    if (!object) return c.json({ error: "No such object." }, 404);

    return c.json({ key, size: object.size, text: await object.text() });
  })

  /**
   * Pull the vault into the app.
   *
   * R2 is the source of truth, so this only ever reads: notes are copied in
   * as they are, the index rows are rebuilt from them, and a recipe whose note
   * has gone is dropped. Anything the app changed is already in the vault,
   * because every write goes there first - so there is nothing to lose here.
   *
   * Works in batches. Pass back `nextOffset` until it comes back null.
   */
  .post("/import", async (c) => {
    const body = await c.req
      .json<{ offset?: unknown; dryRun?: unknown; prefix?: unknown }>()
      .catch(() => ({}) as Record<string, unknown>);

    const prefix = typeof body.prefix === "string" ? body.prefix : RECIPE_PREFIX;
    const offset = Number.isInteger(body.offset) ? (body.offset as number) : 0;
    const dryRun = body.dryRun === true;

    const notes = await listNotes(c.env.VAULT, prefix);
    const database = db(c.env.DB);

    let added = 0;
    let updated = 0;
    let skipped = 0;
    let unchanged = 0;
    const skippedNotes: { key: string; why: string }[] = [];

    // Only built when a note in this batch actually needs it.
    let mediaIndex: Map<string, string> | null = null;

    // What the index already holds, so notes that haven't moved are skipped
    // without reading them. On a scheduled sync that's nearly all of them.
    const indexed = new Map(
      (
        await database
          .select({
            vaultKey: schema.recipes.vaultKey,
            vaultEtag: schema.recipes.vaultEtag,
          })
          .from(schema.recipes)
      )
        .filter((row) => row.vaultKey)
        .map((row) => [row.vaultKey as string, row.vaultEtag]),
    );

    // Walk from `offset` until BATCH notes have actually been read, so a sync
    // where nothing moved gets through the whole vault in one go.
    let cursor = offset;
    let reads = 0;

    while (cursor < notes.length && reads < BATCH) {
      const { key, etag } = notes[cursor];
      cursor++;

      // The listing already told us the etag; an unchanged note needs no read.
      if (indexed.get(key) === etag) {
        unchanged++;
        continue;
      }
      reads++;

      const object = await c.env.VAULT.get(key);
      if (!object) {
        skipped++;
        skippedNotes.push({ key, why: "disappeared from the bucket mid-sync" });
        continue;
      }

      const markdown = await object.text();

      // A note with no Ingredients section isn't a recipe - the vault has a
      // few templates and stubs mixed in with the real ones.
      if (!parseRecipeSections(markdown)) {
        skipped++;
        skippedNotes.push({ key, why: "no Ingredients or Instructions section" });
        continue;
      }

      if (dryRun) {
        // Anything reaching here is new or changed; unchanged notes were
        // counted above without a read.
        if (indexed.has(key)) updated++;
        else added++;
        continue;
      }

      // A photo the plugin saved into the vault rather than hot-linked. The
      // file is in the bucket too, so serve it from there.
      let photoUrl: string | null = null;
      const frontmatter = readFrontmatter(markdown);
      if (frontmatter.photo && !frontmatter.photo.startsWith("http")) {
        mediaIndex ??= await buildMediaIndex(c.env.VAULT);
        photoUrl = vaultPhotoUrl(frontmatter.photo, mediaIndex);
      }

      const result = await indexNote(
        database,
        { key, markdown, etag: object.etag },
        photoUrl,
      );
      if (result.created) added++;
      else updated++;
    }

    const nextOffset = cursor;
    const done = nextOffset >= notes.length;

    // On the last batch, drop recipes whose note is no longer in the vault.
    let removed = 0;
    if (done && !dryRun) {
      const rows = await database
        .select({ id: schema.recipes.id, vaultKey: schema.recipes.vaultKey })
        .from(schema.recipes);
      const live = new Set(notes.map((n) => n.key));
      const gone = rows
        .filter((row) => row.vaultKey && !live.has(row.vaultKey))
        .map((row) => row.id);

      // D1 caps the bound parameters in one statement, so a first sync that
      // clears out a lot of rows has to go in chunks.
      for (let i = 0; i < gone.length; i += DELETE_CHUNK) {
        await database
          .delete(schema.recipes)
          .where(inArray(schema.recipes.id, gone.slice(i, i + DELETE_CHUNK)));
      }
      removed = gone.length;
    }

    return c.json({
      dryRun,
      total: notes.length,
      processed: nextOffset,
      nextOffset: done ? null : nextOffset,
      added,
      updated,
      unchanged,
      skipped,
      removed,
      skippedNotes,
    });
  });

/**
 * Stream a vault image out of the bucket. Behind the same cookie as everything
 * else - an `<img>` on the recipe screen is same-origin, so it carries it.
 */
vaultRoutes.get("/media/*", async (c) => {
  const key = decodeURIComponent(
    new URL(c.req.url).pathname.replace("/api/vault/media/", ""),
  );
  if (!key) return c.json({ error: "No key." }, 400);

  const object = await c.env.VAULT.get(key);
  if (!object) return c.json({ error: "No such image." }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": CONTENT_TYPES[extensionOf(key)] ?? "application/octet-stream",
      // The sync plugin writes a new file rather than editing one in place,
      // so a key that resolves today will hold the same bytes tomorrow.
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: object.httpEtag,
    },
  });
});
