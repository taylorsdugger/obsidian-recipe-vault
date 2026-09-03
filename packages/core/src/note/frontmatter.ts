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
