import { useEffect, useState } from "preact/hooks";

/**
 * A history-API router in thirty lines. The app has five screens and no
 * nested routes, so a routing library would be more config than code.
 */

/**
 * Marks an entry this app pushed. A back arrow can only go back through
 * history it put there itself - on a cold load of a shared link, the entry
 * before is someone else's page, or nothing.
 */
const IN_APP = { inApp: true };

/** Navigate without a reload. Anything rendering a link should call this. */
export function navigate(path: string): void {
  if (path === window.location.pathname) return;
  window.history.pushState(IN_APP, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Swap the current entry, for a move that shouldn't be a back step. */
export function replace(path: string): void {
  if (path === window.location.pathname) return;
  window.history.replaceState(window.history.state, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * The back arrow on a pushed screen. Real history when the app put the entry
 * there, so it lands wherever you came from - home, the plan, the gallery -
 * and `fallback` when it didn't.
 */
export function back(fallback: string): void {
  const state = window.history.state as { inApp?: boolean } | null;
  if (state?.inApp) window.history.back();
  else navigate(fallback);
}

/** The current pathname, re-rendering on back/forward and `navigate`. */
export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return path;
}
