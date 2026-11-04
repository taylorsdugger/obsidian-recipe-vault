import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { RecipeNote } from "../types/recipe";
import { cookTimeGroup, timesMadeGroup } from "../utils/recipeLoader";
import {
  buildTagGroups,
  capitalize,
  filterByTags,
  groupByNamespace,
  sortableNamespaces,
  type TagMatchMode,
} from "../utils/tagFilter";
import { RecipeCard } from "./RecipeCard";

type BaseSortMode = "name" | "meal_type" | "cook_time" | "times_made";
/** `tag:<namespace>` groups by the tags in one namespace, e.g. `tag:cuisine`. */
export type SortMode = BaseSortMode | `tag:${string}`;

export function isTagSortMode(mode: SortMode): mode is `tag:${string}` {
  return mode.startsWith("tag:");
}

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
  onSearchQueryChange?: (searchQuery: string) => void;
  onSortModeChange?: (sortMode: SortMode) => void;
  initialSelectedTags?: string[];
  initialTagMatchMode?: TagMatchMode;
  onTagFilterChange?: (selectedTags: string[], mode: TagMatchMode) => void;
  /** The folder the gallery is currently reading from (for the empty state). */
  galleryFolder?: string;
  /**
   * A folder that *does* contain recipes when the gallery folder is empty —
   * set when imports are landing somewhere the gallery isn't looking. Drives
   * the "your recipes are over here" hint in the empty state.
   */
  recipesElsewhereFolder?: string;
}

