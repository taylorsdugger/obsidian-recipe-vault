import React from "react";
import { RecipeNote } from "../types/recipe";

interface RecipeCardProps {
  recipe: RecipeNote;
  onClick: () => void;
  cardRef?: React.Ref<HTMLElement>;
}

export function RecipeCard({ recipe, onClick, cardRef }: RecipeCardProps) {
  const [imgFailed, setImgFailed] = React.useState(false);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <article
      ref={cardRef}
      className="rg-card"
      onClick={onClick}
      onKeyDown={handleKeyDown}
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
        </div>
      </div>
    </article>
  );
}
