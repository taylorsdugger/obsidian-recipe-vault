import { useEffect, useRef } from "react";
import { setIcon } from "obsidian";
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
  onCook: () => void;
  /** `rail` lays out in two columns once the pane is wide enough. */
  layout: "rail" | "kitchen";
  /** The Kitchen layout's Ingredients / Steps switch. */
  tab: "ingredients" | "steps";
  onTab: (tab: "ingredients" | "steps") => void;
  /** Where a recipe reference points in the vault, or null if nowhere. */
  linkFor: (reference: string) => string | null;
  onOpenLink: (path: string, event: MouseEvent) => void;
}

interface LinkProps {
  linkFor: CooklangRecipeProps["linkFor"];
  onOpenLink: CooklangRecipeProps["onOpenLink"];
}

/**
 * Another recipe used as an ingredient, as an Obsidian-style internal link.
 * One that doesn't resolve looks like an unresolved `[[link]]`.
 */
function RecipeLink({
  name,
  reference,
  linkFor,
  onOpenLink,
  className,
}: LinkProps & { name: string; reference: string; className?: string }) {
  const target = linkFor(reference);
  return (
    <a
      className={[
        "internal-link",
        target ? "" : "is-unresolved",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      href={target ?? reference}
      data-href={target ?? reference}
      onClick={(event) => {
        event.preventDefault();
        if (target) onOpenLink(target, event);
      }}
    >
      {name}
    </a>
  );
}

/** "2 tbsp", or "" when the file gives no amount. */
export function amountText(item: { quantity: string; unit?: string }): string {
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
export function ingredientText(ingredient: CooklangIngredient): string {
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
  linkFor,
  onOpenLink,
}: LinkProps & {
  ingredient: CooklangIngredient;
  checked: boolean;
  onToggle: () => void;
}) {
  if (ingredient.recipe) {
    const amount = amountText(ingredient);
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
        <span className="recipe-item-text">
          {amount && `${amount} `}
          <RecipeLink
            name={ingredient.name}
            reference={ingredient.recipe}
            linkFor={linkFor}
            onOpenLink={onOpenLink}
          />
          {ingredient.prep && `, ${ingredient.prep}`}
        </span>
      </li>
    );
  }
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
      <span className="recipe-item-text">{ingredientText(ingredient)}</span>
    </li>
  );
}