const SORT_LABELS: Record<BaseSortMode, string> = {
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

    default: {
      if (isTagSortMode(sortMode)) {
        return groupByNamespace(recipes, sortMode.slice(4));
      }
      return [{ label: "", recipes }];
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
  onSearchQueryChange,
  onSortModeChange,
  initialSelectedTags = [],
  initialTagMatchMode = "all",
  onTagFilterChange,
  galleryFolder,
  recipesElsewhereFolder,
}: RecipeGalleryProps) {
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [sortMode, setSortMode] = useState<SortMode>(initialSortMode);
  const [toolbarExpanded, setToolbarExpanded] = useState(false);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [selectedTags, setSelectedTags] =
    useState<string[]>(initialSelectedTags);
  const [tagMatchMode, setTagMatchMode] =
    useState<TagMatchMode>(initialTagMatchMode);
  const [tagQuery, setTagQuery] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  const scrollRef = useRef<HTMLDivElement>(null);
  // Stable ref so onScrollTopChange never needs to be a useEffect dependency
  const onScrollTopChangeRef = useRef(onScrollTopChange);
  useEffect(() => {
    onScrollTopChangeRef.current = onScrollTopChange;
  });

  // Filter by search query — matches title, meal type, tags, or ingredients,
  // so typing e.g. "breakfast" surfaces every recipe with that meal type.
  const searched = useMemo(() => {
    const q = searchQuery.toLowerCase().trim().replace(/^#/, "");
    if (!q) return recipes;
    return recipes.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.meal_type.some((t) => t.toLowerCase().includes(q)) ||
        r.tags.some((t) => t.includes(q)) ||
        r.ingredients.some((ing) => ing.toLowerCase().includes(q)),
    );
  }, [recipes, searchQuery]);

  // Then by the toggled tags.
  const filtered = useMemo(
    () => filterByTags(searched, selectedTags, tagMatchMode),
    [searched, selectedTags, tagMatchMode],
  );

  const tagGroups = useMemo(
    () => buildTagGroups(recipes, searched, selectedTags, tagMatchMode),
    [recipes, searched, selectedTags, tagMatchMode],
  );

  const visibleTagGroups = useMemo(() => {
    const q = tagQuery.toLowerCase().trim().replace(/^#/, "");
    if (!q) return tagGroups;
    return tagGroups
      .map((g) => ({ ...g, tags: g.tags.filter((t) => t.tag.includes(q)) }))
      .filter((g) => g.tags.length > 0);
  }, [tagGroups, tagQuery]);

  const tagNamespaces = useMemo(() => sortableNamespaces(recipes), [recipes]);

  const sortOptions = useMemo(
    () => [
      ...(Object.keys(SORT_LABELS) as BaseSortMode[]).map((mode) => ({
        mode: mode,
        label: SORT_LABELS[mode],
      })),
      ...tagNamespaces.map((ns) => ({
        mode: `tag:${ns}` as SortMode,
        label: capitalize(ns),
      })),
    ],
    [tagNamespaces],
  );

  const sortLabel = useCallback(
    (mode: SortMode) =>
      isTagSortMode(mode) ? capitalize(mode.slice(4)) : SORT_LABELS[mode],
    [],
  );

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }, []);

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
    onTagFilterChange?.(selectedTags, tagMatchMode);
  }, [selectedTags, tagMatchMode, onTagFilterChange]);

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
          <button
            type="button"
            className={`rg-sort-toggle${tagsExpanded ? " active" : selectedTags.length > 0 ? " filtered" : ""}`}
            onClick={() => {
              setTagsExpanded((v) => !v);
              setToolbarExpanded(false);
            }}
            title="Filter by tags"
            aria-label="Toggle tag filter"
            aria-expanded={tagsExpanded}
          >
            {selectedTags.length > 0 ? `Tags (${selectedTags.length})` : "Tags"}
          </button>
          <button
            type="button"
            className={`rg-sort-toggle${toolbarExpanded ? " active" : sortMode !== "name" ? " filtered" : ""}`}
            onClick={() => {
              setToolbarExpanded((v) => !v);
              setTagsExpanded(false);
            }}
            title="Sort options"
            aria-label="Toggle sort options"
            aria-expanded={toolbarExpanded}
          >
            {sortMode !== "name" ? sortLabel(sortMode) : "Sort"}
          </button>
        </div>
        {toolbarExpanded && (
          <div className="recipe-gallery-sort-tabs">
            {sortOptions.map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                className={`rg-sort-tab${sortMode === mode ? " active" : ""}`}
                onClick={() => {
                  setSortMode(mode);
                  setToolbarExpanded(false);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {tagsExpanded && (
          <div className="rg-tag-panel">
            <div className="rg-tag-panel-controls">
              <input
                className="rg-tag-search"
                type="search"
                placeholder="Find a tag…"
                value={tagQuery}
                onChange={(e) => setTagQuery(e.currentTarget.value)}
              />
              <div
                className="rg-tag-mode"
                role="radiogroup"
                aria-label="Tag match mode"
              >
                {(["all", "any"] as TagMatchMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={tagMatchMode === mode}
                    className={`rg-tag-mode-btn${tagMatchMode === mode ? " active" : ""}`}
                    title={
                      mode === "all"
                        ? "Show recipes with every selected tag"
                        : "Show recipes with at least one selected tag"
                    }
                    onClick={() => setTagMatchMode(mode)}
                  >
                    {mode === "all" ? "Match all" : "Match any"}
                  </button>
                ))}
              </div>
            </div>
            <div className="rg-tag-groups">
              {visibleTagGroups.length === 0 ? (
                <div className="rg-tag-empty">No tags found.</div>
              ) : (
                visibleTagGroups.map((group) => (
                  <div key={group.namespace} className="rg-tag-group">
                    <div className="rg-tag-group-label">
                      {group.namespace ? capitalize(group.namespace) : "Other"}
                    </div>
                    <div className="rg-tag-chips">
                      {group.tags.map(({ tag, label, count }) => {
                        const active = selectedTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            type="button"
                            className={`rg-tag-chip${active ? " active" : ""}${!active && count === 0 ? " empty" : ""}`}
                            aria-pressed={active}
                            title={`#${tag}`}
                            onClick={() => toggleTag(tag)}
                          >
                            {label}
                            <span className="rg-tag-chip-count">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        {selectedTags.length > 0 && (
          <div className="rg-active-tags">
            {selectedTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="rg-tag-chip active"
                title={`Remove #${tag}`}
                onClick={() => toggleTag(tag)}
              >
                #{tag}
                <span className="rg-tag-chip-remove" aria-hidden="true">
                  ×
                </span>
              </button>
            ))}
            {selectedTags.length > 1 && (
              <span className="rg-active-tags-mode">
                {tagMatchMode === "all" ? "all of these" : "any of these"}
              </span>
            )}
            <button
              type="button"
              className="rg-active-tags-clear"
              onClick={() => setSelectedTags([])}
            >
              Clear
            </button>
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
              {searchQuery || selectedTags.length > 0 ? (
                <span>
                  No recipes match your{" "}
                  {searchQuery && selectedTags.length > 0
                    ? "search and tags"
                    : searchQuery
                      ? "search"
                      : "tags"}
                  .
                </span>
              ) : recipesElsewhereFolder ? (
                <>
                  <span>
                    No recipes in{" "}
                    <code>{galleryFolder || "the gallery folder"}</code>.
                  </span>
                  <span>
                    Your recipes are in <code>{recipesElsewhereFolder}</code>.
                    Set the “Recipe gallery folder” setting to that folder to
                    see them here.
                  </span>
                </>
              ) : (
                <span>No recipes found.</span>
              )}
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
