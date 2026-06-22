import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { RecipeNote } from "../types/recipe";
import { cookTimeGroup, timesMadeGroup } from "../utils/recipeLoader";
import { RecipeCard } from "./RecipeCard";

export type SortMode = "name" | "meal_type" | "cook_time" | "times_made";

interface Section {
  label: string;
  recipes: RecipeNote[];
}

function shouldShowSectionHeader(sortMode: SortMode): boolean {
  return sortMode !== "name";
}

interface RecipeGalleryProps {
  recipes: RecipeNote[];
  onOpen: (path: string) => void;
  onCompare?: (selected: RecipeNote[]) => void;
  onOpenInSplit?: (paths: string[]) => void;
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  initialSearchQuery?: string;
  initialSortMode?: SortMode;
  initialMealTypeFilter?: string[];
  onSearchQueryChange?: (searchQuery: string) => void;
  onSortModeChange?: (sortMode: SortMode) => void;
  onMealTypeFilterChange?: (mealTypeFilter: string[]) => void;
}

const SORT_LABELS: Record<SortMode, string> = {
  name: "Name",
  meal_type: "Meal Type",
  cook_time: "Cook Time",
  times_made: "Times Made",
};

const COOK_TIME_ORDER = [
  "Under 15 min",
  "15\u201330 min",
  "30\u201360 min",
  "1\u20132 hr",
  "2+ hr",
  "Unknown",
];

const TIMES_MADE_ORDER = [
  "11+ times",
  "4\u201310 times",
  "1\u20133 times",
  "Never made",
];

function buildSections(recipes: RecipeNote[], sortMode: SortMode): Section[] {
  if (recipes.length === 0) return [];

  switch (sortMode) {
    case "name": {
      const map = new Map<string, RecipeNote[]>();
      const sorted = [...recipes].sort((a, b) =>
        a.title.localeCompare(b.title),
      );
      for (const recipe of sorted) {
        const ch = recipe.title[0]?.toUpperCase() ?? "#";
        const key = /^[A-Z]$/.test(ch) ? ch : "#";
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(recipe);
      }
      return [...map.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, recs]) => ({ label, recipes: recs }));
    }

    case "meal_type": {
      const allTypes = new Set<string>();
      recipes.forEach((r) => r.meal_type.forEach((t) => allTypes.add(t)));
      const sortedTypes = [...allTypes].sort((a, b) => a.localeCompare(b));
      const sections: Section[] = sortedTypes
        .map((type) => ({
          label: type,
          recipes: recipes
            .filter((r) => r.meal_type.includes(type))
            .sort((a, b) => a.title.localeCompare(b.title)),
        }))
        .filter((s) => s.recipes.length > 0);

      const uncategorized = recipes
        .filter((r) => r.meal_type.length === 0)
        .sort((a, b) => a.title.localeCompare(b.title));
      if (uncategorized.length > 0) {
        sections.push({ label: "Uncategorized", recipes: uncategorized });
      }
      return sections;
    }

    case "cook_time": {
      const map = new Map<string, RecipeNote[]>();
      for (const recipe of recipes) {
        const group = cookTimeGroup(recipe.cook_time_mins);
        if (!map.has(group)) map.set(group, []);
        map.get(group)!.push(recipe);
      }
      return COOK_TIME_ORDER.filter((g) => map.has(g)).map((g) => ({
        label: g,
        recipes: map
          .get(g)!
          .sort((a, b) => a.cook_time_mins - b.cook_time_mins),
      }));
    }

    case "times_made": {
      const map = new Map<string, RecipeNote[]>();
      for (const recipe of recipes) {
        const group = timesMadeGroup(recipe.times_made);
        if (!map.has(group)) map.set(group, []);
        map.get(group)!.push(recipe);
      }
      return TIMES_MADE_ORDER.filter((g) => map.has(g)).map((g) => ({
        label: g,
        recipes: map.get(g)!.sort((a, b) => b.times_made - a.times_made),
      }));
    }
  }
}

