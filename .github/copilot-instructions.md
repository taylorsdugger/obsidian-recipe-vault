# GitHub Copilot Instructions

## Project Context

This is an Obsidian plugin called **Recipe Pro** written in TypeScript. It scrapes structured recipe JSON-LD data from web pages using [Cheerio](https://cheerio.js.org/) and renders it into Obsidian notes using [Handlebars](https://handlebarsjs.com/) templates.

- Plugin entry point: `src/main.ts`
- Settings UI: `src/settings.ts`
- Recipe loading modal: `src/modal-load-recipe.ts`
- Shared constants: `src/constants.ts`
- Bundled with `esbuild` (`esbuild.config.mjs`)

## Code Style

- All code must pass **ESLint** and **Prettier** before committing.
- Run `npm run lint` and `npm run format` to check and fix style issues.
- The `prebuild` script enforces this automatically when running `npm run build`.

## TypeScript Conventions

- Prefer **strict typing** throughout. Avoid `any`.
- Use **interfaces** for all data shapes, especially recipe schema types sourced from `schema-dts`.
- Enable and respect all `tsconfig.json` compiler options.

## Obsidian API Usage

- Use the **Obsidian API** (`obsidian` package) for all UI, file, and vault interactions.
- Do **not** use browser DOM APIs (`document`, `window`, `fetch`) directly.
- Use `requestUrl` from the Obsidian API for HTTP requests.
- Use Obsidian vault APIs for all file read/write operations.

## File Structure

| File | Purpose |
|------|---------|
| `src/main.ts` | Core plugin logic |
| `src/settings.ts` | Plugin settings and settings tab |
| `src/modal-load-recipe.ts` | Modal for loading/importing a recipe |
| `src/constants.ts` | Shared constants used across the plugin |

- Keep plugin logic in `src/main.ts`.
- Put new modals in separate `src/modal-*.ts` files.
- Do not add source files outside the `src/` directory.

## Dependencies

- Do **not** add unnecessary dependencies. The plugin must remain lightweight for end users.
- Any new dependency requires discussion and justification before being added.
- Do not modify `manifest.json` or `versions.json` manually — use `npm version`, which runs `version-bump.mjs` automatically.

## Testing

- There are currently no automated tests.
- Write new features using **pure functions** and **dependency injection** so they are easy to unit test in the future.
- Avoid side effects in business logic functions; isolate Obsidian API calls at the edges.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

- `feat:` — new feature
- `fix:` — bug fix
- `chore:` — maintenance (deps, config, tooling)
- `docs:` — documentation only
- `refactor:` — code change with no functional difference
