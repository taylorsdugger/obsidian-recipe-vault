import { MetadataCache, TFile, Vault } from "obsidian";
import { normalizePhotoProperty } from "@recipe-vault/core";
import { RecipeNote } from "../types/recipe";

/**
 * What the plugin's index keeps for a `.cook` file. Obsidian has no metadata
 * cache for these, so the index reads them once per change instead.
 */
export interface CooklangIndexInfo {
  title: string;
  photo: string;
  mealType: string;
  cookTime: string;
  timesMade: number;
  sourceUrl: string;
  /** `source file`, what a folder import uses to skip one it already did. */
  sourceFile: string;
}

/** True for a file that can hold a recipe: a note or a Cooklang file. */
export function isRecipeFileType(file: TFile): boolean {
  const ext = file.extension.toLowerCase();
  return ext === "md" || ext === "cook";
}

/** True for a Cooklang recipe file. */
export function isCooklangFile(file: TFile): boolean {
  return file.extension.toLowerCase() === "cook";
}

/**
 * `Pie.jpg` (or .jpeg/.png/.webp) next to `Pie.cook`, which is where Cooklang
 * keeps a recipe's photo. Null when there isn't one.
 */
export function cooklangSiblingImage(vault: Vault, file: TFile): TFile | null {
  const dir =
    file.parent && !file.parent.isRoot() ? `${file.parent.path}/` : "";
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    const image = vault.getAbstractFileByPath(`${dir}${file.basename}.${ext}`);
    if (image instanceof TFile) return image;
  }
  return null;
}

/**
 * A `.cook` file's photo in the vault: the one next to it, else the vault
 * path its `image:` front matter gives. Null for a url or no photo.
 */
export function cooklangPhotoFile(
  vault: Vault,
  file: TFile,
  image: string,
): TFile | null {
  return (
    cooklangSiblingImage(vault, file) ?? resolveImageFile(file, vault, image)
  );
}

/**
 * All recipe notes and Cooklang files under the configured recipe-gallery
 * folder (recursively), minus `excludePath` (the template file).
 *
 * A `.cook` file with a note of the same name next to it is left out. That's
 * what "Export recipe as Cooklang" leaves behind, and it's the same recipe,
 * so the note stands for both instead of the gallery showing it twice.
 */
export function getRecipeFiles(
  vault: Vault,
  folderPath: string,
  excludePath = "",
): TFile[] {
  if (!folderPath.trim()) return [];

  const normalizedFolder = folderPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();

  const inFolder = vault.getFiles().filter((file) => {
    if (!isRecipeFileType(file)) return false;
    if (excludePath && file.path === excludePath) return false;
    const fileFolder = (file.parent?.path ?? "")
      .replace(/\\/g, "/")
      .toLowerCase();
    return (
      fileFolder === normalizedFolder ||
      fileFolder.startsWith(normalizedFolder + "/")
    );
  });

  const withoutExtension = (file: TFile) =>
    file.path.slice(0, -(file.extension.length + 1)).toLowerCase();
  const notes = new Set(
    inFolder.filter((file) => !isCooklangFile(file)).map(withoutExtension),
  );
  return inFolder.filter(
    (file) => !isCooklangFile(file) || !notes.has(withoutExtension(file)),
  );
}

/**
 * Load all recipes from the given folder path. No file reads are performed.
 * Notes come from Obsidian's metadata cache and `.cook` files from the
 * plugin's index (`getCooklangInfo`). Ingredients come from the plugin's
 * ingredient index (`getIngredients`), not from frontmatter, so the searchable
 * list never has to live in the notes.
 */
