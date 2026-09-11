import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { readFrontmatter } from "@recipe-vault/core/note/frontmatter";

import { type Db, schema } from "./client";
import { deriveRecipeFields } from "./recipe-row";

/**
 * Write one note's index row. The vault holds the truth; this is the copy the
 * UI searches and sorts, so it is always derived from the markdown that just
 * landed in R2 and never edited on its own.
 */
export async function indexNote(
  db: Db,
  note: { key: string; markdown: string; etag: string },
  photoUrl?: string | null,
): Promise<{ id: string; created: boolean }> {
  const frontmatter = readFrontmatter(note.markdown);
  const derived = deriveRecipeFields(note.markdown);
  if (photoUrl !== undefined && !derived.photoUrl) derived.photoUrl = photoUrl;

  const now = new Date().toISOString();
  const values = {
    markdown: note.markdown,
    ...derived,
    // The note carries the history; the app is not its owner.
    timesMade: counter(frontmatter.times_made),
    lastMade: isoDate(frontmatter.last_made),
    vaultEtag: note.etag,
    updatedAt: now,
  };

  const [existing] = await db
    .select({ id: schema.recipes.id })
    .from(schema.recipes)
    .where(eq(schema.recipes.vaultKey, note.key))
    .limit(1);

  if (existing) {
    await db
      .update(schema.recipes)
      .set(values)
      .where(eq(schema.recipes.id, existing.id));
    return { id: existing.id, created: false };
  }

  const id = nanoid(12);
  await db.insert(schema.recipes).values({
    id,
    vaultKey: note.key,
    // `date_added` is when the note was written, a better created date than now.
    createdAt: frontmatter.date_added || now,
    ...values,
  });
  return { id, created: true };
}

/** Whole numbers only; the vault writes `times_made: 2`. */
export function counter(value: string | undefined): number {
  const n = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** `last_made: 2026-07-16`, or nothing. */
export function isoDate(value: string | undefined): string | null {
  const raw = (value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}
