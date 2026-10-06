import type { CheerioAPI } from "cheerio";

import { isJsonRecord } from "../types";

/**
 * Reduce a language tag to its primary subtag. "de-DE", "de_AT" and "DE" all
 * become "de". Anything that doesn't look like a tag gives undefined.
 */
export function primaryLanguage(tag: unknown): string | undefined {
  if (typeof tag !== "string") return undefined;
  const primary = tag.trim().split(/[-_]/)[0].toLowerCase();
  return /^[a-z]{2,3}$/.test(primary) ? primary : undefined;
}

/**
 * A recipe's schema.org `inLanguage`. Sites write it as a tag ("de-DE"), a
 * Language node (`{ "@type": "Language", "alternateName": "de" }`), or a list
 * of either. The first one wins.
 */
export function recipeLanguage(inLanguage: unknown): string | undefined {
  const value: unknown = Array.isArray(inLanguage) ? inLanguage[0] : inLanguage;
  if (isJsonRecord(value)) {
    return primaryLanguage(value.alternateName) ?? primaryLanguage(value.name);
  }
  return primaryLanguage(value);
}

/** What language the page says it is in: `<html lang>`, then `og:locale`. */
export function pageLanguage($: CheerioAPI): string | undefined {
  return (
    primaryLanguage($("html").attr("lang")) ??
    primaryLanguage($('meta[property="og:locale"]').attr("content"))
  );
}
