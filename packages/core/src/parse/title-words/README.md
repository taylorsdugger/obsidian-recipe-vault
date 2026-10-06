# Recipe title words

When a recipe gets imported, its title is cleaned up. "The Best Easy Vegan Lasagna" becomes "Lasagna". The words that get removed live here, one file per language.

The recipe's language comes from the page. It checks the recipe's own `inLanguage`, then `<html lang>`, then `og:locale`. If the page doesn't say, it uses the language picked in settings. So a German page only gets the German list, and an English title never loses a word that happens to be German.

## Fixing a word

Open the language's file, edit the list, and open a pull request. You can do the whole thing in GitHub's web editor.

## Adding a language

1. Copy `en.json` to `<code>.json`, where the code is the two-letter ISO 639-1 code (`fr`, `es`, `nl`).
2. Set `name` to what the language calls itself (`Français`), and fill in the three lists.
3. Add the file to `TITLE_WORD_LISTS` in `index.ts`. The tests fail if you forget.

The lists:

- `filler` is marketing words like "easy" and "best".
- `vegan` is vegan and vegetarian labels. These only go when the "Filter vegan words" setting is on.
- `glutenFree` is gluten-free labels, behind their own setting.

## How entries match

Each entry is a regular expression. It matches as a whole word and ignores case. "best" won't touch "Bestseller".

- `one[- ]?pot` matches "one pot", "one-pot" and "onepot".
- `\\s+` in the file means one or more spaces. JSON needs the backslash doubled.
- If your language inflects adjectives, cover the endings. `einfach(e[nmrs]?)?` matches einfach, einfache, einfachen, einfachem, einfacher and einfaches.
- Put longer phrases before the words inside them. `the\\s+best` has to run before `best`, or "the" gets left behind.

Leave out short words that are common in other contexts. Articles like "die" or "the" should only appear as part of a phrase.
