/* -------------------------------- COMMANDS -------------------------------- */

export const CMD_OPEN_MODAL = "cmd-open-modal";
export const CMD_INSERT_RECIPE = "cmd-insert-recipe";
export const CMD_MARK_MADE = "cmd-mark-made";
export const CMD_ADD_TO_SHOPPING_LIST = "cmd-add-to-shopping-list";
export const CMD_CLEAR_SHOPPING_LIST = "cmd-clear-shopping-list";
export const CMD_BATCH_IMPORT = "cmd-batch-import";
export const CMD_NEW_RECIPE_STUB = "cmd-new-recipe-stub";
export const CMD_BACKFILL_INGREDIENTS = "cmd-backfill-ingredients";
export const CMD_RECIPE_FROM_PHOTO = "cmd-recipe-from-photo";
export const CMD_IMPORT_JSONLD = "cmd-import-jsonld";
export const CMD_EXPORT_JSONLD = "cmd-export-jsonld";
export const CMD_EXPORT_COOKLANG = "cmd-export-cooklang";
export const CMD_IMPORT_FOLDER = "cmd-import-folder";
export const MANUAL_RECIPE_DEFAULT_FOLDER = "recipes";
export const VIEW_TYPE_RECIPE_GALLERY = "recipe-gallery-view";
export const CMD_OPEN_RECIPE_GALLERY = "cmd-open-recipe-gallery";
export const VIEW_TYPE_COOKLANG = "recipe-vault-cooklang-view";

/**
 * A folder import this big asks first. Not a measured limit: the gallery took
 * ~4s to open with 18,000 notes, and the plugin is meant for a personal
 * collection, so a few thousand at once is worth a second look.
 */
export const BULK_IMPORT_WARN_AT = 1000;

/* ------------------------------- TEMPLATE --------------------------------- */
/** The note template lives in @recipe-vault/core. */
export { DEFAULT_TEMPLATE } from "@recipe-vault/core";

/** Where "Create template file" puts a new template, before de-duplicating. */
export const TEMPLATE_FILE_DEFAULT_PATH = "Recipe Vault template.md";
