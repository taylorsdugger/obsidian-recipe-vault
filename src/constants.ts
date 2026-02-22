/* -------------------------------- COMMANDS -------------------------------- */

export const CMD_OPEN_MODAL = "cmd-open-modal";
export const CMD_INSERT_RECIPE = "cmd-insert-recipe";
export const CMD_MARK_MADE = "cmd-mark-made";
export const CMD_ADD_TO_SHOPPING_LIST = "cmd-add-to-shopping-list";
export const CMD_CLEAR_SHOPPING_LIST = "cmd-clear-shopping-list";

/* ---------------------------- DEFAULT TEMPLATE ---------------------------- */

export const DEFAULT_TEMPLATE = `---
tags: 
- recipe 
date_added: {{magicTime}}
created: {{datePublished}}
meal_type: {{recipeCategory}}
author: {{author.name}}
url: {{url}}
times_made: 0
last_made:
---

# [{{{name}}}]({{url}})

{{{description}}}

![{{{name}}}]({{image}})

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
`;
