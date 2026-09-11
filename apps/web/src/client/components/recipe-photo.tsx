import { useState } from "preact/hooks";

/**
 * The app icon's bowl, drawn as a mark. Wherever a recipe has no photo this
 * stands in, so an empty slot reads as deliberate rather than as an image that
 * failed to load - and the gallery, the plan, the picker and home all fall
 * back to the same thing instead of four differently-sized blank squares.
 */
export function BowlMark({ class: cls = "" }: { class?: string }) {
  return (
    <svg viewBox="0 0 100 100" class={cls} aria-hidden="true">
      <path d="M22 52 h56 a28 30 0 0 1 -56 0 z" fill="currentColor" />
      <path
        d="M38 45 q-5 -6 0 -12 M50 45 q-5 -8 0 -16 M62 45 q-5 -6 0 -12"
        stroke="currentColor"
        stroke-width="4.5"
        stroke-linecap="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * A recipe's photo, or the mark when there isn't one.
 *
 * `box` is the shape and size of the slot, `mark` how big the bowl sits inside
 * it — a 40px row thumb and a gallery card want very different glyph sizes.
 *
 * A dead URL falls back too. A good number of these point at other people's
 * sites and some have since moved their images; without this the browser draws
 * its own broken-image glyph, which reads as the app being broken rather than
 * the link being dead.
 */
export function RecipePhoto({
  src,
  box,
  mark,
}: {
  src: string | null;
  box: string;
  mark: string;
}) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    return (
      <div
        class={`grid place-items-center bg-linear-to-b from-canvas to-surface ${box}`}
      >
        <BowlMark class={`text-faint/45 ${mark}`} />
      </div>
    );
  }

  return (
    <img
      class={`object-cover ${box}`}
      src={src}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}
