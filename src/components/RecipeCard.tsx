import React from "react";
import { RecipeNote } from "../types/recipe";

interface RecipeCardProps {
  recipe: RecipeNote;
  onClick: () => void;
  onSelect?: () => void;
  isSelected?: boolean;
  cardRef?: React.Ref<HTMLElement>;
}

export function RecipeCard({
  recipe,
  onClick,
  onSelect,
  isSelected = false,
  cardRef,
}: RecipeCardProps) {
  const [imgFailed, setImgFailed] = React.useState(false);
  const holdTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const didHoldRef = React.useRef(false);

  const handlePointerDown = () => {
    if (!onSelect) return;
    didHoldRef.current = false;
    holdTimerRef.current = setTimeout(() => {
      didHoldRef.current = true;
      holdTimerRef.current = null;
      onSelect();
    }, 400);
  };

  const handlePointerUp = () => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const handlePointerLeave = () => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const handleClick = () => {
    if (didHoldRef.current) {
      didHoldRef.current = false;
      return;
    }
    if (isSelected) {
      onSelect?.();
      return;
    }
    onClick();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleClick();
    }
  };

  const className = [
    "rg-card",
    isSelected ? "rg-card--selected" : "",
    recipe.archived ? "rg-card--archived" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      ref={cardRef}
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
          {recipe.archived && (
            <span className="rg-archived-badge">Archived</span>
          )}
        </div>
      </div>
    </article>
  );
}
