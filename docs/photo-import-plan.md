# Implementation Plan: "Add recipe from photo" (AI vision OCR)

> **Status:** IMPLEMENTED 2026-07-07 on `main`. Code, tests, build all green.
> Remaining: manual camera test on desktop + mobile, then ship (Step 7).
> **Branch when written:** `htmlMicrodata` (implemented on `main`; keychain
> migration had NOT landed, so the plaintext `openRouterApiKey` path was used).
> **Author of plan:** research + design session 2026-07-07.
>
> **Implementation notes / deviations:**
> - Step 3 refactor was NOT applied to `addRecipeToMarkdown`. That function is
>   coupled to the active editor `view` and appends multiple recipes into one
>   note, so a "behavior-preserving" extraction would actually change behavior.
>   Instead `saveParsedRecipe` is a standalone method (new note per recipe,
>   Vault API only) reusing the same template + frontmatter/notes helpers.
> - Modal `onSubmit` returns `{ result: RecipeFromImageResult; imageBlob? }`
>   (the edited transcription), not a pre-built `ParsedRecipe`; the command
>   callback maps it to `ParsedRecipe` (instruction strings → `{ text }`).
>   This keeps the modal decoupled from main.ts internals.
> - Local image save reuses `detectImageType` + `getAvailablePathForAttachments`
>   + `createThumbnail` (gallery thumbnail generated for the attached photo).
> - Files: `src/utils/openrouter.ts` (+`requestRecipeFromImage`),
>   `src/modal-photo-recipe.ts` (new), `src/main.ts` (`saveParsedRecipe`,
>   `saveLocalRecipeImage`, command), `src/constants.ts`, `src/settings.ts`,
>   `src/tailwind.input.css`, `test/recipe-from-image.test.ts` (new, 11 tests).

## Goal

A command + modal that lets the user photograph a cookbook page (or pick image
files), sends the image(s) to a vision LLM via the **existing OpenRouter path**,
and produces a normal Recipe Vault note — with a verify/edit step before saving.
Must work on **desktop and mobile** (mobile camera capture is the whole point).
No bundled OCR engine, no remote code loading.

## Why this approach (context for a cold pickup)

- OCR was previously implemented with **tesseract.js + a regex heuristic parser**
  and **removed on 2026-06-18** (commit `cc81003`) before the Obsidian community
  submission. It loaded WASM + `eng.traineddata` from a CDN at runtime →
  reviewers flag remote executable code; it also never worked on mobile/offline,
  and the regex parser was fragile on multi-column book pages.
  (See memory `ocr-dropped-for-v1-release`.)
- **This plan does NOT re-add tesseract.** It uses a vision LLM, which does OCR
  *and* structured extraction in one call, handles columns/fractions/handwriting,
  and rides the **already-review-approved** OpenRouter `requestUrl` path.
- The plugin already: sends OpenRouter chat requests via `requestUrl`, resolves a
  model, and defaults to `google/gemini-2.5-flash-lite` — which is already
  vision-capable. Cost is ~$0.001–0.0025 per recipe. Users bring their own key.

## Locked decisions

1. **Multi-page: YES.** Support multiple images per recipe (book recipes span
   pages). Falls out for free — send multiple `image_url` entries in one content
   array.
2. **Auto-attach source photo: YES, by default.** The captured photo becomes the
   recipe's image unless the user picks a different one or none in the modal.

## Branch-state caveat (verify first!)

On the `htmlMicrodata` branch at plan time, settings use a **plaintext
`openRouterApiKey`** and there is **no `aiChatEnabled` toggle**. The keychain /
`aiChatEnabled` work described in memory `obsidian-review-lint-fixes` is NOT on
this branch. **Re-check `src/settings.ts` `PluginSettings` before coding** — if
the keychain migration has since landed, read the key via
`resolveOpenRouterApiKey()` instead of `this.settings.openRouterApiKey`.

## Design principle

Reuse everything. The photo path converges on the same
`ParsedRecipe → render → save` pipeline the URL importer uses. New code = one
request function + one modal + one command + a small refactor.

---

## Integration map (actual code locations, verify before editing)

- `addRecipeToMarkdown(url)` — `src/main.ts:1725`. Does `fetchRecipes(url)` →
  `ParsedRecipe[]`, then creates file + handlebars render + image download +
  write (roughly lines 1780–1930). **This tail is what the photo path reuses.**
