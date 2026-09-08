import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { parseRecipeSections } from "@recipe-vault/core/note/sections";
import { readFrontmatter } from "@recipe-vault/core/note/frontmatter";
import { nanoid } from "nanoid";

import { db, schema } from "../db/client";
import { deriveRecipeFields } from "../db/recipe-row";
import type { AppBindings } from "../env";

/** Where the sync plugin puts the recipe notes. */
export const RECIPE_PREFIX = "Recipes/All recipes/";

/** Notes per request. Small enough to stay well inside a Worker's budget. */
const BATCH = 25;

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

/** List every `.md` key under the prefix, in bucket order. */
async function listNotes(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const object of page.objects) {
      if (object.key.toLowerCase().endsWith(".md")) keys.push(object.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return keys.sort();
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

/** Whole numbers only; the vault writes `times_made: 2`. */
function counter(value: string | undefined): number {
  const n = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** `last_made: 2026-07-16`, or nothing. */
function isoDate(value: string | undefined): string | null {
  const raw = (value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
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
      alreadyImported: notes.filter((key) => already.has(key)).length,
      sample: notes.slice(0, 20),
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
   * Copy notes from the vault into the app.
   *
   * The vault's notes are already in the template's shape, so there is nothing
   * to parse: the markdown goes in as-is and the columns are derived from it,
   * exactly as they are for a URL import. `times_made` and `last_made` come
   * across too, because that history is real and the app can't recreate it.
   *
   * Works in batches. Pass back `nextOffset` until it comes back null. Pass
   * `dryRun` to see what would happen without writing.
   */
  .post("/import", async (c) => {
    const body = await c.req
      .json<{ offset?: unknown; dryRun?: unknown; prefix?: unknown }>()
      .catch(() => ({}) as Record<string, unknown>);

    const prefix = typeof body.prefix === "string" ? body.prefix : RECIPE_PREFIX;
    const offset = Number.isInteger(body.offset) ? (body.offset as number) : 0;
    const dryRun = body.dryRun === true;

    const keys = await listNotes(c.env.VAULT, prefix);
    const batch = keys.slice(offset, offset + BATCH);
    const database = db(c.env.DB);

    // Only built when a note in this batch actually needs it.
    let mediaIndex: Map<string, string> | null = null;

    const counts: Record<Outcome, number> = {
      added: 0,
      updated: 0,
      skipped: 0,
    };
    const skipped: { key: string; why: string }[] = [];

    for (const key of batch) {
      const object = await c.env.VAULT.get(key);
      if (!object) {
        counts.skipped++;
        skipped.push({ key, why: "disappeared from the bucket mid-import" });
        continue;
      }

      const markdown = await object.text();

      // A note with no Ingredients section isn't a recipe - the vault has a
      // few templates and stubs mixed in with the real ones.
      if (!parseRecipeSections(markdown)) {
        counts.skipped++;
        skipped.push({ key, why: "no Ingredients or Instructions section" });
        continue;
      }

      const frontmatter = readFrontmatter(markdown);
      const derived = deriveRecipeFields(markdown);
      const now = new Date().toISOString();

      // A photo the plugin saved into the vault rather than hot-linked. The
      // file is in the bucket too, so serve it from there.
      if (!derived.photoUrl && frontmatter.photo) {
        mediaIndex ??= await buildMediaIndex(c.env.VAULT);
        derived.photoUrl = vaultPhotoUrl(frontmatter.photo, mediaIndex);
      }

      const [existing] = await database
        .select({ id: schema.recipes.id })
        .from(schema.recipes)
        .where(eq(schema.recipes.vaultKey, key))
        .limit(1);

      if (dryRun) {
        counts[existing ? "updated" : "added"]++;
        continue;
      }

      const values = {
        markdown,
        ...derived,
        timesMade: counter(frontmatter.times_made),
        lastMade: isoDate(frontmatter.last_made),
        updatedAt: now,
      };

      if (existing) {
        await database
          .update(schema.recipes)
          .set(values)
          .where(eq(schema.recipes.id, existing.id));
        counts.updated++;
      } else {
        await database.insert(schema.recipes).values({
          id: nanoid(12),
          vaultKey: key,
          // `date_added` is when the note was written, which is a better
          // created date than "just now".
          createdAt: frontmatter.date_added || now,
          ...values,
        });
        counts.added++;
      }
    }

    const nextOffset = offset + batch.length;
    return c.json({
      dryRun,
      total: keys.length,
      processed: nextOffset,
      nextOffset: nextOffset < keys.length ? nextOffset : null,
      ...counts,
      skipped,
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
