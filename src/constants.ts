/* -------------------------------- COMMANDS -------------------------------- */

export const CMD_OPEN_MODAL = "cmd-open-modal";
export const CMD_INSERT_RECIPE = "cmd-insert-recipe";
export const CMD_MARK_MADE = "cmd-mark-made";
export const CMD_ADD_TO_SHOPPING_LIST = "cmd-add-to-shopping-list";
export const CMD_CLEAR_SHOPPING_LIST = "cmd-clear-shopping-list";
export const CMD_BATCH_IMPORT = "cmd-batch-import";
export const CMD_UPDATE_RECIPES_PROPERTIES = "cmd-update-recipes-properties";
export const CMD_NEW_RECIPE_STUB = "cmd-new-recipe-stub";
export const CMD_RECIPE_FROM_IMAGE = "cmd-recipe-from-image";
export const MANUAL_RECIPE_DEFAULT_FOLDER = "recipes";
export const VIEW_TYPE_RECIPE_GALLERY = "recipe-gallery-view";
export const CMD_OPEN_RECIPE_GALLERY = "cmd-open-recipe-gallery";

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
