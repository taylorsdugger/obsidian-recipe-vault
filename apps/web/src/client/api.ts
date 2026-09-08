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

/** The full row, markdown included. */
export interface RecipeDetail extends RecipeSummary {
  markdown: string;
  author: string | null;
  sourceUrl: string | null;
  ingredients: string;
  createdAt: string;
}

/** One shopping list row as the API renders it. */
export interface ListItem {
  id: string;
  checked: boolean;
  /** "2 1/2 cups flour" — amount, unit, and name already formatted. */
  text: string;
  name: string;
  sources: string[];
  updatedAt: string;
}

export type RecipeSort = "recent" | "made" | "quick";

export const api = {
  session: () => request<{ signedIn: boolean }>("/session"),
  login: (password: string) =>
    request<{ signedIn: boolean }>("/login", {
      method: "POST",
      body: JSON.stringify({ password }),
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

  vaultStatus: () =>
    request<{
      prefix: string;
      notes: number;
      alreadyImported: number;
    }>("/vault/list"),

  vaultImport: (offset: number, dryRun = false) =>
    request<{
      total: number;
      processed: number;
      nextOffset: number | null;
      added: number;
      updated: number;
      unchanged: number;
      skipped: number;
      removed: number;
    }>("/vault/import", {
      method: "POST",
      body: JSON.stringify({ offset, dryRun }),
    }),

  recipe: (id: string) => request<{ recipe: RecipeDetail }>(`/recipes/${id}`),

  saveRecipe: (id: string, markdown: string) =>
    request<{ recipe: RecipeDetail }>(`/recipes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ markdown }),
    }),

  deleteRecipe: (id: string) =>
    request<{ deleted: string }>(`/recipes/${id}`, { method: "DELETE" }),

  markMade: (id: string) =>
    request<{ id: string; timesMade: number; lastMade: string }>(
      `/recipes/${id}/made`,
      { method: "POST" },
    ),

  list: () => request<{ items: ListItem[] }>("/list"),

  addToList: (lines: string[], source?: string) =>
    request<{ merged: number; added: number; items: ListItem[] }>("/list", {
      method: "POST",
      body: JSON.stringify({ lines, source }),
    }),

  setChecked: (id: string, checked: boolean) =>
    request<{ item: ListItem }>(`/list/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ checked }),
    }),

  clearChecked: () =>
    request<{ removed: number }>("/list/checked", { method: "DELETE" }),

  removeListItem: (id: string) =>
    request<{ deleted: string }>(`/list/${id}`, { method: "DELETE" }),
};
