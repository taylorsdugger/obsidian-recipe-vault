import { navigate } from "../router";

/** Outline glyphs, one per tab. Stroke only, so they take the tab's colour. */
const ICONS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  plan: "M4 5h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M3 10h18 M8 3v4 M16 3v4",
  list: "M9 6h12 M9 12h12 M9 18h12 M3 6l1.5 1.5L7 5 M3 12l1.5 1.5L7 11 M3 18l1.5 1.5L7 17",
  recipes:
    "M4 4.5A1.5 1.5 0 0 1 5.5 3H19a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5.5A1.5 1.5 0 0 1 4 19.5z M4 17.5A1.5 1.5 0 0 1 5.5 16H20 M9 8h6",
} as const;

const TABS: { path: string; label: string; icon: keyof typeof ICONS }[] = [
  { path: "/", label: "Home", icon: "home" },
  { path: "/plan", label: "Plan", icon: "plan" },
  { path: "/list", label: "List", icon: "list" },
  { path: "/recipes", label: "Recipes", icon: "recipes" },
];

/**
 * The app's navigation.
 *
 * A bottom tab bar on a phone, icon over label, each tab a full 56px tall so
 * it's a thumb target rather than a line of text. From `md` up it turns into
 * a left sidebar: a wide screen has the room, and a row of four words along
 * the bottom of a 1400px window was easy to lose.
 */
export function TabBar({ path }: { path: string }) {
  return (
    <nav
      aria-label="Main"
      class="flex shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:order-first md:w-56 md:flex-col md:gap-1 md:border-t-0 md:border-r md:p-3 md:pb-3"
    >
      <div class="hidden px-3 pt-2 pb-4 text-base font-semibold md:block">
        Recipe Vault
      </div>
      {TABS.map((tab) => {
        const active =
          tab.path === "/" ? path === "/" : path.startsWith(tab.path);
        return (
          <button
            key={tab.path}
            type="button"
            aria-current={active ? "page" : undefined}
            class={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-xs transition-colors md:min-h-11 md:flex-none md:flex-row md:justify-start md:gap-3 md:rounded-xl md:px-3 md:text-sm ${
              active
                ? "font-semibold text-ink md:bg-canvas"
                : "text-muted active:text-ink md:hover:bg-canvas/70"
            }`}
            onClick={() => navigate(tab.path)}
          >
            <svg viewBox="0 0 24 24" class="size-6 md:size-5" aria-hidden="true">
              <path
                d={ICONS[tab.icon]}
                fill="none"
                stroke="currentColor"
                stroke-width={active ? 2 : 1.75}
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
