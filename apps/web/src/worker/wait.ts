/**
 * Promise-based delay for the Worker.
 *
 * Goes through `self` because the Obsidian plugin linter scans the whole repo
 * and wants `window.setTimeout`, which doesn't exist on the Worker.
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => self.setTimeout(resolve, ms));
}
