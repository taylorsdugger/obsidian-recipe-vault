import { MetadataCache, TFile, Vault } from "obsidian";
import { RecipeNote } from "../types/recipe";

/** All markdown files under the configured recipe-gallery folder (recursively). */
export function getRecipeFiles(vault: Vault, folderPath: string): TFile[] {
  if (!folderPath.trim()) return [];

  const normalizedFolder = folderPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();

  return vault.getMarkdownFiles().filter((file) => {
    const fileFolder = (file.parent?.path ?? "")
      .replace(/\\/g, "/")
      .toLowerCase();
    return (
      fileFolder === normalizedFolder ||
      fileFolder.startsWith(normalizedFolder + "/")
    );
  });
}

/**
 * Load all recipe notes from the given folder path using the metadata cache.
 * No file reads are performed — only the in-memory metadata index is used.
 * Ingredients come from the plugin's ingredient index (`getIngredients`), not
 * from frontmatter, so the searchable list never has to live in the notes.
 */
export function loadRecipes(
  vault: Vault,
  metadataCache: MetadataCache,
  folderPath: string,
  getIngredients: (path: string) => string[],
): RecipeNote[] {
  return getRecipeFiles(vault, folderPath)
    .map((file) => {
      const fm = (metadataCache.getFileCache(file)?.frontmatter ??
        {}) as Record<string, unknown>;
      const photo = resolvePhoto(file, vault, fm.photo);
      const meal_type = parseMealType(fm.meal_type);
      const cook_time = String((fm.cook_time as string) ?? "");
      const cook_time_mins = parseCookTimeMins(cook_time);
      const times_made = typeof fm.times_made === "number" ? fm.times_made : 0;
      const ingredients = getIngredients(file.path);

      return {
        title: file.basename,
        path: file.path,
        photo,
        meal_type,
        cook_time,
        cook_time_mins,
        times_made,
        ingredients,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Strip WikiLink/Markdown wrappers from a frontmatter image reference. */
function normalizeImageRef(raw: unknown): string {
  if (!raw) return "";
  let p = String(raw).trim();

  if (p.startsWith("![[") && p.endsWith("]]")) {
    p = p.slice(3, -2);
  }

  // [[file.jpg]] → file.jpg
  if (p.startsWith("[[") && p.endsWith("]]")) {
    p = p.slice(2, -2);
  }

  const aliasIndex = p.indexOf("|");
  if (aliasIndex >= 0) {
    p = p.slice(0, aliasIndex);
  }

  // ![alt](url) → url
  const mdMatch = p.match(/!\[.*?\]\((.+?)\)/);
  if (mdMatch) p = mdMatch[1];

  return p.trim();
}

/**
 * Resolve a frontmatter image reference to a local vault file.
 * Returns null for remote URLs or references that don't resolve to a file —
 * callers use this to find the full-resolution image (e.g. to backfill thumbs).
 */
export function resolveImageFile(
  sourceFile: TFile,
  vault: Vault,
  raw: unknown,
): TFile | null {
  const p = normalizeImageRef(raw);
  if (!p || /^https?:\/\//i.test(p)) return null;
  const file =
    vault.getAbstractFileByPath(p) ??
    metadataCachePathLookup(vault, sourceFile, p);
  return file instanceof TFile ? file : null;
}

/**
 * The gallery-thumbnail path that sits next to a full-resolution image.
 * `Recipe Images/pie.jpg` → `Recipe Images/pie.thumb.jpg`. Generated at import
 * (and via the backfill command) so the gallery can load a small decode-cheap
 * image while the note body keeps the full-resolution photo.
 */
export function thumbPathForImage(imagePath: string): string {
  const slash = imagePath.lastIndexOf("/");
  const dot = imagePath.lastIndexOf(".");
  const base = dot > slash ? imagePath.slice(0, dot) : imagePath;
  return `${base}.thumb.jpg`;
}

/** Strip WikiLink/Markdown wrappers and resolve local vault files to a usable URL. */
function resolvePhoto(sourceFile: TFile, vault: Vault, raw: unknown): string {
  const p = normalizeImageRef(raw);
  if (!p) return "";

  // Already an absolute URL — use as-is
  if (/^https?:\/\//i.test(p)) return p;

  // Local vault file — prefer a generated thumbnail sibling, fall back to the
  // full-resolution image, then to the bare path so the <img> onError handler
  // can show the placeholder.
  const file = resolveImageFile(sourceFile, vault, raw);
  if (file) {
    const thumb = vault.getAbstractFileByPath(thumbPathForImage(file.path));
    if (thumb instanceof TFile) {
      return vault.getResourcePath(thumb);
    }
    return vault.getResourcePath(file);
  }

  return p;
}

function metadataCachePathLookup(
  vault: Vault,
  sourceFile: TFile,
  relativePath: string,
): TFile | null {
  const sourceFolder = sourceFile.parent?.path;
  if (!sourceFolder) return null;

  const normalized = `${sourceFolder}/${relativePath}`.replace(/\\/g, "/");
  const resolved = vault.getAbstractFileByPath(normalized);
  return resolved instanceof TFile ? resolved : null;
}

function parseMealType(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s).trim()).filter(Boolean);
  }
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse a human-readable cook time string into total minutes.
 * Handles formats like "30 minutes", "1 hour", "1 hour 30 minutes",
 * ISO 8601 durations like "PT1H30M", shorthand like "1h 30m", and
 * clock-style values like "1:30" or "01:30:00".
 * Returns 0 when the string cannot be parsed.
 */
export function parseCookTimeMins(cookTime: string): number {
  if (!cookTime) return 0;

  const value = cookTime.trim();
  if (!value) return 0;

  const isoMatch = value.match(/P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/i);
  if (isoMatch && isoMatch[0].length === value.length) {
    const hours = parseInt(isoMatch[1] ?? "0", 10);
    const minutes = parseInt(isoMatch[2] ?? "0", 10);
    const seconds = parseInt(isoMatch[3] ?? "0", 10);
    return hours * 60 + minutes + (seconds >= 30 ? 1 : 0);
  }

  const clockMatch = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (clockMatch) {
    const first = parseInt(clockMatch[1], 10);
    const second = parseInt(clockMatch[2], 10);
    const third = parseInt(clockMatch[3] ?? "0", 10);

    // Treat H:MM / HH:MM and HH:MM:SS as hours-based durations.
    return first * 60 + second + (third >= 30 ? 1 : 0);
  }

  let mins = 0;
  const hourMatch = value.match(/(\d+)\s*(?:hours?|hrs?|hr|h)\b/i);
  if (hourMatch) mins += parseInt(hourMatch[1], 10) * 60;

  const minMatch = value.match(/(\d+)\s*(?:minutes?|mins?|min|m)\b/i);
  if (minMatch) mins += parseInt(minMatch[1], 10);

  if (mins > 0) return mins;

  const digitsOnly = value.match(/^\d+$/);
  if (digitsOnly) {
    return parseInt(value, 10);
  }

  return 0;
}

/** Group a cook time (in minutes) into a display range label. */
export function cookTimeGroup(mins: number): string {
  if (mins <= 0) return "Unknown";
  if (mins < 15) return "Under 15 min";
  if (mins < 30) return "15\u201330 min";
  if (mins < 60) return "30\u201360 min";
  if (mins < 120) return "1\u20132 hr";
  return "2+ hr";
}

/** Group a times-made count into a display range label. */
export function timesMadeGroup(n: number): string {
  if (n <= 0) return "Never made";
  if (n <= 3) return "1\u20133 times";
  if (n <= 10) return "4\u201310 times";
  return "11+ times";
}