export function loadRecipes(
  vault: Vault,
  metadataCache: MetadataCache,
  folderPath: string,
  getIngredients: (path: string) => string[],
  getCooklangInfo: (path: string) => CooklangIndexInfo | undefined = () =>
    undefined,
  opts: { photoProperty?: string; excludePath?: string } = {},
): RecipeNote[] {
  const photoKey = normalizePhotoProperty(opts.photoProperty);
  return getRecipeFiles(vault, folderPath, opts.excludePath)
    .map((file) => {
      if (isCooklangFile(file)) {
        return cooklangRecipe(
          vault,
          file,
          getCooklangInfo(file.path),
          getIngredients(file.path),
        );
      }
      const fm = (metadataCache.getFileCache(file)?.frontmatter ??
        {}) as Record<string, unknown>;
      // The configured property, else `photo`, so notes made before it
      // changed keep their photo.
      const photo = resolvePhoto(file, vault, fm[photoKey] || fm.photo);
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

/**
 * A `.cook` file as a gallery card. Before the index has read it, it still
 * shows, by file name.
 */
function cooklangRecipe(
  vault: Vault,
  file: TFile,
  info: CooklangIndexInfo | undefined,
  ingredients: string[],
): RecipeNote {
  const cook_time = info?.cookTime ?? "";
  return {
    title: file.basename,
    path: file.path,
    photo: cooklangPhoto(vault, file, info?.photo ?? ""),
    meal_type: parseMealType(info?.mealType),
    cook_time,
    cook_time_mins: parseCookTimeMins(cook_time),
    times_made: info?.timesMade ?? 0,
    ingredients,
  };
}

/**
 * The photo next to the file (its thumbnail if there is one), else what its
 * `image:` front matter says: a vault path in the image folder, or a url.
 */
function cooklangPhoto(vault: Vault, file: TFile, linked: string): string {
  const image = cooklangSiblingImage(vault, file);
  if (image) {
    const thumb = vault.getAbstractFileByPath(thumbPathForImage(image.path));
    return vault.getResourcePath(thumb instanceof TFile ? thumb : image);
  }
  return resolvePhoto(file, vault, linked);
}

/**
 * A frontmatter value as text, the way `String()` would print it. An unquoted
 * `image: [[Pie.jpg]]` parses as a nested array, which joins back to the name.
 * Objects come back empty rather than as "[object Object]".
 */
function frontmatterText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (Array.isArray(raw)) return raw.map(frontmatterText).join(",");
  return "";
}

/** Strip WikiLink/Markdown wrappers from a frontmatter image reference. */
function normalizeImageRef(raw: unknown): string {
  if (!raw) return "";
  let p = frontmatterText(raw).trim();

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
  return frontmatterText(raw)
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

/** Join a folder and a relative path, working out `.` and `..` steps. */
function joinVaultPath(dir: string, relative: string): string {
  const parts = dir ? dir.split("/") : [];
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

/**
 * The file a Cooklang recipe reference (`@./Sauces/Hollandaise{}`) points at.
 *
 * Tried relative to the file it's in, then relative to the recipe folder,
 * as a `.cook` file and then as a note. When neither has it, `findByName`
 * gets the last word, the way a `[[wikilink]]` would find "Hollandaise"
 * anywhere in the vault.
 */
export function resolveRecipeReference(
  vault: Vault,
  from: TFile,
  reference: string,
  recipeFolder: string,
  findByName: (name: string) => TFile | null = () => null,
): TFile | null {
  const dir = from.parent && !from.parent.isRoot() ? from.parent.path : "";
  const hasExtension = /\.(cook|md)$/i.test(reference);
  const bases = [
    joinVaultPath(dir, reference),
    joinVaultPath(recipeFolder.trim().replace(/\/+$/, ""), reference),
  ];
  for (const base of bases) {
    for (const ext of hasExtension ? [""] : [".cook", ".md"]) {
      const file = vault.getAbstractFileByPath(`${base}${ext}`);
      if (file instanceof TFile && file.path !== from.path) return file;
    }
  }
  const name = reference.replace(/^.*\//, "").replace(/\.(cook|md)$/i, "");
  return findByName(`${name}.cook`) ?? findByName(name);
}
