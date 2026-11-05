import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { RecipeNote } from "../types/recipe";
import {
  cookTimeGroup,
  createdGroup,
  createdGroupRank,
  timesMadeGroup,
} from "../utils/recipeLoader";
import {
  COOK_TIME_ORDER,
  facetChips,
  filterByFacets,
  hasFacetSelection,
  isFacetKey,
  nameGroup,
  TIMES_MADE_ORDER,
  UNCATEGORIZED,
  type FacetKey,
  type FacetSelections,
} from "../utils/facets";
import {
  buildTagGroups,
  capitalize,
  filterByTags,
  groupByNamespace,
  sortableNamespaces,
  type TagMatchMode,
} from "../utils/tagFilter";
import {
  applyOrder,
  DEFAULT_ORDER,
  dirLabel,
  isOrderField,
  NATURAL_DIR,
  ORDER_FIELDS,
  ORDER_LABELS,
  type RecipeOrder,
} from "../utils/order";
import { RecipeCard } from "./RecipeCard";

type BaseSortMode =
  | "name"
  | "meal_type"
  | "cook_time"
  | "times_made"
  | "created";
/** `tag:<namespace>` groups by the tags in one namespace, e.g. `tag:cuisine`. */
export type SortMode = BaseSortMode | `tag:${string}`;

export function isTagSortMode(mode: SortMode): mode is `tag:${string}` {
  return mode.startsWith("tag:");
}

interface Section {
  label: string;
  recipes: RecipeNote[];
}

function shouldShowSectionHeader(
  sortMode: SortMode,
  sections: Section[],
): boolean {
  return sortMode !== "name" && sections.some((s) => s.label !== "");
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
  initialFacetSelections?: FacetSelections;
  onFacetFilterChange?: (selections: FacetSelections) => void;
  initialOrder?: RecipeOrder;
  onOrderChange?: (order: RecipeOrder) => void;
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
  created: "Recently Added",
};

/** What a facet chip panel's open-state key looks like. */
const facetPanel = (key: FacetKey) => `facet:${key}`;

