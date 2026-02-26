# GitHub Copilot Guide for Recipe Pro

## 🤖 What is GitHub Copilot?

GitHub Copilot is an AI pair programmer built into VS Code, JetBrains IDEs, and GitHub.com. It provides inline code completions, Copilot Chat for asking questions about your codebase, and suggestions powered by large language models trained on code.

---

## ⚙️ Setup

1. Install the [GitHub Copilot extension](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot) in VS Code.
2. Sign in with a GitHub account that has Copilot access (individual, team, or enterprise subscription).
3. The `.github/copilot-instructions.md` file in this repo **automatically gives Copilot context** about the project — no extra setup needed.

---

## 💡 How to Use Copilot Effectively in This Repo

- **Ask Copilot Chat** about how the plugin works:
  > "How does recipe parsing work in `main.ts`?"
  > "What Handlebars helpers are registered and what do they do?"

- **Use Copilot for boilerplate** — new Obsidian modals, settings fields, and Handlebars helpers follow a consistent pattern; let Copilot scaffold them based on existing examples in `src/`.

- **Use inline completions** while writing TypeScript — Copilot understands the `schema-dts` recipe types and the Obsidian API surface.

- **Use Copilot to write comments and docs** for complex parsing logic in `main.ts`, particularly around JSON-LD extraction and schema normalization.

---

## ✅ Best Practices

- **Always review Copilot suggestions** before accepting — especially around Obsidian API calls and file system operations.
- **Run `npm run lint` and `npm run format`** after accepting suggestions to ensure code style compliance.
- **Do not let Copilot add new `npm` dependencies** without discussion — keep the bundle small.
- **Prefer Copilot Chat (`@workspace`)** for understanding unfamiliar code sections before making changes.
- **Use Copilot to help write conventional commit messages** (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`).

---

## 🚫 What Copilot Should NOT Do in This Repo

- ❌ Do **not** use browser-native `fetch` or `document` APIs directly — use Obsidian's `requestUrl` and vault APIs instead.
- ❌ Do **not** introduce `any` types — use proper TypeScript interfaces, especially for recipe schema shapes from `schema-dts`.
- ❌ Do **not** modify `manifest.json` or `versions.json` manually — use `npm version` which runs `version-bump.mjs` automatically.

---

## 🔗 Resources

- <a href="https://docs.github.com/en/copilot">GitHub Copilot Docs</a>
- <a href="https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin">Obsidian Plugin Developer Docs</a>
- <a href="https://handlebarsjs.com/guide/">Handlebars Docs</a>
- <a href="https://developers.google.com/search/docs/appearance/structured-data/recipe">schema-dts Recipe type reference</a>
