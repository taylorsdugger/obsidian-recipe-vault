/**
 * Remembering where a screen was scrolled to.
 *
 * The app scrolls the page itself, and screens mount and unmount inside it. A
 * screen starts with no data, so its content height collapses to nothing on
 * mount and the page clamps `scrollTop` to zero; by the time the fetch lands,
 * the position is already gone. Restoring has to happen after the data
 * renders, which is why this is a store the screen drives rather than
 * something the router can do on its own.
 *
 * It used to be a `main` with its own `overflow-y-auto`. That looked the same,
 * but iOS Safari only tucks its toolbar away when the page scrolls, so on an
 * iPhone the toolbar sat over the bottom of the app for good.
 */

import { useEffect } from "preact/hooks";

/**
 * The scrolling element itself, for the plan's drag.
 *
 * A drag across days has to survive the list scrolling underneath it, so it
 * measures everything in the page's coordinates rather than the viewport's,
 * and nudges it when a meal is held near an edge.
 */
export function scrollContainer(): HTMLElement | null {
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

/**
 * The band of the window the page shows through, in viewport coordinates.
 * The whole window, less the phone's tab bar, which is fixed over the bottom
 * of the page. The sidebar from `md` up isn't over anything.
 */
export function scrollBox(): { top: number; bottom: number } {
  const bar = document.querySelector<HTMLElement>("[data-tab-bar]");
  const over =
    bar &&
    bar.getClientRects().length > 0 &&
    getComputedStyle(bar).position === "fixed";
  return {
    top: 0,
    bottom: over ? bar.getBoundingClientRect().top : window.innerHeight,
  };
}

const positions = new Map<string, number>();

/** Save where this screen is now. Call it on the way out. */
export function rememberScroll(key: string): void {
  const container = scrollContainer();
  if (container) positions.set(key, container.scrollTop);
}

/**
 * Put the screen back where it was. Returns false when there was nothing
 * saved, so a caller can tell "restored" from "fresh visit".
 */
export function restoreScroll(key: string): boolean {
  const top = positions.get(key);
  const container = scrollContainer();
  if (!container || top === undefined) return false;
  container.scrollTop = top;
  return true;
}

/** Back to the top, for when the content changed under the screen. */
export function scrollToTop(): void {
  const container = scrollContainer();
  if (container) container.scrollTop = 0;
}

/**
 * Hold the page still while something is open on top of it.
 *
 * Counted, because the photo viewer can open over a sheet and the one that
 * closes first shouldn't hand scrolling back to the page underneath.
 */
let locks = 0;

export function useScrollLock(): void {
  useEffect(() => {
    locks += 1;
    document.documentElement.classList.add("scroll-locked");
    return () => {
      locks -= 1;
      if (locks === 0)
        document.documentElement.classList.remove("scroll-locked");
    };
  }, []);
}
