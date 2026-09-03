import { navigate } from "../router";

const TABS = [
  { path: "/", label: "Home" },
  { path: "/plan", label: "Plan" },
  { path: "/list", label: "List" },
  { path: "/recipes", label: "Recipes" },
];

/** Bottom tab bar. Mobile first; desktop gets the same layout, wider. */
export function TabBar({ path }: { path: string }) {
  return (
    <nav class="flex shrink-0 border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)]">
      {TABS.map((tab) => {
        const active =
          tab.path === "/" ? path === "/" : path.startsWith(tab.path);
        return (
          <button
            key={tab.path}
            type="button"
            class={`flex-1 py-3 text-sm ${
              active ? "font-semibold text-neutral-900" : "text-neutral-500"
            }`}
            onClick={() => navigate(tab.path)}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
