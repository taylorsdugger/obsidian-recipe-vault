import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

import { api, type AppSettings } from "../api";
import {
  setRecipeLayout,
  storedRecipeLayout,
  type RecipeLayout,
} from "../recipe-layout";
import { setTheme, storedTheme, type Theme } from "../theme";

/** One row: what it is and what it does on the left, the control on the right. */
function Row({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: ComponentChildren;
}) {
  return (
    <div class="flex min-h-16 items-center justify-between gap-4 px-4 py-3">
      <div class="min-w-0">
        <p class="text-row font-medium">{title}</p>
        <p class="text-sm text-muted">{detail}</p>
      </div>
      {children}
    </div>
  );
}

/**
 * The theme and recipe layout, which this device keeps for itself, and the
 * import settings,
 * which the household shares through the worker.
 *
 * Every control saves on tap. The import ones flip straight away and flip
 * back if the save fails, the way the format pills on the import screen
 * used to.
 */
export function Settings() {
  const [theme, setThemeState] = useState<Theme>(storedTheme);
  const [layout, setLayoutState] = useState<RecipeLayout>(storedRecipeLayout);
  // Null until the server says, so the switches don't flash the wrong way.
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .settings()
      .then(setSettings)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  }, []);

  const chooseTheme = (next: Theme) => {
    setThemeState(next);
    setTheme(next);
  };

  const chooseLayout = (next: RecipeLayout) => {
    setLayoutState(next);
    setRecipeLayout(next);
  };

  const change = async (patch: Partial<AppSettings>) => {
    if (!settings) return;
    const before = settings;
    setSettings({ ...settings, ...patch });
    setError(null);
    try {
      setSettings(await api.updateSettings(patch));
    } catch (err) {
      setSettings(before);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div class="screen space-y-6 pb-8">
      <header class="screen-title">
        <div class="min-w-0">
          <p class="truncate text-note text-muted">Recipe Vault</p>
          <h1 class="title-display">Settings</h1>
        </div>
      </header>

      {error && <p class="px-1 text-sm text-danger">{error}</p>}

      <section class="space-y-2 lg:max-w-2xl">
        <h2 class="label px-1 text-muted">Appearance</h2>
        <div class="card divide-y divide-line">
          <div class="space-y-3 p-4">
            <div>
              <p class="text-row font-medium">Theme</p>
              <p class="text-sm text-muted">
                Just this device. System follows your phone or computer.
              </p>
            </div>
            <div class="segmented grid-cols-3" role="group" aria-label="Theme">
              {(
                [
                  ["system", "System"],
                  ["light", "Light"],
                  ["dark", "Dark"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  class={theme === key ? "pill-on" : "pill"}
                  aria-pressed={theme === key}
                  onClick={() => chooseTheme(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div class="space-y-3 p-4">
            <div>
              <p class="text-row font-medium">Recipes on a phone</p>
              <p class="text-sm text-muted">
                Just this device. Kitchen splits a recipe into Ingredients and
                Steps, switched from the bar at the bottom. Classic is the whole
                recipe as one scrolling page.
              </p>
            </div>
            <div class="segmented" role="group" aria-label="Recipes on a phone">
              {(
                [
                  ["kitchen", "Kitchen"],
                  ["classic", "Classic"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  class={layout === key ? "pill-on" : "pill"}
                  aria-pressed={layout === key}
                  onClick={() => chooseLayout(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section class="space-y-2 lg:max-w-2xl">
        <h2 class="label px-1 text-muted">Importing</h2>
        {settings ? (
          <div class="card divide-y divide-line">
            <div class="space-y-3 p-4">
              <div>
                <p class="text-row font-medium">Save new recipes as</p>
                <p class="text-sm text-muted">
                  Markdown is a regular note. Cooklang is a .cook file.
                </p>
              </div>
              <div
                class="segmented"
                role="group"
                aria-label="Save new recipes as"
              >
                {(
                  [
                    ["markdown", "Markdown"],
                    ["cooklang", "Cooklang"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    class={settings.recipeFormat === key ? "pill-on" : "pill"}
                    aria-pressed={settings.recipeFormat === key}
                    onClick={() => void change({ recipeFormat: key })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <label class="block cursor-pointer">
              <Row
                title="Strip filler words"
                detail="Drops best, easy, ultimate and the like from the title."
              >
                <input
                  type="checkbox"
                  role="switch"
                  class="switch"
                  checked={settings.stripFillerWords}
                  onChange={(e) =>
                    void change({
                      stripFillerWords: (e.target as HTMLInputElement).checked,
                    })
                  }
                />
              </Row>
            </label>

            <label class="block cursor-pointer">
              <Row
                title="Strip vegan labels"
                detail="Drops vegan, plant-based and dairy-free from the title."
              >
                <input
                  type="checkbox"
                  role="switch"
                  class="switch"
                  checked={settings.stripVeganWords}
                  onChange={(e) =>
                    void change({
                      stripVeganWords: (e.target as HTMLInputElement).checked,
                    })
                  }
                />
              </Row>
            </label>
          </div>
        ) : (
          !error && <div class="card h-56 animate-pulse" />
        )}
        <p class="px-1 text-sm text-muted">
          These apply to every device, from the next recipe you look up. Recipes
          already saved keep their titles.
        </p>
      </section>
    </div>
  );
}
