# Community Store Submission

## Pre-Submission Checklist

- Confirm the plugin repository is public and the default branch is up to date.
- Run `npm run build` locally and confirm it succeeds.
- Confirm the release workflow uploads `main.js`, `manifest.json`, and `styles.css`.
- Verify `manifest.json` fields are correct: `id`, `name`, `version`, `minAppVersion`, `author`, and `authorUrl`.
- Verify `versions.json` contains the current plugin version mapped to the correct minimum Obsidian version.
- Review `README.md` for accurate feature, command, and settings documentation.
- Confirm the plugin loads cleanly in Obsidian desktop.
- Confirm the plugin loads cleanly in Obsidian mobile if you intend to support mobile.
- Test the primary flows end to end:
  - Import recipe from URL
  - Add recipe manually
  - Add recipe from image
  - Open Recipe Gallery
  - Mark Recipe as Made
  - Add checked ingredients to shopping list
  - Clear checked items from shopping list
  - Ask AI chat and edit-suggestion flows
- Prepare 2-4 screenshots or a short GIF for the GitHub release and store listing.
- Confirm there are no placeholder links, unfinished UI labels, or debug-only features exposed to users.

## GitHub Release Steps

1. Open GitHub Actions.
2. Run `Tag and Release`.
3. Choose `patch`, `minor`, or `major`.
4. Wait for the workflow to publish the tagged release.
5. Open the GitHub release and verify the uploaded assets:
   - `main.js`
   - `manifest.json`
   - `styles.css`
6. Paste the release notes draft below into the release description.

## Community Plugin Submission Steps

1. Ensure the latest GitHub release is public and includes the built plugin assets.
2. Prepare a short plugin summary and screenshots.
3. Submit a pull request to the Obsidian community plugin list repository with your repository URL and metadata.
4. Monitor review feedback and be ready to answer questions about mobile support, privacy, and external API use.

## Reviewer Notes

- Recipe Vault stores all recipe content in the user's vault.
- AI features are optional and require a user-supplied OpenRouter API key.
- OCR-based image import is available but still described as experimental in the README.
- The plugin does not require an account or hosted backend.

## Short Store Summary

Recipe Vault brings recipe import, manual entry, OCR image capture, a visual gallery, shopping list generation, and optional AI-assisted recipe edits to Obsidian.

## Release Notes Draft

### Recipe Vault 0.24.4

This release focuses on release-readiness, cleanup, and user-facing polish ahead of community store submission.

#### Highlights

- Improved recipe import error handling with clearer messages when a page cannot be fetched or does not include recipe data.
- Prevented failed URL imports from creating empty notes.
- Added full support for applying a custom AI system prompt to both Ask AI chat and edit-suggestion flows.
- Removed the unfinished archived filter and quick-scroll gallery features for a cleaner, more stable release.
- Updated README and settings documentation to reflect current commands and settings.
- Cleaned up package metadata and release-facing polish.

#### Current Feature Set

- Import recipes from web pages using structured recipe metadata
- Scan recipes from photos with OCR review before saving
- Create recipe notes manually from a template
- Browse recipes in a dedicated gallery view
- Track `times_made` and `last_made`
- Send checked ingredients to a shopping list note
- Use OpenRouter-powered AI features for recipe Q&A and edit suggestions

#### Notes

- Image-based OCR import is still considered experimental.
- AI features remain optional and require your own OpenRouter API key.

## Suggested Submission PR Summary

Adds Recipe Vault, an Obsidian plugin for importing, organizing, and editing recipes. The plugin supports URL import, OCR-based image import, manual recipe creation, a gallery view, shopping list generation, and optional AI-assisted recipe editing via OpenRouter.