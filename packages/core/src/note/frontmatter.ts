/**
 * Formats an image path/URL as a frontmatter photo value.
 * Local paths are wrapped in [[...]] (Obsidian wikilink); remote URLs are returned as-is.
 */
export function formatPhotoValue(imgPath: string): string {
  if (imgPath.startsWith("http://") || imgPath.startsWith("https://")) {
    return imgPath;
  }
  return `[[${imgPath}]]`;
}

/**
 * Format an ISO 8601 duration string (e.g. "PT1H30M") into a human-readable
 * string (e.g. "1h 30m "). Returns the original string if it doesn't start with "PT".
 */
export function formatIsoDuration(duration: string): string {
  const raw = duration.trim();
  if (!raw.startsWith("PT")) return raw;
  return raw
    .replace("PT", "")
    .replace("H", "h ")
    .replace("M", "m ")
    .replace("S", "s ");
}

export interface FrontmatterOptions {
  /** How to write an image path in frontmatter. Defaults to wikilink-or-URL. */
  formatPhoto?: (imgPath: string) => string;
}

/**
 * Ensures required frontmatter keys exist even when users have customized/older templates.
 */
export function ensureRequiredRecipeFrontmatter(
  markdown: string,
  values: { cookTime?: string; image?: string },
  opts: FrontmatterOptions = {},
): string {
  const formatPhoto = opts.formatPhoto ?? formatPhotoValue;
  const cookTimeValue = normalizeCookTimeValue(values.cookTime);
  const photoValue = (values.image ? formatPhoto(values.image) : "").replace(
    /"/g,
    '\\"',
  );

  const requiredLines = [
    "cssclasses: recipe-note",
    `cook_time: ${cookTimeValue}`,
    `photo: "${photoValue}"`,
  ];

  if (markdown.startsWith("---\n")) {
    const frontmatterStart = 4;
    const frontmatterEnd = markdown.indexOf("\n---", frontmatterStart);
    if (frontmatterEnd !== -1) {
      let fmContent = markdown.slice(frontmatterStart, frontmatterEnd);
      const remainder = markdown.slice(frontmatterEnd + 4);

      const hasKey = (key: string): boolean =>
        new RegExp(`^${key}\\s*:`, "m").test(fmContent);

      const missingLines = requiredLines.filter((line) => {
        const key = line.split(":", 1)[0];
        return !hasKey(key);
      });

      if (missingLines.length === 0) {
        return markdown;
      }

      if (fmContent.length > 0 && !fmContent.endsWith("\n")) {
        fmContent += "\n";
      }
      fmContent += `${missingLines.join("\n")}\n`;

      const remainderPrefix = remainder.startsWith("\n") ? "" : "\n";
      return `---\n${fmContent}---${remainderPrefix}${remainder}`;
    }
  }

  return `---\n${requiredLines.join("\n")}\n---\n\n${markdown}`;
}

function normalizeCookTimeValue(raw?: string): string {
  if (!raw) return "";
  return raw.trim().startsWith("PT") ? formatIsoDuration(raw) : raw;
}