function Token({
  token,
  linkFor,
  onOpenLink,
}: LinkProps & { token: CooklangToken }) {
  switch (token.type) {
    case "text":
      return <>{token.value}</>;
    case "ingredient": {
      const amount = amountText(token);
      return (
        <>
          {token.recipe ? (
            <RecipeLink
              name={token.name}
              reference={token.recipe}
              linkFor={linkFor}
              onOpenLink={onOpenLink}
              className="cooklang-ingredient"
            />
          ) : (
            <span className="cooklang-ingredient">{token.name}</span>
          )}
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

/** An Obsidian (lucide) icon. */
function Icon({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) setIcon(ref.current, name);
  }, [name]);
  return <span className="recipe-button-icon" ref={ref} />;
}

/**
 * A `.cook` file laid out like a recipe note made from the default template,
 * with the same class names, so the same css gives it the rail on a wide
 * pane and the Kitchen layout on a phone.
 *
 * The hero and ingredients render twice: once in the rail, once in the
 * single column. CSS shows whichever fits the pane.
 */
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
  onCook,
  layout,
  tab,
  onTab,
  linkFor,
  onOpenLink,
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
  const kitchen = layout === "kitchen";
  const stepCount = recipe.sections.reduce((n, s) => n + s.steps.length, 0);

  const hero = imageSrc ? (
    <div className="recipe-hero">
      <img src={imageSrc} alt={name} />
    </div>
  ) : null;

  const ingredientList = (
    <ul className="contains-task-list">
      {recipe.ingredients.map((ingredient, i) => (
        <IngredientItem
          key={i}
          ingredient={ingredient}
          checked={checked.has(i)}
          onToggle={() => onToggle(i)}
          linkFor={linkFor}
          onOpenLink={onOpenLink}
        />
      ))}
    </ul>
  );

  const addText =
    checked.size > 0
      ? kitchen
        ? `Add ${checked.size} to list`
        : `Add ${checked.size} to shopping list`
      : kitchen
        ? "Add to list"
        : "Add checked to shopping list";

  /**
   * The whole row ticks, like a note's rows do. A link inside it still
   * opens instead.
   */
  const toggleRow = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target || target.closest("a, input, button")) return;
    target
      .closest("li.task-list-item")
      ?.querySelector<HTMLInputElement>("input.task-list-item-checkbox")
      ?.click();
  };

  // Obsidian's own reading-mode classes, so the vault's theme styles it the
  // same as a recipe note.
  return (
    <div
      className={[
        "markdown-preview-view markdown-rendered is-readable-line-width",
        "cooklang-recipe recipe-note",
        kitchen ? "recipe-layout-kitchen" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-recipe-tab={kitchen ? tab : undefined}
      onClick={toggleRow}
    >
      {kitchen && (
        <div className="recipe-tabs">
          <div
            className="recipe-tabs-track"
            role="tablist"
            aria-label="Recipe sections"
          >
            {(
              [
                ["ingredients", "Ingredients", recipe.ingredients.length],
                ["steps", "Steps", stepCount],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                role="tab"
                className="recipe-tab"
                aria-selected={tab === key}
                onClick={() => onTab(key)}
              >
                <span>{label}</span>
                <span className="recipe-tab-count">{count || ""}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="recipe-tabs-cook"
            onClick={onCook}
            disabled={stepCount === 0}
          >
            <Icon name="flame" />
            <span className="recipe-button-text">Cook</span>
          </button>
        </div>
      )}

      <div className="recipe-layout">
        {!kitchen && (
          <aside className="recipe-rail">
            {hero}
            {recipe.ingredients.length > 0 && (
              <>
                <div className="recipe-rail-head">
                  <h3>Ingredients</h3>
                  <span className="recipe-rail-count">
                    {checked.size} of {recipe.ingredients.length} picked
                  </span>
                </div>
                <div className="recipe-rail-list">{ingredientList}</div>
              </>
            )}
          </aside>
        )}

        <div className="markdown-preview-sizer markdown-preview-section recipe-main">
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

          {hero && <div data-recipe-section="hero">{hero}</div>}

          {description && <p>{description}</p>}

          {(shownFacts.length > 0 || url || tags.length > 0) && (
            <div data-recipe-section="meta">
              <div className="callout" data-callout="recipe-meta">
                <div className="callout-title">
                  <div className="callout-title-inner">At a Glance</div>
                </div>
                <div className="callout-content">
                  <div className="recipe-meta-grid">
                    {shownFacts.map(([label, value]) => (
                      <div key={label} className="recipe-meta-item">
                        <strong>{label}</strong>: {value}
                      </div>
                    ))}
                    {url && (
                      <div className="recipe-meta-item">
                        <strong>Source</strong>:{" "}
                        <a
                          className="external-link"
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {siteName(url)}
                        </a>
                      </div>
                    )}
                  </div>
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
            </div>
          )}

          <div className="recipe-note-actions">
            <button type="button" onClick={onMarkMade}>
              <Icon name="circle-check" />
              <span className="recipe-button-text">Mark as made</span>
            </button>
            <button
              type="button"
              className="mod-cta"
              disabled={checked.size === 0}
              onClick={onAddToList}
            >
              <Icon name="shopping-cart" />
              <span className="recipe-button-text">{addText}</span>
            </button>
            <button type="button" onClick={onCook} disabled={stepCount === 0}>
              <Icon name="flame" />
              <span className="recipe-button-text">Cook</span>
            </button>
            <button type="button" onClick={onEdit}>
              <Icon name="pencil" />
              <span className="recipe-button-text">Edit</span>
            </button>
          </div>

          {isEmpty && <p>No steps yet. Edit the file to add some.</p>}

          {recipe.ingredients.length > 0 && (
            <div data-recipe-section="ingredients">
              <h3>Ingredients</h3>
              {ingredientList}
            </div>
          )}

          {recipe.cookware.length > 0 && (
            <div data-recipe-section="cookware">
              <h3>Cookware</h3>
              <ul>
                {recipe.cookware.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {recipe.sections.length > 0 && (
            <div data-recipe-section="instructions">
              <h3>Instructions</h3>
              {recipe.sections.map((section, s) => (
                <div key={s}>
                  {section.name && <h4>{section.name}</h4>}
                  <ul>
                    {section.steps.map((step, i) => (
                      <li key={i}>
                        {step.tokens.map((token, t) => (
                          <Token
                            key={t}
                            token={token}
                            linkFor={linkFor}
                            onOpenLink={onOpenLink}
                          />
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {recipe.notes.length > 0 && (
            <div data-recipe-section="notes">
              <h3>Notes</h3>
              <blockquote>
                {recipe.notes.map((note, i) => (
                  <p key={i}>{note}</p>
                ))}
              </blockquote>
            </div>
          )}
        </div>
      </div>

      {kitchen && (
        <div className="recipe-dock">
          <button
            type="button"
            className="recipe-dock-icon"
            aria-label="Mark as made"
            onClick={onMarkMade}
          >
            <Icon name="circle-check" />
          </button>
          <button
            type="button"
            className="mod-cta recipe-add-button"
            disabled={checked.size === 0}
            onClick={onAddToList}
          >
            <Icon name="shopping-cart" />
            <span className="recipe-button-text">{addText}</span>
          </button>
        </div>
      )}
    </div>
  );
}
