/** Thin wrapper over fetch for the JSON API. Throws on a non-2xx body. */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });

  const body = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;

  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

/** A recipe as the list endpoint returns it. */
export interface RecipeSummary {
  id: string;
  title: string;
  photoUrl: string | null;
  mealType: string | null;
  cookTime: string | null;
  cookTimeMins: number | null;
  timesMade: number;
  lastMade: string | null;
  updatedAt: string;
}

/** What the parser found. Shape mirrors core's `ParsedRecipe`. */
export interface ParsedRecipePreview {
  name?: unknown;
  image?: unknown;
  author?: unknown;
  url?: string;
  totalTime?: unknown;
  recipeIngredient?: string[];
  recipeInstructions?: unknown[];
  [key: string]: unknown;
}

export type RecipeSort = "recent" | "made" | "quick";

export const api = {
  session: () => request<{ signedIn: boolean }>("/session"),
  login: (passcode: string) =>
    request<{ signedIn: boolean }>("/login", {
      method: "POST",
      body: JSON.stringify({ passcode }),
    }),
  logout: () => request<{ signedIn: boolean }>("/logout", { method: "POST" }),

  recipes: (q: string, sort: RecipeSort) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sort !== "recent") params.set("sort", sort);
    const query = params.toString();
    return request<{ recipes: RecipeSummary[] }>(
      `/recipes${query ? `?${query}` : ""}`,
    );
  },

  importPreview: (url: string) =>
    request<{ recipes: ParsedRecipePreview[] }>("/import/preview", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),

  importSave: (recipe: ParsedRecipePreview) =>
    request<{ recipe: { id: string; title: string } }>("/import", {
      method: "POST",
      body: JSON.stringify({ recipe }),
    }),
};
