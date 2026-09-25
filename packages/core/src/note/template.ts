import dateFormat from "dateformat";
import * as Handlebars from "handlebars";

import { formatIsoDuration, formatPhotoValue } from "./frontmatter";

/* ----------------------------- TEMPLATE VERSION --------------------------- */
/** Increment this whenever DEFAULT_TEMPLATE gains new required fields. */
export const TEMPLATE_VERSION = 2;

/* ---------------------------- DEFAULT TEMPLATE ---------------------------- */

export const DEFAULT_TEMPLATE = `---
cssclasses: recipe-note
tags: 
- recipe 
date_added: {{magicTime}}
created: {{datePublished}}
meal_type: {{recipeCategory}}
author: {{author}}
cook_time: {{magicTime totalTime}}
url: {{url}}
photo: "{{photoFrontmatter image}}"
times_made: 0
last_made:
---

# [{{{name}}}]({{url}})

{{#if image}}
![{{{name}}}]({{imageLink image}})

{{/if}}

{{#if description}}
{{{description}}}

{{/if}}

> [!recipe-meta] At a Glance
{{#if recipeCategory}}> **Meal type**: {{recipeCategory}}
{{/if}}{{#if totalTime}}> **Cook time**: {{magicTime totalTime}}
{{/if}}{{#if author}}> **Author**: {{author}}
{{/if}}{{#if url}}> **Source**: [Open recipe]({{url}})
{{/if}}

### Ingredients

{{#each recipeIngredient}}
- [ ] {{{this}}}
{{/each}}

### Instructions

{{#each recipeInstructions}}
{{#if this.itemListElement}}
#### {{{this.name}}}
{{#each this.itemListElement}}
- {{{this.text}}}
{{/each}}
{{else if this.text}}
- {{{this.text}}}
{{else}}
- {{{this}}}
{{/if}}
{{/each}}

-----

## Notes
{{#if recipeNotes}}
{{#each recipeNotes}}
- {{{this}}}
{{/each}}
{{/if}}
`;

/**
 * Templates saved before the body image went through `imageLink` still have
 * the raw `({{image}})` destination. Swapping just that token fixes their
 * links without clobbering anything else the user customized.
 */
export function migrateImageLink(template: string): string {
  return template.split("]({{image}})").join("]({{imageLink image}})");
}

/**
 * Formats an image path/URL as a Markdown link destination. A Markdown link
 * ends at the first space, so a local path like `90 Anlagen/pie.jpg` has to be
 * percent-encoded (Obsidian decodes it back). `(`, `)` and `'` are encoded
 * too: the parens would close the link early, and Handlebars would otherwise
 * HTML-escape the quote. Remote URLs pass through unchanged.
 */
export function formatImageLink(imgPath: string): string {
  if (imgPath.startsWith("http://") || imgPath.startsWith("https://")) {
    return imgPath;
  }
  return imgPath
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[()']/g,
        (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

export type RecipeRenderer = (data: object) => string;

export interface RendererOptions {
  /** How `photoFrontmatter` writes an image path. Defaults to wikilink-or-URL. */
  formatPhoto?: (imgPath: string) => string;
}

/**
 * Compile a recipe template with the `splitTags`, `photoFrontmatter`, and
 * `magicTime` helpers registered on a private Handlebars environment. The
 * global Handlebars is never touched, so two renderers with different photo
 * formatting can coexist.
 */
export function createRecipeRenderer(
  template: string,
  opts: RendererOptions = {},
): RecipeRenderer {
  const formatPhoto = opts.formatPhoto ?? formatPhotoValue;
  const hb = Handlebars.create();

  hb.registerHelper("splitTags", function (tags: unknown) {
    if (!tags || typeof tags != "string") {
      return "";
    }
    const tagsArray = tags.split(",");
    let tagString = "";
    for (const tag of tagsArray) {
      tagString += "- " + tag.trim() + "\n";
    }
    return tagString;
  });

  hb.registerHelper("photoFrontmatter", function (imgPath: unknown) {
    if (!imgPath) return "";
    // The template wraps this in a YAML double-quoted string, so escape for
    // YAML instead of letting Handlebars HTML-escape it. Otherwise a saved
    // `Mom's-Pie.jpg` lands as `[[Mom&#x27;s-Pie.jpg]]` and never resolves.
    const yamlSafe = formatPhoto(String(imgPath))
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
    return new hb.SafeString(yamlSafe);
  });

  hb.registerHelper("imageLink", function (imgPath: unknown) {
    if (!imgPath) return "";
    return formatImageLink(String(imgPath));
  });

  hb.registerHelper("magicTime", function (arg1: unknown, arg2: unknown) {
    if (typeof arg1 === "undefined") {
      return "";
    }
    if (arguments.length === 1) {
      return dateFormat(new Date(), "yyyy-mm-dd HH:MM");
    }
    const value = typeof arg1 === "string" ? arg1 : String(arg1);
    if (arguments.length === 2) {
      if (!isNaN(Date.parse(value))) {
        return dateFormat(new Date(value), "yyyy-mm-dd HH:MM");
      }
      if (value.trim().startsWith("PT")) {
        return formatIsoDuration(value);
      }
      try {
        return dateFormat(new Date(), value);
      } catch {
        return "";
      }
    } else if (arguments.length === 3) {
      const mask = typeof arg2 === "string" ? arg2 : String(arg2);
      if (!isNaN(Date.parse(value))) {
        return dateFormat(new Date(value), mask);
      }
      return "Error in template or source";
    } else {
      return "Error in template";
    }
  });

  return hb.compile(template);
}
