import React, { memo } from "react";
import type { JSX } from "preact";
import { RecipeNote } from "../types/recipe";

interface RecipeCardProps {
  recipe: RecipeNote;
  /** Open the recipe note. Stable across renders so the card can be memo()'d. */
  onOpen: (path: string) => void;
  /** Toggle selection. Stable across renders so the card can be memo()'d. */
  onSelect?: (path: string) => void;
  isSelected?: boolean;
  /**
   * True when at least one recipe is already selected. Once selection is
   * active, a plain click toggles selection instead of opening the recipe —
   * so only the first card needs a long-press to start a bulk selection.
   */
  selectionActive?: boolean;
}

/**
 * A single recipe card. Wrapped in memo() so that typing in search or toggling
 * one selection only re-renders the cards whose props actually changed — with a
 * few hundred cards live in the DOM that is the difference between a smooth and
 * a janky gallery on mobile. Handlers take `recipe.path` and call out instead of
 * closing over per-card closures, which keeps the props referentially stable.
 */
function RecipeCardComponent({
  recipe,
  onOpen,
  onSelect,
  isSelected = false,
  selectionActive = false,
}: RecipeCardProps) {
  const [imgFailed, setImgFailed] = React.useState(false);
  const holdTimerRef = React.useRef<number | null>(null);
  const didHoldRef = React.useRef(false);

  const handlePointerDown = () => {
    if (!onSelect) return;
    didHoldRef.current = false;
    holdTimerRef.current = window.setTimeout(() => {
      didHoldRef.current = true;
      holdTimerRef.current = null;
      onSelect(recipe.path);
    }, 400);
  };

  const handlePointerUp = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const handlePointerLeave = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const handleClick = () => {
    if (didHoldRef.current) {
      didHoldRef.current = false;
      return;
    }
    // Once a selection is underway, a plain tap toggles selection — only the
    // first recipe needs a long-press to enter selection mode.
    if (isSelected || selectionActive) {
      onSelect?.(recipe.path);
      return;
    }
    onOpen(recipe.path);
  };

  const handleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleClick();
    }
  };

  const className = ["rg-card", isSelected ? "rg-card--selected" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      className={className}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      title={`Open ${recipe.title}`}
      aria-label={`Open ${recipe.title}`}
      role="button"
      tabIndex={0}
    >
      {recipe.photo && !imgFailed ? (
        <img
          className="rg-card-img"
          src={recipe.photo}
          alt={recipe.title}
          loading="lazy"
          decoding="async"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div className="rg-card-img-placeholder">🍽️</div>
      )}

      <div className="rg-card-body">
        <div className="rg-card-title">{recipe.title}</div>

        {recipe.meal_type.length > 0 && (
          <div className="rg-card-tags">
            {recipe.meal_type.map((tag) => (
              <span key={tag} className="rg-tag">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="rg-card-meta">
          {recipe.cook_time ? <span>⏱ {recipe.cook_time}</span> : null}
          <span>✓ {recipe.times_made}×</span>
        </div>
      </div>
    </article>
  );
}

export const RecipeCard = memo(RecipeCardComponent);
