/**
 * Tag helpers for the recipe gallery's tag filter and tag-based sorting.
 * Pure functions over plain data so they can be unit tested without Obsidian.
 *
 * Tags follow Obsidian's rules: case-insensitive, a leading `#` is optional,
 * and a parent tag matches its nested tags (`cuisine` matches `cuisine/thai`).
 */

export type TagMatchMode = "all" | "any";

export interface TagCount {
  /** Full tag, lower-cased, without `#` (e.g. `cuisine/thai`). */
  tag: string;
  /** What the chip shows: the tag minus its namespace (e.g. `thai`). */
  label: string;
  /** Recipes the chip would match given the rest of the current filter. */
  count: number;
}

export interface TagGroup {
  /** First path segment of nested tags, or "" for plain tags. */
  namespace: string;
  tags: TagCount[];
}

/** Normalize one tag: trim, drop a leading `#`, lower-case, trim slashes. */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, "")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}

/**
 * Tags from a frontmatter `tags` (or `tag`) value. Accepts a YAML list, or a
 * string separated by commas and/or spaces, the two forms Obsidian reads.
 */
export function parseTags(raw: unknown): string[] {
  const parts: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === "string") {
      for (const piece of value.split(/[,\s]+/)) parts.push(piece);
    } else if (typeof value === "number") {
      parts.push(String(value));
    } else if (Array.isArray(value)) {
      value.forEach(add);
    }
  };
  add(raw);
  return dedupeTags(parts);
}

/** Normalize and de-duplicate, keeping first-seen order. */
export function dedupeTags(tags: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

export function tagNamespace(tag: string): string {
  const slash = tag.indexOf("/");
  return slash > 0 ? tag.slice(0, slash) : "";
}

export function tagLabel(tag: string): string {
  const ns = tagNamespace(tag);
  return ns ? tag.slice(ns.length + 1) : tag;
}

/** True when `recipeTags` has `tag` itself or a tag nested under it. */
export function hasTag(recipeTags: readonly string[], tag: string): boolean {
  const prefix = tag + "/";
  return recipeTags.some((t) => t === tag || t.startsWith(prefix));
}

export function matchesTags(
  recipeTags: readonly string[],
  selected: readonly string[],
  mode: TagMatchMode,
): boolean {
  if (selected.length === 0) return true;
  return mode === "all"
    ? selected.every((tag) => hasTag(recipeTags, tag))
    : selected.some((tag) => hasTag(recipeTags, tag));
}

export function filterByTags<T extends { tags: string[] }>(
  recipes: readonly T[],
  selected: readonly string[],
  mode: TagMatchMode,
): T[] {
  if (selected.length === 0) return [...recipes];
  return recipes.filter((r) => matchesTags(r.tags, selected, mode));
}

/**
 * The chips for the tag panel, grouped by namespace. Namespaced groups come
 * first (alphabetically), plain tags last; tags inside a group are
 * alphabetical so a long list stays scannable.
 *
 * Counts answer "how many recipes would I see with this chip on?":
 * - "all" mode: recipes in `pool` matching the current selection plus this tag.
 * - "any" mode: recipes in `pool` carrying this tag.
 *
 * Tags on every recipe in `allRecipes` (e.g. a blanket `recipe` tag) filter
 * nothing, so they are left out unless selected.
 */
export function buildTagGroups(
  allRecipes: readonly { tags: string[] }[],
  pool: readonly { tags: string[] }[],
  selected: readonly string[],
  mode: TagMatchMode,
): TagGroup[] {
  const total = new Map<string, number>();
  for (const r of allRecipes) {
    for (const t of r.tags) total.set(t, (total.get(t) ?? 0) + 1);
  }

  const base = mode === "all" ? filterByTags(pool, selected, "all") : [...pool];
  const counts = new Map<string, number>();
  for (const r of base) {
    for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }

  const tags = new Set<string>(total.keys());
  for (const t of selected) tags.add(t);

  const groups = new Map<string, TagCount[]>();
  for (const tag of tags) {
    const isSelected = selected.includes(tag);
    if (
      !isSelected &&
      allRecipes.length > 1 &&
      total.get(tag) === allRecipes.length
    ) {
      continue;
    }
    const ns = tagNamespace(tag);
    if (!groups.has(ns)) groups.set(ns, []);
    groups.get(ns)!.push({
      tag,
      label: tagLabel(tag),
      // A selected parent tag (e.g. `cuisine`) counts its nested tags too.
      count: isSelected
        ? base.filter((r) => hasTag(r.tags, tag)).length
        : counts.get(tag) ?? 0,
    });
  }

  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === "" || b === "") return a === "" ? 1 : -1;
      return a.localeCompare(b);
    })
    .map(([namespace, list]) => ({
      namespace,
      tags: list.sort((a, b) => a.label.localeCompare(b.label)),
    }));
}

/** Namespaces with at least two distinct tags: the ones worth sorting by. */
export function sortableNamespaces(
  recipes: readonly { tags: string[] }[],
): string[] {
  const byNs = new Map<string, Set<string>>();
  for (const r of recipes) {
    for (const t of r.tags) {
      const ns = tagNamespace(t);
      if (!ns) continue;
      if (!byNs.has(ns)) byNs.set(ns, new Set());
      byNs.get(ns)!.add(t);
    }
  }
  return [...byNs.entries()]
    .filter(([, set]) => set.size >= 2)
    .map(([ns]) => ns)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Sections for "sort by <namespace>": one per tag in that namespace (a recipe
 * with two cuisines shows under both), biggest first, then a catch-all for
 * recipes with none.
 */
export function groupByNamespace<T extends { tags: string[]; title: string }>(
  recipes: readonly T[],
  namespace: string,
): { label: string; recipes: T[] }[] {
  const map = new Map<string, T[]>();
  const none: T[] = [];
  const prefix = namespace + "/";
  for (const r of recipes) {
    const own = r.tags.filter((t) => t.startsWith(prefix));
    if (own.length === 0) {
      none.push(r);
      continue;
    }
    for (const t of own) {
      const label = t.slice(prefix.length);
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(r);
    }
  }
  const byTitle = (a: T, b: T) => a.title.localeCompare(b.title);
  const sections = [...map.entries()]
    .sort(([a, ra], [b, rb]) => rb.length - ra.length || a.localeCompare(b))
    .map(([label, recs]) => ({ label, recipes: recs.sort(byTitle) }));
  if (none.length > 0) {
    sections.push({ label: `No ${namespace}`, recipes: none.sort(byTitle) });
  }
  return sections;
}

export function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
