import { formatIsoDuration } from "@recipe-vault/core";
import type {
  CooklangIngredient,
  CooklangRecipe as ParsedCooklang,
  CooklangToken,
  JsonRecord,
  RecipeVaultState,
} from "@recipe-vault/core";

interface CooklangRecipeProps {
  recipe: ParsedCooklang;
  /** The same recipe mapped onto schema.org, for its name and metadata. */
  summary: JsonRecord;
  /** `times made` / `last made` from the front matter. */
  history: RecipeVaultState;
  /** An image next to the file, or the one its front matter links to. */
  imageSrc?: string;
  /** Ticked ingredients, by their place in `recipe.ingredients`. */
  checked: Set<number>;
  onToggle: (index: number) => void;
  onMarkMade: () => void;
  onAddToList: () => void;
  onEdit: () => void;
}

/** "2 tbsp", or "" when the file gives no amount. */
function amountText(item: { quantity: string; unit?: string }): string {
  return [item.quantity, item.unit].filter(Boolean).join(" ");
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

/** "seriouseats.com" for a source link, or the url itself if it won't parse. */
function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** "1/2 cup milk, warmed", the same line a recipe note gets. */
function ingredientText(ingredient: CooklangIngredient): string {
  const line = [amountText(ingredient), ingredient.name]
    .filter(Boolean)
    .join(" ");
  return ingredient.prep ? `${line}, ${ingredient.prep}` : line;
}

/**
 * An ingredient as a checkbox, marked up the way Obsidian renders `- [ ]` so
 * the theme draws it like a recipe note's list.
 */
function IngredientItem({
  ingredient,
  checked,
  onToggle,
}: {
  ingredient: CooklangIngredient;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      className={checked ? "task-list-item is-checked" : "task-list-item"}
      data-task={checked ? "x" : ""}
    >
      <input
        type="checkbox"
        className="task-list-item-checkbox"
        checked={checked}
        onChange={onToggle}
      />
      {ingredientText(ingredient)}
    </li>
  );
}

function Token({ token }: { token: CooklangToken }) {
  switch (token.type) {
    case "text":
      return <>{token.value}</>;
    case "ingredient": {
      const amount = amountText(token);
      return (
        <>
          <span className="cooklang-ingredient">{token.name}</span>
          {amount && (
            <span className="cooklang-inline-amount"> ({amount})</span>
          )}
        </>
      );
    }
    case "cookware":
      return <span className="cooklang-cookware">{token.name}</span>;
    case "timer":
      return (
        <span className="cooklang-timer">
          {amountText(token) || token.name}
        </span>
      );
  }
}

/** A `.cook` file laid out like a recipe note made from the default template. */
export function CooklangRecipe({
  recipe,
  summary,
  history,
  imageSrc,
  checked,
  onToggle,
  onMarkMade,
  onAddToList,
  onEdit,
}: CooklangRecipeProps) {
  const name = asText(summary.name);
  const description = asText(summary.description);
  const url = asText(summary.url);
  const author =
    summary.author && typeof summary.author === "object"
      ? asText((summary.author as JsonRecord).name)
      : "";
  const totalTime = asText(summary.totalTime);
  const tags = asText(summary.keywords)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  const facts: [string, string][] = [
    ["Meal type", asText(summary.recipeCategory)],
    ["Cuisine", asText(summary.recipeCuisine)],
    ["Servings", asText(summary.recipeYield)],
    ["Cook time", totalTime ? formatIsoDuration(totalTime).trim() : ""],
    ["Author", author],
    [
      "Made",
      history.timesMade
        ? `${history.timesMade} time${history.timesMade === 1 ? "" : "s"}` +
          (history.lastMade ? `, last on ${history.lastMade}` : "")
        : "",
    ],
  ];
  const shownFacts = facts.filter(([, value]) => value);
  const isEmpty = recipe.sections.length === 0 && recipe.notes.length === 0;

  // Laid out like the default note template, with Obsidian's own reading-mode
  // classes, so the vault's theme styles it the same as a recipe note.
  return (
    <div className="markdown-preview-view markdown-rendered is-readable-line-width cooklang-recipe">
      <div className="markdown-preview-sizer markdown-preview-section">
        <h1>
          {url ? (
            <a
              className="external-link"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {name}
            </a>
          ) : (
            name
          )}
        </h1>

        <div className="cooklang-actions">
          <button type="button" className="mod-cta" onClick={onMarkMade}>
            Mark as made
          </button>
          <button
            type="button"
            disabled={checked.size === 0}
            onClick={onAddToList}
          >
            {checked.size > 0
              ? `Add ${checked.size} to shopping list`
              : "Add checked to shopping list"}
          </button>
          <button type="button" onClick={onEdit}>
            Edit
          </button>
        </div>

        {imageSrc && <img src={imageSrc} alt={name} />}

        {description && <p>{description}</p>}

        {(shownFacts.length > 0 || url || tags.length > 0) && (
          <div className="callout" data-callout="recipe-meta">
            <div className="callout-title">
              <div className="callout-title-inner">At a Glance</div>
            </div>
            <div className="callout-content">
              {shownFacts.map(([label, value]) => (
                <p key={label}>
                  <strong>{label}</strong>: {value}
                </p>
              ))}
              {url && (
                <p>
                  <strong>Source</strong>:{" "}
                  <a
                    className="external-link"
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {siteName(url)}
                  </a>
                </p>
              )}
              {tags.length > 0 && (
                <p>
                  {tags.map((tag) => (
                    <span key={tag} className="tag cooklang-tag">
                      #{tag}
                    </span>
                  ))}
                </p>
              )}
            </div>
          </div>
        )}

        {isEmpty && <p>No steps yet. Edit the file to add some.</p>}

        {recipe.ingredients.length > 0 && (
          <>
            <h3>Ingredients</h3>
            <ul className="contains-task-list">
              {recipe.ingredients.map((ingredient, i) => (
                <IngredientItem
                  key={i}
                  ingredient={ingredient}
                  checked={checked.has(i)}
                  onToggle={() => onToggle(i)}
                />
              ))}
            </ul>
          </>
        )}

        {recipe.cookware.length > 0 && (
          <>
            <h3>Cookware</h3>
            <ul>
              {recipe.cookware.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        )}

        {recipe.sections.length > 0 && <h3>Instructions</h3>}
        {recipe.sections.map((section, s) => (
          <div key={s}>
            {section.name && <h4>{section.name}</h4>}
            <ul>
              {section.steps.map((step, i) => (
                <li key={i}>
                  {step.tokens.map((token, t) => (
                    <Token key={t} token={token} />
                  ))}
                </li>
              ))}
            </ul>
          </div>
        ))}

        {recipe.notes.length > 0 && (
          <>
            <h3>Notes</h3>
            <blockquote>
              {recipe.notes.map((note, i) => (
                <p key={i}>{note}</p>
              ))}
            </blockquote>
          </>
        )}
      </div>
    </div>
  );
}
