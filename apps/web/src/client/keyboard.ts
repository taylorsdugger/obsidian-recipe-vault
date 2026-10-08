/**
 * Where the on-screen keyboard is, as CSS the layout can read.
 *
 * Neither iOS Safari nor Chrome on Android shrinks the page for the keyboard.
 * It slides up over the bottom of the window, and anything fixed to the
 * bottom - a sheet, the docked search, the list's add field - ends up behind
 * it. The plan's recipe picker was the worst of it: the search sat at the top
 * of the sheet and every result sat under the keyboard.
 *
 * The visual viewport is the part still showing, so the gap between its
 * bottom edge and the window's is the keyboard. That goes on the root as
 * `--keyboard`, with `--viewport-top` for when the browser has panned the
 * page up to keep the field in view, and `data-keyboard` while it's open.
 * styles.css does the rest.
 */

/**
 * Less than this is the browser's toolbar settling, not a keyboard. The
 * smallest phone keyboard is well over twice it.
 */
const MIN_KEYBOARD = 120;

export function trackKeyboard(): void {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const root = document.documentElement;

  const update = () => {
    // Pinching in shrinks the visual viewport too. That's zoom, not a
    // keyboard, and moving the sheets around for it would be wrong.
    const zoomed = viewport.scale > 1.01;
    // Whether it's open goes by how much the viewport shrank. How much of
    // the page it covers is less once the browser has panned up to the field,
    // and can be next to nothing, keyboard or not.
    const open = !zoomed && window.innerHeight - viewport.height > MIN_KEYBOARD;
    const covered = Math.max(
      0,
      Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
    );

    root.style.setProperty("--keyboard", open ? `${covered}px` : "0px");
    root.style.setProperty(
      "--viewport-top",
      open ? `${Math.round(viewport.offsetTop)}px` : "0px",
    );
    root.toggleAttribute("data-keyboard", open);
  };

  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  update();
}
