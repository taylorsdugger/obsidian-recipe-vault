/**
 * Light or dark, per device. Not a household setting: the phone on the
 * counter and the laptop on the desk can each want their own. "system" means
 * no `data-theme` at all, and the css follows the phone's setting.
 *
 * index.html reads the same key before first paint, so a forced theme doesn't
 * flash the other one on load. Keep the two in step.
 */
export type Theme = "system" | "light" | "dark";

const KEY = "recipe-vault:theme";

/** The canvas colours, for the browser chrome. Same hexes as index.html. */
const CHROME: Record<"light" | "dark", string> = {
  light: "#faf8f5",
  dark: "#13110f",
};

export function storedTheme(): Theme {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    // Storage blocked, private mode. Follow the phone.
    return "system";
  }
}

/**
 * Put a theme on the page. The two theme-color tags each carry a media query,
 * so a forced theme points both at its colour, and "system" puts them back.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);

  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => {
      const own = meta.media.includes("dark") ? "dark" : "light";
      meta.content = CHROME[theme === "system" ? own : theme];
    });
}

export function setTheme(theme: Theme): void {
  try {
    if (theme === "system") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, theme);
  } catch {
    // Still applies for this visit, it just won't stick.
  }
  applyTheme(theme);
}