/** True when there is no `## Notes` heading, or it has nothing under it. */
export function isRecipeNotesSectionEmpty(markdown: string): boolean {
  const headingMatch = markdown.match(/^##\s+Notes\s*$/m);
  if (!headingMatch || headingMatch.index === undefined) return true;

  const sectionStart = headingMatch.index + headingMatch[0].length;
  const afterHeading = markdown.slice(sectionStart);
  const nextHeadingMatch = afterHeading.match(/\n##\s+/);
  const sectionBody =
    nextHeadingMatch && nextHeadingMatch.index !== undefined
      ? afterHeading.slice(0, nextHeadingMatch.index)
      : afterHeading;

  return sectionBody.trim().length === 0;
}

/**
 * Fill an empty `## Notes` section with the given notes, or append one when
 * the heading is missing. A section that already has content is left alone.
 */
export function ensureRecipeNotesSection(
  markdown: string,
  notes: string[],
): string {
  if (notes.length === 0) return markdown;

  const headingMatch = markdown.match(/^##\s+Notes\s*$/m);
  const notesBody = `${notes.map((note) => `- ${note}`).join("\n")}\n`;

  if (!headingMatch || headingMatch.index === undefined) {
    const separator = markdown.endsWith("\n") ? "" : "\n";
    return `${markdown}${separator}\n## Notes\n\n${notesBody}`;
  }

  const sectionStart = headingMatch.index + headingMatch[0].length;
  const beforeSection = markdown.slice(0, sectionStart);
  const afterHeading = markdown.slice(sectionStart);
  const nextHeadingMatch = afterHeading.match(/\n##\s+/);
  const sectionBody =
    nextHeadingMatch && nextHeadingMatch.index !== undefined
      ? afterHeading.slice(0, nextHeadingMatch.index)
      : afterHeading;

  if (sectionBody.trim().length > 0) return markdown;

  const tail =
    nextHeadingMatch && nextHeadingMatch.index !== undefined
      ? afterHeading.slice(nextHeadingMatch.index)
      : "";

  return `${beforeSection}\n\n${notesBody}${tail}`;
}

/**
 * Read a note's YAML frontmatter into a flat map of scalar values.
 *
 * Deliberately small: it handles the shapes `DEFAULT_TEMPLATE` writes — one
 * `key: value` per line, plus `- item` lists collapsed to a comma string —
 * and nothing else. Anything the web app needs structured lives in a column
 * derived from this, and the markdown stays the source of truth.
 */
export function readFrontmatter(markdown: string): Record<string, string> {
  if (!markdown.startsWith("---\n")) return {};
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return {};

  const values: Record<string, string> = {};
  let listKey: string | null = null;
  let listItems: string[] = [];

  const flushList = (): void => {
    if (listKey && listItems.length > 0) {
      values[listKey] = listItems.join(", ");
    }
    listKey = null;
    listItems = [];
  };

  for (const rawLine of markdown.slice(4, end).split("\n")) {
    const listMatch = rawLine.match(/^\s*-\s+(.*)$/);
    if (listMatch && listKey) {
      const item = listMatch[1].trim();
      if (item) listItems.push(item);
      continue;
    }

    const match = rawLine.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) continue;

    flushList();
    const [, key, rawValue] = match;
    const value = stripQuotes(rawValue.trim());
    if (value === "") {
      // Either a genuinely empty value or the head of a `- item` list; the
      // next line decides. Record the empty string either way.
      values[key] = "";
      listKey = key;
      continue;
    }
    values[key] = value;
  }
  flushList();

  return values;
}

/** Drop one layer of surrounding quotes and any `[[wikilink]]` brackets. */
function stripQuotes(value: string): string {
  let out = value;
  if (
    (out.startsWith('"') && out.endsWith('"') && out.length > 1) ||
    (out.startsWith("'") && out.endsWith("'") && out.length > 1)
  ) {
    out = out.slice(1, -1);
  }
  if (out.startsWith("[[") && out.endsWith("]]")) {
    out = out.slice(2, -2);
  }
  return out.trim();
}

/**
 * Turn a cook time into whole minutes for sorting. Reads both what the
 * template writes ("1h 30m") and the raw ISO duration ("PT1H30M"). Returns
 * null when there's no number in there.
 */
export function cookTimeToMinutes(value: string | undefined): number | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;

  const source = raw.startsWith("PT") ? formatIsoDuration(raw) : raw;
  const hours = source.match(/(\d+(?:\.\d+)?)\s*h/i);
  const minutes = source.match(/(\d+(?:\.\d+)?)\s*m/i);

  if (!hours && !minutes) {
    // A bare number is minutes ("45"), which is what a hand-edited note has.
    const bare = source.match(/^(\d+(?:\.\d+)?)$/);
    return bare ? Math.round(Number(bare[1])) : null;
  }

  const total =
    (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
  return Math.round(total);
}
