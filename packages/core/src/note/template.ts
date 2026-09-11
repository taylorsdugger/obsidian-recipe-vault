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
![{{{name}}}]({{image}})

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
    return formatPhoto(String(imgPath));
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