export function RecipeGallery({
  recipes,
  onOpen,
  onCompare,
  onOpenInSplit,
  initialScrollTop = 0,
  onScrollTopChange,
  initialSearchQuery = "",
  initialSortMode = "name",
  initialMealTypeFilter = [],
  onSearchQueryChange,
  onSortModeChange,
  onMealTypeFilterChange,
}: RecipeGalleryProps) {
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [sortMode, setSortMode] = useState<SortMode>(initialSortMode);
  const [mealTypeFilter, setMealTypeFilter] = useState<string[]>(
    initialMealTypeFilter,
  );
  const [toolbarExpanded, setToolbarExpanded] = useState(false);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  const scrollRef = useRef<HTMLDivElement>(null);
  // Stable ref so onScrollTopChange never needs to be a useEffect dependency
  const onScrollTopChangeRef = useRef(onScrollTopChange);
  useEffect(() => {
    onScrollTopChangeRef.current = onScrollTopChange;
  });

  // All meal types present across the (unfiltered) recipe set, for the chip row.
  const availableMealTypes = useMemo(() => {
    const set = new Set<string>();
    recipes.forEach((r) => r.meal_type.forEach((t) => set.add(t)));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [recipes]);

  // Drop any selected meal type that no longer exists (e.g. after a retag/delete).
  useEffect(() => {
    setMealTypeFilter((prev) => {
      const next = prev.filter((t) => availableMealTypes.includes(t));
      return next.length === prev.length ? prev : next;
    });
  }, [availableMealTypes]);

  // Filter by search query (title or ingredients) and selected meal types (OR).
  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return recipes.filter((r) => {
      if (
        q &&
        !r.title.toLowerCase().includes(q) &&
        !r.ingredients.some((ing) => ing.toLowerCase().includes(q))
      ) {
        return false;
      }
      if (
        mealTypeFilter.length > 0 &&
        !mealTypeFilter.some((t) => r.meal_type.includes(t))
      ) {
        return false;
      }
      return true;
    });
  }, [recipes, searchQuery, mealTypeFilter]);

  // Build grouped sections
  const sections = useMemo(
    () => buildSections(filtered, sortMode),
    [filtered, sortMode],
  );

  const sectionLabels = useMemo(() => sections.map((s) => s.label), [sections]);

  useEffect(() => {
    onSearchQueryChange?.(searchQuery);
  }, [searchQuery, onSearchQueryChange]);

  useEffect(() => {
    onSortModeChange?.(sortMode);
  }, [sortMode, onSortModeChange]);

  useEffect(() => {
    onMealTypeFilterChange?.(mealTypeFilter);
  }, [mealTypeFilter, onMealTypeFilterChange]);

  const toggleMealType = useCallback((type: string) => {
    setMealTypeFilter((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }, []);

  const handleSelect = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleCompare = useCallback(() => {
    const selected = recipes.filter((r) => selectedPaths.has(r.path));
    onCompare?.(selected);
  }, [recipes, selectedPaths, onCompare]);

  // Track active section via scroll position
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    if (initialScrollTop > 0) {
      container.scrollTop = initialScrollTop;
    }

    const updateScroll = () => {
      onScrollTopChangeRef.current?.(container.scrollTop);
    };

    const onScroll = () => {
      updateScroll();
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    updateScroll();
    return () => {
      container.removeEventListener("scroll", onScroll);
    };
  }, [sectionLabels, initialScrollTop]);

  // Reset scroll when sections change and no restored scroll position exists.
  useEffect(() => {
    if (initialScrollTop > 0) {
      return;
    }
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [sectionLabels, initialScrollTop]);

  const totalCount = filtered.length;
  const showSectionHeader = shouldShowSectionHeader(sortMode);

  return (
    <div className="recipe-gallery-root">
      {/* Toolbar: search + collapsible sort tabs */}
      <div className="recipe-gallery-toolbar">
        <div className="rg-toolbar-top">
          <input
            className="recipe-gallery-search"
            type="search"
            placeholder={`Search ${recipes.length} recipes…`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.currentTarget.value)}
          />
          {availableMealTypes.length > 0 && (
            <button
              type="button"
              className={`rg-sort-toggle${filterExpanded ? " active" : mealTypeFilter.length > 0 ? " filtered" : ""}`}
              onClick={() => {
                setFilterExpanded((v) => !v);
                setToolbarExpanded(false);
              }}
              title="Filter by meal type"
              aria-label="Toggle meal type filter"
              aria-expanded={filterExpanded}
            >
              {mealTypeFilter.length > 0
                ? `Filter (${mealTypeFilter.length})`
                : "Filter"}
            </button>
          )}
          <button
            type="button"
            className={`rg-sort-toggle${toolbarExpanded ? " active" : sortMode !== "name" ? " filtered" : ""}`}
            onClick={() => {
              setToolbarExpanded((v) => !v);
              setFilterExpanded(false);
            }}
            title="Sort options"
            aria-label="Toggle sort options"
            aria-expanded={toolbarExpanded}
          >
            {sortMode !== "name" ? SORT_LABELS[sortMode] : "Sort"}
          </button>
        </div>
        {filterExpanded && availableMealTypes.length > 0 && (
          <div
            className="rg-filter-row"
            role="group"
            aria-label="Filter by meal type"
          >
            <button
              type="button"
              className={`rg-filter-chip${mealTypeFilter.length === 0 ? " active" : ""}`}
              aria-pressed={mealTypeFilter.length === 0}
              onClick={() => setMealTypeFilter([])}
            >
              All
            </button>
            {availableMealTypes.map((type) => (
              <button
                key={type}
                type="button"
                className={`rg-filter-chip${mealTypeFilter.includes(type) ? " active" : ""}`}
                aria-pressed={mealTypeFilter.includes(type)}
                onClick={() => toggleMealType(type)}
              >
                {type}
              </button>
            ))}
          </div>
        )}
        {toolbarExpanded && (
          <div className="recipe-gallery-sort-tabs">
            {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`rg-sort-tab${sortMode === mode ? " active" : ""}`}
                onClick={() => {
                  setSortMode(mode);
                  setToolbarExpanded(false);
                }}
              >
                {SORT_LABELS[mode]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Compare bar — appears when at least one recipe is selected */}
      {selectedPaths.size >= 1 && (
        <div className="rg-compare-bar">
          <span className="rg-compare-count">
            {selectedPaths.size} selected
          </span>
          {selectedPaths.size >= 2 && (
            <button
              type="button"
              className="rg-compare-btn mod-cta"
              onClick={handleCompare}
            >
              Compare Recipes
            </button>
          )}
          {onOpenInSplit && (
            <button
              type="button"
              className="rg-compare-btn"
              onClick={() => {
                onOpenInSplit([...selectedPaths]);
                setSelectedPaths(new Set());
              }}
            >
              Open in split
            </button>
          )}
          <button
            type="button"
            className="rg-compare-clear"
            onClick={() => setSelectedPaths(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      {/* Body: masonry */}
      <div className="recipe-gallery-body">
        <div className="recipe-gallery-scroll" ref={scrollRef}>
          {totalCount === 0 ? (
            <div className="recipe-gallery-empty">
              <span style={{ fontSize: 32 }}>🍽️</span>
              <span>
                {searchQuery || mealTypeFilter.length > 0
                  ? "No recipes match your filters."
                  : "No recipes found."}
              </span>
            </div>
          ) : (
            <div className="recipe-gallery-masonry">
              {sections.map((section) => (
                <React.Fragment key={section.label}>
                  {showSectionHeader ? (
                    <div className="rg-section-header">
                      {section.label}
                      <span
                        style={{
                          fontWeight: 400,
                          marginLeft: 6,
                          opacity: 0.6,
                        }}
                      >
                        ({section.recipes.length})
                      </span>
                    </div>
                  ) : null}
                  {section.recipes.map((recipe) => (
                    <RecipeCard
                      key={recipe.path}
                      recipe={recipe}
                      onOpen={onOpen}
                      onSelect={handleSelect}
                      isSelected={selectedPaths.has(recipe.path)}
                      selectionActive={selectedPaths.size >= 1}
                    />
                  ))}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
