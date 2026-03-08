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
import { QuickScroll } from "./QuickScroll";

type SortMode = "name" | "meal_type" | "cook_time" | "times_made";

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

export function RecipeGallery({ recipes, onOpen }: RecipeGalleryProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [activeSection, setActiveSection] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // Filter by title search
  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return q
      ? recipes.filter((r) => r.title.toLowerCase().includes(q))
      : recipes;
  }, [recipes, searchQuery]);

  // Build grouped sections
  const sections = useMemo(
    () => buildSections(filtered, sortMode),
    [filtered, sortMode],
  );

  const sectionLabels = useMemo(() => sections.map((s) => s.label), [sections]);

  // Track active section via scroll position
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const onScroll = () => {
      const containerTop = container.getBoundingClientRect().top;
      let current = sectionLabels[0] ?? "";
      for (const label of sectionLabels) {
        const el = sectionRefs.current[label];
        if (!el) continue;
        const top = el.getBoundingClientRect().top - containerTop;
        if (top <= 16) current = label;
      }
      setActiveSection(current);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    // Set initial active section
    onScroll();
    return () => container.removeEventListener("scroll", onScroll);
  }, [sectionLabels]);

  // Reset active section when sections change
  useEffect(() => {
    setActiveSection(sectionLabels[0] ?? "");
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [sectionLabels]);

  const handleJump = useCallback((label: string) => {
    const el = sectionRefs.current[label];
    if (el && scrollRef.current) {
      const containerTop = scrollRef.current.getBoundingClientRect().top;
      const elTop = el.getBoundingClientRect().top;
      scrollRef.current.scrollTop += elTop - containerTop - 8;
    }
  }, []);

  const totalCount = filtered.length;
  const showSectionHeader = shouldShowSectionHeader(sortMode);

  return (
    <div className="recipe-gallery-root">
      {/* Toolbar: search + sort tabs */}
      <div className="recipe-gallery-toolbar">
        <input
          className="recipe-gallery-search"
          type="search"
          placeholder={`Search ${recipes.length} recipes…`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="recipe-gallery-sort-tabs">
          {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`rg-sort-tab${sortMode === mode ? " active" : ""}`}
              onClick={() => setSortMode(mode)}
            >
              {SORT_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      {/* Body: masonry + quick scroll */}
      <div className="recipe-gallery-body">
        <div className="recipe-gallery-scroll" ref={scrollRef}>
          {totalCount === 0 ? (
            <div className="recipe-gallery-empty">
              <span style={{ fontSize: 32 }}>🍽️</span>
              <span>
                {searchQuery
                  ? "No recipes match your search."
                  : "No recipes found."}
              </span>
            </div>
          ) : (
            <div className="recipe-gallery-masonry">
              {sections.map((section) => (
                <React.Fragment key={section.label}>
                  {showSectionHeader ? (
                    <div
                      className="rg-section-header"
                      ref={(el) => {
                        sectionRefs.current[section.label] = el;
                      }}
                    >
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
                  {section.recipes.map((recipe, index) => (
                    <RecipeCard
                      key={recipe.path}
                      recipe={recipe}
                      onClick={() => onOpen(recipe.path)}
                      cardRef={
                        !showSectionHeader && index === 0
                          ? (el) => {
                              sectionRefs.current[section.label] = el;
                            }
                          : undefined
                      }
                    />
                  ))}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>

        <QuickScroll
          sections={sectionLabels}
          activeSection={activeSection}
          onJump={handleJump}
        />
      </div>
    </div>
  );
}
