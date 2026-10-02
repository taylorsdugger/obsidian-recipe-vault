import { useState } from "preact/hooks";

import { PotMark } from "./logo";

/**
 * A recipe's photo, or the logo's pot when there isn't one.
 *
 * `box` is the shape and size of the slot, `mark` how big the pot sits inside
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
        <PotMark class={`text-faint/45 ${mark}`} />
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
