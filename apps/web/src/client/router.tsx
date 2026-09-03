import { useEffect, useState } from "preact/hooks";

/**
 * A history-API router in thirty lines. The app has five screens and no
 * nested routes, so a routing library would be more config than code.
 */

/** Navigate without a reload. Anything rendering a link should call this. */
export function navigate(path: string): void {
  if (path === window.location.pathname) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
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