- `resolveAiModelId()` — `src/main.ts:759`. Returns the model id (default
  `google/gemini-2.5-flash-lite`).
- Existing OpenRouter functions + shared helpers (`getErrorMessage`,
  `extractJsonBlock`, `OpenRouterResponse`, timeout-race) — `src/utils/openrouter.ts`.
- Command registrations — `src/main.ts` `onload`, near `src/main.ts:859`
  (`CMD_OPEN_MODAL` "Import recipe").
- Command id constants — `src/constants.ts`.
- Old (deleted) OCR modal to adapt — `git show 272553c:src/modal-image-recipe.ts`.
  It already had the 3-step pick → edit → image flow.
- Settings interface + defaults — `src/settings.ts:12` (`PluginSettings`) and
  `src/settings.ts:46` (`DEFAULT_SETTINGS`); model presets at `src/settings.ts:37`.
- Test style to mirror — `test/fetch-recipes.*.test.ts` (Vitest 3, `requestUrl`
  mocked, `obsidian` aliased to a stub — see memory `test-harness-setup`).

---

## Step 1 — Vision request function (`src/utils/openrouter.ts`, append)

Reuse `getErrorMessage`, `extractJsonBlock`, `OpenRouterResponse`, and the
`Promise.race` timeout pattern already in this file.

```ts
export interface RecipeFromImageRequest {
  apiKey: string;
  model: string;
  images: string[];        // base64 data URLs: "data:image/jpeg;base64,..."
  timeoutMs: number;
  systemPrompt?: string;
}
export interface RecipeFromImageResult {
  name: string;
  recipeIngredient: string[];
  recipeInstructions: string[];
  totalTime: string;
  recipeYield?: string;
  author?: string;
  description?: string;
}
export async function requestRecipeFromImage(
  req: RecipeFromImageRequest,
): Promise<RecipeFromImageResult>;
```

Details:
- **User message content is an array**: one `{ type: "text", text: <instruction+schema> }`
  followed by one `{ type: "image_url", image_url: { url: dataUrl } }` per image.
  This is the OpenAI-compatible shape OpenRouter requires.
- POST to `https://openrouter.ai/api/v1/chat/completions` with
  `response_format: { type: "json_object" }`, `temperature: 0.2`, `throw: false`.
- **System prompt**: "You transcribe recipes from photos of cookbook pages or
  cards. Return ONLY JSON matching this shape: {schema}. Preserve fractions and
  exact quantities. Combine ingredient lines that wrap. If a field is absent, use
  an empty string/array. Do not invent ingredients or steps." Prepend the user's
  `systemPrompt` if set (mirror `buildMessages` in the same file).
- **Parse**: `extractJsonBlock` → `JSON.parse` → validate non-empty
  `recipeIngredient` and `recipeInstructions` (mirror `parseSuggestionPayload`,
  throw friendly errors). Coerce with the existing `cleanStringList` helper.
- Error mapping via `getErrorMessage(status, body?.error?.message)`.

## Step 2 — Capture + verify modal (`src/modal-photo-recipe.ts`, new)

Adapt the deleted `modal-image-recipe.ts` (3-step). Swap the tesseract call for
an injected `onExtract` callback so main.ts owns key/model/network (same wiring
style as `RefineRecipeModal`).

- **Step 1 — Capture**: `<input type="file" accept="image/*" capture="environment" multiple>`.
  On mobile, `capture="environment"` opens the camera. Show thumbnail(s). Read
  each `File` → `arrayBuffer` → base64 data URL (keep the mime type). "Extract
  recipe" button. Support multiple images (multi-page = decision #1).
- **Step 2 — Verify/edit** (safety net for misreads): loading `Notice` while
  `onExtract(images)` runs, then an editable form prefilled from the result:
  name (text), ingredients (textarea, one per line), instructions (textarea, one
  per line), time, yield. Split/join on newlines.