function buildSections(
  recipes: RecipeNote[],
  sortMode: SortMode,
  selectedTags: readonly string[] = [],
  facetSelections: FacetSelections = {},
): Section[] {
  if (recipes.length === 0) return [];

  switch (sortMode) {
    case "name": {
      const map = new Map<string, RecipeNote[]>();
      const sorted = [...recipes].sort((a, b) =>
        a.title.localeCompare(b.title),
      );
      for (const recipe of sorted) {
        const key = nameGroup(recipe.title);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(recipe);
      }
      return [...map.entries()]
        .sort(([a], [b]) =>
          a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b),
        )
        .map(([label, recs]) => ({ label, recipes: recs }));
    }

    case "meal_type": {
      const allTypes = new Set<string>();
      recipes.forEach((r) => r.meal_type.forEach((t) => allTypes.add(t)));
      // With meal types picked, a recipe that is also e.g. "Lunch" shouldn't
      // bring a Lunch section along.
      const picked = facetSelections.meal_type ?? [];
      const sortedTypes = [...allTypes]
        .filter((t) => picked.length === 0 || picked.includes(t))
        .sort((a, b) => a.localeCompare(b));
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
      if (
        uncategorized.length > 0 &&
        (picked.length === 0 || picked.includes(UNCATEGORIZED))
      ) {
        sections.push({ label: UNCATEGORIZED, recipes: uncategorized });
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

    case "created": {
      // Newest first, one section per month; undated recipes last.
      const map = new Map<string, RecipeNote[]>();
      const sorted = [...recipes].sort(
        (a, b) => b.created - a.created || a.title.localeCompare(b.title),
      );
      for (const recipe of sorted) {
        const group = createdGroup(recipe.created);
        if (!map.has(group)) map.set(group, []);
        map.get(group)!.push(recipe);
      }
      return [...map.entries()]
        .sort(([a], [b]) => createdGroupRank(b) - createdGroupRank(a))
        .map(([label, recs]) => ({ label, recipes: recs }));
    }

    default: {
      if (isTagSortMode(sortMode)) {
        return groupByNamespace(recipes, sortMode.slice(4), selectedTags);
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
  initialFacetSelections = {},
  onFacetFilterChange,
  initialOrder = DEFAULT_ORDER,
  onOrderChange,
  galleryFolder,
  recipesElsewhereFolder,
}: RecipeGalleryProps) {
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [sortMode, setSortMode] = useState<SortMode>(initialSortMode);
  /**
   * Which chip submenu is open: "*" for every tag (the Tags pill), a
   * namespace like "method" for that pill's tags, or null for none.
   */
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] =
    useState<string[]>(initialSelectedTags);
  const [tagMatchMode, setTagMatchMode] =
    useState<TagMatchMode>(initialTagMatchMode);
  const [tagQuery, setTagQuery] = useState("");
  const [facetSelections, setFacetSelections] = useState<FacetSelections>(
    initialFacetSelections,
  );
  const [order, setOrder] = useState<RecipeOrder>(initialOrder);
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

  // Then by the toggled tags, then by the meal type / cook time / times made
  // chips.
  const tagFiltered = useMemo(
    () => filterByTags(searched, selectedTags, tagMatchMode),
    [searched, selectedTags, tagMatchMode],
  );
  const filtered = useMemo(
    () => filterByFacets(tagFiltered, facetSelections),
    [tagFiltered, facetSelections],
  );

  const tagGroups = useMemo(
    () =>
      buildTagGroups(
        recipes,
        filterByFacets(searched, facetSelections),
        selectedTags,
        tagMatchMode,
      ),
    [recipes, searched, facetSelections, selectedTags, tagMatchMode],
  );

  /** The facet whose chip panel is open, if it's a facet panel. */
  const openFacet: FacetKey | null = useMemo(() => {
    const key = openPanel?.startsWith("facet:") ? openPanel.slice(6) : null;
    return isFacetKey(key) ? key : null;
  }, [openPanel]);

  const openFacetChips = useMemo(
    () =>
      openFacet
        ? facetChips(
            recipes,
            filterByFacets(tagFiltered, facetSelections, openFacet),
            openFacet,
            facetSelections[openFacet],
          )
        : [],
    [openFacet, recipes, tagFiltered, facetSelections],
  );

  const toggleFacet = useCallback((key: FacetKey, value: string) => {
    setFacetSelections((prev) => {
      const current = prev[key] ?? [];
      const nextValues = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      const next = { ...prev };
      if (nextValues.length > 0) next[key] = nextValues;
      else delete next[key];
      return next;
    });
  }, []);

  const visibleTagGroups = useMemo(() => {
    if (openPanel === null || openFacet) return [];
    const q = tagQuery.toLowerCase().trim().replace(/^#/, "");
    return tagGroups
      .filter((g) => openPanel === "*" || g.namespace === openPanel)
      .map((g) =>
        q ? { ...g, tags: g.tags.filter((t) => t.tag.includes(q)) } : g,
      )
      .filter((g) => g.tags.length > 0);
  }, [tagGroups, tagQuery, openPanel, openFacet]);

  /** How many selected tags belong to a namespace ("*" = all of them). */
  const selectedIn = useCallback(
    (ns: string) =>
      ns === "*"
        ? selectedTags.length
        : selectedTags.filter((t) => t === ns || t.startsWith(ns + "/")).length,
    [selectedTags],
  );

  const tagNamespaces = useMemo(() => sortableNamespaces(recipes), [recipes]);

  const sortOptions = useMemo(
    () => [
      ...(Object.keys(SORT_LABELS) as BaseSortMode[]).map((mode) => ({
        mode: mode,
        label: SORT_LABELS[mode],
        namespace: null as string | null,
      })),
      ...tagNamespaces.map((ns) => ({
        mode: `tag:${ns}` as SortMode,
        label: capitalize(ns),
        namespace: ns,
      })),
    ],
    [tagNamespaces],
  );

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }, []);

  // Build grouped sections, then order the recipes inside them.
  const sections = useMemo(
    () =>
      applyOrder(
        buildSections(filtered, sortMode, selectedTags, facetSelections),
        sortMode,
        order,
      ),
    [filtered, sortMode, selectedTags, facetSelections, order],
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

  useEffect(() => {
    onOrderChange?.(order);
  }, [order, onOrderChange]);

  useEffect(() => {
    onFacetFilterChange?.(facetSelections);
  }, [facetSelections, onFacetFilterChange]);

  const anyFilter =
    selectedTags.length > 0 || hasFacetSelection(facetSelections);

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
  const showSectionHeader = shouldShowSectionHeader(sortMode, sections);

  return (
    <div className="recipe-gallery-root">
      {/* Toolbar: search, then the sort options (always visible) */}
      <div className="recipe-gallery-toolbar">
        <div className="rg-toolbar-top">
          <input
            className="recipe-gallery-search"
            type="search"
            placeholder={`Search ${recipes.length} recipes…`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.currentTarget.value)}
          />
        </div>
        <div
          className="recipe-gallery-sort-tabs"
          role="toolbar"
          aria-label="Sort recipes"
        >
          <div className="rg-order" role="group" aria-label="Order">
            <span className="rg-order-pick">
              <select
                className={`rg-sort-tab rg-order-select${order.field !== "default" ? " filtered" : ""}`}
                aria-label="Order recipes by"
                title="Order recipes within each section"
                value={order.field}
                onChange={(e) => {
                  const field = e.currentTarget.value;
                  if (isOrderField(field)) {
                    setOrder({ field, dir: NATURAL_DIR[field] });
                  }
                }}
              >
                {ORDER_FIELDS.map((field) => (
                  <option key={field} value={field}>
                    {field === "default"
                      ? "Order"
                      : `Order: ${ORDER_LABELS[field]}`}
                  </option>
                ))}
              </select>
              <span
                className="rg-sort-tab-caret rg-order-caret"
                aria-hidden="true"
              >
                ▾
              </span>
            </span>
            {order.field !== "default" && (
              <button
                type="button"
                className="rg-sort-tab rg-order-dir"
                title="Reverse the order"
                onClick={() =>
                  setOrder((o) => ({
                    ...o,
                    dir: o.dir === "asc" ? "desc" : "asc",
                  }))
                }
              >
                {order.dir === "asc" ? "↑" : "↓"}{" "}
                {dirLabel(order.field, order.dir)}
              </button>
            )}
          </div>
          <span className="rg-order-divider" aria-hidden="true" />
          {sortOptions.map(({ mode, label, namespace }) => {
            const active = sortMode === mode;
            if (namespace === null && isFacetKey(mode)) {
              // Name / Meal Type / Cook Time / Times Made / Recently Added: sort by it and open its
              // chips; clicking the active one again folds them away.
              const panel = facetPanel(mode);
              const count = facetSelections[mode]?.length ?? 0;
              const open = openPanel === panel;
              return (
                <button
                  key={mode}
                  type="button"
                  className={`rg-sort-tab rg-sort-tab-tags${active ? " active" : count > 0 ? " filtered" : ""}`}
                  aria-pressed={active}
                  aria-expanded={open}
                  onClick={() => {
                    if (!active) {
                      setSortMode(mode);
                      setOpenPanel(panel);
                    } else {
                      setOpenPanel(open ? null : panel);
                    }
                  }}
                >
                  {label}
                  {count > 0 ? ` (${count})` : ""}
                  <span className="rg-sort-tab-caret" aria-hidden="true">
                    {open ? "▴" : "▾"}
                  </span>
                </button>
              );
            }
            if (namespace === null) {
              return (
                <button
                  key={mode}
                  type="button"
                  className={`rg-sort-tab${active ? " active" : ""}`}
                  aria-pressed={active}
                  onClick={() => {
                    setSortMode(mode);
                    setOpenPanel(null);
                  }}
                >
                  {label}
                </button>
              );
            }
            // Namespace pills sort by that namespace and open its chips;
            // clicking the active one again folds the chips away.
            const count = selectedIn(namespace);
            const open = openPanel === namespace;
            return (
              <button
                key={mode}
                type="button"
                className={`rg-sort-tab rg-sort-tab-tags${active ? " active" : count > 0 ? " filtered" : ""}`}
                aria-pressed={active}
                aria-expanded={open}
                onClick={() => {
                  if (!active) {
                    setSortMode(mode);
                    setOpenPanel(namespace);
                  } else {
                    setOpenPanel(open ? null : namespace);
                  }
                  setTagQuery("");
                }}
              >
                {label}
                {count > 0 ? ` (${count})` : ""}
                <span className="rg-sort-tab-caret" aria-hidden="true">
                  {open ? "▴" : "▾"}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            className={`rg-sort-tab rg-sort-tab-tags${openPanel === "*" ? " active" : selectedTags.length > 0 ? " filtered" : ""}`}
            aria-expanded={openPanel === "*"}
            onClick={() => {
              setOpenPanel((v) => (v === "*" ? null : "*"));
              setTagQuery("");
            }}
          >
            Tags
            {selectedTags.length > 0 ? ` (${selectedTags.length})` : ""}
            <span className="rg-sort-tab-caret" aria-hidden="true">
              {openPanel === "*" ? "▴" : "▾"}
            </span>
          </button>
        </div>
        {openFacet && (
          <div className="rg-tag-panel">
            <div className="rg-tag-chips">
              {openFacetChips.map(({ value, count }) => {
                const active =
                  facetSelections[openFacet]?.includes(value) ?? false;
                return (
                  <button
                    key={value}
                    type="button"
                    className={`rg-tag-chip${active ? " active" : ""}${!active && count === 0 ? " empty" : ""}`}
                    aria-pressed={active}
                    onClick={() => toggleFacet(openFacet, value)}
                  >
                    {value}
                    <span className="rg-tag-chip-count">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {openPanel !== null && !openFacet && (
          <div className="rg-tag-panel">
            <div className="rg-tag-panel-controls">
              <input
                className="rg-tag-search"
                type="search"
                placeholder={
                  openPanel === "*" ? "Find a tag…" : `Find a ${openPanel}…`
                }
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
                    {openPanel === "*" && (
                      <div className="rg-tag-group-label">
                        {group.namespace
                          ? capitalize(group.namespace)
                          : "Other"}
                      </div>
                    )}
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
        {anyFilter && (
          <div className="rg-active-tags">
            {(Object.keys(facetSelections) as FacetKey[]).flatMap((key) =>
              (facetSelections[key] ?? []).map((value) => (
                <button
                  key={`${key}:${value}`}
                  type="button"
                  className="rg-tag-chip active"
                  title={`Remove ${SORT_LABELS[key]}: ${value}`}
                  onClick={() => toggleFacet(key, value)}
                >
                  {value}
                  <span className="rg-tag-chip-remove" aria-hidden="true">
                    ×
                  </span>
                </button>
              )),
            )}
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
                {tagMatchMode === "all" ? "all tags" : "any tag"}
              </span>
            )}
            <button
              type="button"
              className="rg-active-tags-clear"
              onClick={() => {
                setSelectedTags([]);
                setFacetSelections({});
              }}
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
              {searchQuery || anyFilter ? (
                <span>
                  No recipes match your{" "}
                  {searchQuery && anyFilter
                    ? "search and filters"
                    : searchQuery
                      ? "search"
                      : "filters"}
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
