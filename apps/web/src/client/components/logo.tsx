/**
 * Logo C5 from the redesign canvas: a pot with its lid tipped open. The
 * numbers are the canvas's own, in its 100-unit box, and the same ones
 * `scripts/make-icons.mjs` draws the PNG icons from - change one, change both.
 */

/** A rounded rect, clockwise. `back` winds it the other way, to cut a hole. */
function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  back = false,
) {
  const sides = [w - 2 * r, h - 2 * r];
  if (back) {
    return (
      `M${x + r} ${y}a${r} ${r} 0 0 0 ${-r} ${r}v${sides[1]}` +
      `a${r} ${r} 0 0 0 ${r} ${r}h${sides[0]}a${r} ${r} 0 0 0 ${r} ${-r}` +
      `v${-sides[1]}a${r} ${r} 0 0 0 ${-r} ${-r}z`
    );
  }
  return (
    `M${x + r} ${y}h${sides[0]}a${r} ${r} 0 0 1 ${r} ${r}v${sides[1]}` +
    `a${r} ${r} 0 0 1 ${-r} ${r}h${-sides[0]}a${r} ${r} 0 0 1 ${-r} ${-r}` +
    `v${-sides[1]}a${r} ${r} 0 0 1 ${r} ${-r}z`
  );
}

/** The same, turned `deg` about (px, py). Clockwise, like `rect`. */
function turned(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  [px, py, deg]: [number, number, number],
) {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const p = (X: number, Y: number) => {
    const dx = X - px;
    const dy = Y - py;
    return `${(px + dx * cos - dy * sin).toFixed(2)} ${(py + dx * sin + dy * cos).toFixed(2)}`;
  };
  const arc = `A${r} ${r} 0 0 1 `;
  return (
    `M${p(x + r, y)}L${p(x + w - r, y)}${arc}${p(x + w, y + r)}` +
    `L${p(x + w, y + h - r)}${arc}${p(x + w - r, y + h)}` +
    `L${p(x + r, y + h)}${arc}${p(x, y + h - r)}` +
    `L${p(x, y + r)}${arc}${p(x + r, y)}Z`
  );
}

const LID_TIP: [number, number, number] = [18, 41, -6];

/**
 * Knob, lid, body, handles, and the glare wound backwards so it comes out as
 * a hole under the default nonzero fill. The overlapping handles and body all
 * wind the same way, so where they meet stays filled.
 */
const POT =
  turned(44, 24, 12, 8, 3, LID_TIP) +
  turned(18, 33, 64, 8, 4, LID_TIP) +
  rect(22, 44, 56, 42, 11) +
  rect(10, 50, 14, 8, 4) +
  rect(76, 50, 14, 8, 4) +
  rect(30, 52, 5, 15, 2.5, true);

/**
 * The pot on its own, in the current text colour. It stands in wherever a
 * recipe has no photo, so an empty slot reads as deliberate rather than as an
 * image that failed to load.
 */
export function PotMark({ class: cls = "" }: { class?: string }) {
  return (
    <svg viewBox="0 0 100 100" class={cls} aria-hidden="true">
      <path d={POT} fill="currentColor" />
    </svg>
  );
}

/**
 * The app icon: the ink pot on the accent square. Ink stays dark in both
 * themes - the canvas's dark sidebar keeps a dark pot on the lighter amber -
 * so it's the light token's value rather than `ink`, which flips.
 */
export function AppIcon({ class: cls = "" }: { class?: string }) {
  return (
    <svg viewBox="0 0 100 100" class={`shrink-0 ${cls}`} aria-hidden="true">
      <rect width="100" height="100" rx="22" class="fill-accent" />
      <path d={POT} fill="oklch(0.24 0.01 65)" />
    </svg>
  );
}
