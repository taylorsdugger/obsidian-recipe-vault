import { MetadataCache, TFile, Vault } from "obsidian";
import { RecipeNote } from "../types/recipe";

/**
 * Load all recipe notes from the given folder path using the metadata cache.
 * No file reads are performed — only the in-memory metadata index is used.
 */
export function loadRecipes(
  vault: Vault,
  metadataCache: MetadataCache,
  folderPath: string,
): RecipeNote[] {
  if (!folderPath.trim()) return [];

  const normalizedFolder = folderPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();

  const files = vault.getMarkdownFiles().filter((file) => {
    const fileFolder = (file.parent?.path ?? "")
      .replace(/\\/g, "/")
      .toLowerCase();
    return (
      fileFolder === normalizedFolder ||
      fileFolder.startsWith(normalizedFolder + "/")
    );
  });

  return files
    .map((file) => {
      const fm = (metadataCache.getFileCache(file)?.frontmatter ??
        {}) as Record<string, unknown>;
      const photo = resolvePhoto(file, vault, fm.photo);
      const meal_type = parseMealType(fm.meal_type);
      const cook_time = String((fm.cook_time as string) ?? "");
      const cook_time_mins = parseCookTimeMins(cook_time);
      const times_made =
        typeof fm.times_made === "number" ? (fm.times_made as number) : 0;

      return {
        title: file.basename,
        path: file.path,
        photo,
        meal_type,
        cook_time,
        cook_time_mins,
        times_made,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Strip WikiLink/Markdown wrappers and resolve local vault files to a usable URL. */
function resolvePhoto(sourceFile: TFile, vault: Vault, raw: unknown): string {
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

  if (!p) return "";

  // Already an absolute URL — use as-is
  if (/^https?:\/\//i.test(p)) return p;

  // Local vault file — resolve to a resource URL Obsidian can render
  const file =
    vault.getAbstractFileByPath(p) ??
    metadataCachePathLookup(vault, sourceFile, p);
  if (file instanceof TFile) {
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