- **Step 3 — Photo choice**: default = **attach the first captured photo** as the
  recipe image (decision #2); options to pick a different image or none. Reuse the
  old modal's image-choice logic.
- **Returns** `{ recipe: ParsedRecipe, imageBlob?: Blob }` via `onSubmit`.

Modal constructor shape:
```ts
new PhotoRecipeModal(
  app,
  (images: string[]) => Promise<RecipeFromImageResult>,   // onExtract
  (result: { recipe: ParsedRecipe; imageBlob?: Blob }) => void,  // onSubmit
)
```

## Step 3 — Refactor the save tail (`src/main.ts`)

Extract the reusable render+save portion of `addRecipeToMarkdown` (~lines
1780–1930) into:

```ts
private async saveParsedRecipe(
  recipe: ParsedRecipe,
  opts?: { localImage?: Blob },
): Promise<TFile | null>
```

- Does: filename from `recipe.name` (reuse the disallowed-char strip at
  `src/main.ts:1755`), `folderCheck`, `vault.create`, `handlebars.compile(
  this.settings.recipeTemplate)` render, existing image handling, write.
- `addRecipeToMarkdown` keeps its fetch + multi-recipe loop and calls
  `saveParsedRecipe` per recipe. **Behavior-preserving** — guard with the
  existing `test/fetch-recipes.notes.test.ts` etc.
- **`localImage` handling**: `await this.app.vault.createBinary(path, await
  blob.arrayBuffer())` into `this.settings.imgFolder`; set `recipe.image` to that
  vault path so the template `{{#if image}}` block renders it. Use the Vault API
  (not `FileSystemAdapter`) so mobile works. `recipe.url` stays empty — template
  already guards `{{#if url}}`.

## Step 4 — Command wiring (`src/constants.ts` + `src/main.ts`)

- `constants.ts`: `export const CMD_RECIPE_FROM_PHOTO = "cmd-recipe-from-photo";`
- `main.ts` `onload`, next to the other `addCommand`s:
```ts
this.addCommand({
  id: c.CMD_RECIPE_FROM_PHOTO,
  name: "Add recipe from photo",
  callback: () => {
    const apiKey = this.settings.openRouterApiKey?.trim();  // or resolveOpenRouterApiKey()
    if (!apiKey) {
      new Notice("Set your OpenRouter API key in Recipe Vault settings first.");
      return;
    }
    const model = this.resolveAiModelId();
    const timeoutMs = Math.max(this.settings.aiTimeoutMs ?? 45000, 5000);
    new PhotoRecipeModal(
      this.app,
      (images) => requestRecipeFromImage({ apiKey, model, images, timeoutMs, systemPrompt: this.settings.aiSystemPrompt }),
      (result) => void this.saveParsedRecipe(result.recipe, { localImage: result.imageBlob }),
    ).open();
  },
});
```

## Step 5 — Settings (`src/settings.ts`, minimal)

No new required settings — reuse `openRouterApiKey` + model presets. Optional: a
one-line note under the AI section, "Also powers Add recipe from photo." (Only
add a dedicated `photoImportEnabled` toggle if desired later; not needed for v1.)

## Step 6 — Tests (`test/recipe-from-image.test.ts`, new)

Mirror the `requestUrl`-mock style of `test/fetch-recipes.*.test.ts`:
- Valid JSON response → correct `RecipeFromImageResult`.
- JSON fenced in markdown → still parses (`extractJsonBlock`).
- Empty ingredients/instructions → throws friendly error.
- Non-2xx (401 / 429 / 5xx) → mapped error message.
- Multiple images → content array has N `image_url` entries.

## Step 7 — Verify & ship

- `npm test`, `npm run build`.
- Manual: real cookbook photo on **desktop AND mobile** (camera path is the point).
- Compliance: no CDN/WASM/remote code → should pass `eslint-plugin-obsidianmd`
  (the exact blocker that killed the old OCR). Keep `isDesktopOnly: false`.
- `main.js` is gitignored; the online review scans the release artifact — after
  building, attach the rebuilt `main.js` to a new GitHub release for the online
  check to re-run. (See memory `obsidian-review-lint-fixes`.)

---

## Cost/model notes

- Default `google/gemini-2.5-flash-lite` is vision-capable and ~$0.001/recipe.
- Model preset UI already lets power users switch to Claude/GPT for tough
  handwritten cards. No changes needed there.

## Scope estimate

~1 util function, ~1 modal (mostly a copy of the deleted one), ~1 command, 1
small refactor, 1 test file. ~1 day, low risk — auth/networking/save/compliance
already exist.

## Open items for the implementer

- Confirm branch + whether keychain key migration has landed (see caveat above).
- Decide image downscaling: consider capping the longest edge (~1500px) before
  base64 to cut tokens/upload size on mobile — optional polish, not required.
