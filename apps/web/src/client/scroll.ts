/**
 * Remembering where a screen was scrolled to.
 *
 * The app has one scroll container - the `main` in `app.tsx` - and screens
 * mount and unmount inside it. A screen starts with no data, so its content
 * height collapses to nothing on mount and the container clamps `scrollTop` to
 * zero; by the time the fetch lands, the position is already gone. Restoring
 * has to happen after the data renders, which is why this is a store the
 * screen drives rather than something the router can do on its own.
 */

let container: HTMLElement | null = null;

/** Set once by `App`, which owns the scrolling element. */
export function setScrollContainer(el: HTMLElement | null): void {
  container = el;
}

/**
 * The scrolling element itself, for the plan's drag.
 *
 * A drag across days has to survive the list scrolling underneath it, so it
 * measures everything in this container's coordinates rather than the
 * viewport's, and nudges it when a meal is held near an edge.
 */
export function scrollContainer(): HTMLElement | null {
  return container;
}

const positions = new Map<string, number>();

/** Save where this screen is now. Call it on the way out. */
export function rememberScroll(key: string): void {
  if (container) positions.set(key, container.scrollTop);
}

/**
 * Put the screen back where it was. Returns false when there was nothing
 * saved, so a caller can tell "restored" from "fresh visit".
 */
export function restoreScroll(key: string): boolean {
  const top = positions.get(key);
  if (!container || top === undefined) return false;
  container.scrollTop = top;
  return true;
}

/** Back to the top, for when the content changed under the screen. */
export function scrollToTop(): void {
  if (container) container.scrollTop = 0;
}
