import { useEffect, useState } from "preact/hooks";

import { api } from "../api";
import { Icon } from "./icon";
import { AppIcon } from "./logo";
import { navigate } from "../router";
import { SYNCED_EVENT } from "../sync";

/** Outline glyphs, one per tab. Stroke only, so they take the tab's colour. */
const ICONS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  plan: "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4",
  list: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  recipes:
    "M4 19.5V5a2 2 0 0 1 2-2h14v16H6.5A2.5 2.5 0 0 0 4 21.5zM4 19.5A2.5 2.5 0 0 1 6.5 17H20",
} as const;

const TABS: { path: string; label: string; icon: keyof typeof ICONS }[] = [
  { path: "/", label: "Home", icon: "home" },
  { path: "/plan", label: "Plan", icon: "plan" },
  { path: "/list", label: "List", icon: "list" },
  { path: "/recipes", label: "Recipes", icon: "recipes" },
];

/** The sidebar's `md` breakpoint, where the counts start to show. */
const SIDEBAR = "(width >= 48rem)";

/**
 * How much is on the list and in the gallery, for the sidebar. Only fetched
 * once there is a sidebar - the phone's tab bar has no room for numbers - and
 * again on every move between screens, which is when either one changes.
 */
function useCounts(path: string): { list: number; recipes: number } | null {
  const [wide, setWide] = useState(() => window.matchMedia(SIDEBAR).matches);
  const [counts, setCounts] = useState<{
    list: number;
    recipes: number;
  } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const query = window.matchMedia(SIDEBAR);
    const onChange = () => setWide(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const onSynced = () => setTick((n) => n + 1);
    window.addEventListener(SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SYNCED_EVENT, onSynced);
  }, []);

  useEffect(() => {
    if (!wide) return;
    let cancelled = false;
    Promise.all([api.list(), api.recipes("", "recent")])
      .then(([list, recipes]) => {
        if (cancelled) return;
        setCounts({
          list: list.items.filter((item) => !item.checked).length,
          recipes: recipes.recipes.length,
        });
      })
      // A count is a nicety. A failed one just doesn't show.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [wide, path, tick]);

  return counts;
}

/**
 * The app's navigation.
 *
 * A bottom tab bar on a phone, 60px over the home indicator, icon over label.
 * The active tab's icon sits in a soft pill, which is what makes it findable
 * at a glance - a bolder stroke alone was too subtle to read in a dim kitchen.
 * From `md` up it turns into a left sidebar: a wide screen has the room, and a
 * row of four words along the bottom of a 1400px window was easy to lose.
 * There the whole row highlights instead of the icon, and the list and the
 * gallery say how much is in them.
 *
 * `pushed` hides it on a phone while a recipe is open. The sidebar stays,
 * since on a desktop it's not in the way of anything.
 */
export function TabBar({ path, pushed }: { path: string; pushed: boolean }) {
  const counts = useCounts(path);

  return (
    <nav
      aria-label="Main"
      class={`${pushed ? "hidden md:flex" : "flex"} shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:order-first md:w-58 md:flex-col md:gap-1 md:border-t-0 md:border-r md:px-3.5 md:py-6`}
    >
      <div class="hidden items-center gap-2.5 px-2.5 pb-5.5 md:flex">
        <AppIcon class="size-7" />
        <span class="font-display text-[1.3125rem] font-semibold">
          Recipe Vault
        </span>
      </div>
      {TABS.map((tab) => {
        const active =
          tab.path === "/"
            ? path === "/"
            : path === tab.path || path.startsWith(`${tab.path}/`);
        const count =
          tab.icon === "list"
            ? counts?.list
            : tab.icon === "recipes"
              ? counts?.recipes
              : undefined;
        return (
          <button
            key={tab.path}
            type="button"
            aria-current={active ? "page" : undefined}
            class={`flex h-15 flex-1 flex-col items-center justify-center gap-0.5 text-caption font-semibold transition-colors md:h-auto md:min-h-11 md:flex-none md:flex-row md:justify-start md:gap-3 md:rounded-xl md:px-3 md:text-row ${
              active
                ? "text-ink md:bg-accent-soft md:text-accent-ink"
                : "text-muted active:text-ink md:font-medium md:text-ink md:hover:bg-canvas"
            }`}
            onClick={() => navigate(tab.path)}
          >
            {/* The pill is a phone thing. In the sidebar the whole row
                highlights instead, so the pill steps back to a plain box. */}
            <span
              class={`grid h-7.5 w-14 place-items-center md:size-5 ${
                active ? "tab-pill md:bg-transparent md:text-current" : ""
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                class="size-5.5 md:size-5"
                aria-hidden="true"
              >
                <path
                  d={ICONS[tab.icon]}
                  fill="none"
                  stroke="currentColor"
                  stroke-width={1.8}
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span class="md:flex-1 md:text-left">{tab.label}</span>
            {count !== undefined && count > 0 && (
              <span class="hidden text-note font-medium text-muted md:inline">
                {count}
              </span>
            )}
          </button>
        );
      })}
      {/* At the foot of the sidebar. A phone gets the gear on Home instead,
          since a fifth tab would crowd the four that get used every day. */}
      <button
        type="button"
        aria-current={path === "/settings" ? "page" : undefined}
        class={`mt-auto hidden min-h-11 items-center gap-3 rounded-xl px-3 text-row transition-colors md:flex ${
          path === "/settings"
            ? "bg-accent-soft font-semibold text-accent-ink"
            : "font-medium text-ink hover:bg-canvas"
        }`}
        onClick={() => navigate("/settings")}
      >
        <Icon name="settings" />
        <span class="flex-1 text-left">Settings</span>
      </button>
    </nav>
  );
}
