// Copies the built plugin into the beta folder of the personal vault, so a
// change can be tried in Obsidian without cutting a release. Run it through
// `npm run beta`, which builds first.
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const target =
  process.env.RECIPE_VAULT_BETA_DIR ??
  "/Users/tdugger/Obsidian Vault/Personal/.obsidian/plugins/recipe-vault-beta";

if (!existsSync(target)) {
  console.error(`Beta plugin folder not found: ${target}`);
  process.exit(1);
}

for (const file of ["main.js", "styles.css"]) {
  copyFileSync(file, join(target, file));
  console.log(`copied ${file} -> ${target}`);
}
