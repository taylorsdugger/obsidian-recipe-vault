import type { Env } from "./env";

/**
 * Reading and writing recipe notes in the synced vault.
 *
 * R2 is the source of truth: every change the app makes to a recipe is written
 * here first, and the D1 row is an index rebuilt from what lands. Remotely Save
 * syncs both ways, so a note written here shows up in Obsidian on its next run.
 */

/** Where the sync plugin keeps the recipe notes. */
export const RECIPE_PREFIX = "Recipes/All recipes/";

/** Thrown when a note changed in the vault since the app last read it. */
export class VaultConflict extends Error {
  constructor(readonly key: string) {
    super(
      "That recipe changed in the vault since this page loaded. " +
        "Sync from the vault and try again.",
    );
    this.name = "VaultConflict";
  }
}

export interface VaultNote {
  key: string;
  markdown: string;
  etag: string;
}

/** Read one note. Null when it isn't there any more. */
export async function readNote(
  env: Env,
  key: string,
): Promise<VaultNote | null> {
  const object = await env.VAULT.get(key);
  if (!object) return null;
  return { key, markdown: await object.text(), etag: object.etag };
}

/**
 * Write a note, but only if it still looks the way the app last saw it.
 *
 * `expectedEtag` null means "this must be a new file". R2's conditional put
 * does the check atomically; a null return from `put` means the condition
 * failed, which is the concurrent-edit case.
 */
export async function writeNote(
  env: Env,
  key: string,
  markdown: string,
  expectedEtag: string | null,
): Promise<string> {
  const written = await env.VAULT.put(key, markdown, {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    // No etag means the app believes nothing is there yet, which is the
    // `If-None-Match: *` case - the write fails if a file appeared meanwhile.
    onlyIf: expectedEtag
      ? { etagMatches: expectedEtag }
      : { etagDoesNotMatch: "*" },
  });

  if (!written) throw new VaultConflict(key);
  return written.etag;
}

/** Delete a note. Deleting something already gone is not an error. */
export async function deleteNote(env: Env, key: string): Promise<void> {
  await env.VAULT.delete(key);
}

/** Obsidian rejects these in a filename; the plugin strips them too. */
function safeFilename(title: string): string {
  return title.replace(/["*\\/<>:?|]/g, "").trim() || "Untitled recipe";
}

/**
 * A free key for a new note, named after the recipe the way the plugin names
 * its files. Falls back to " (2)", " (3)" when the name is taken, rather than
 * overwriting somebody's note.
 */
export async function freeKeyFor(env: Env, title: string): Promise<string> {
  const base = safeFilename(title);

  for (let n = 1; n < 50; n++) {
    const key = `${RECIPE_PREFIX}${base}${n === 1 ? "" : ` (${n})`}.md`;
    const head = await env.VAULT.head(key);
    if (!head) return key;
  }

  // Fifty notes with the same name is not a real case; make it unmistakable.
  return `${RECIPE_PREFIX}${base} (${Date.now()}).md`;
}
