import { useEffect, useState } from "preact/hooks";

import { scrollContainer } from "../scroll";
import { Icon } from "./icon";

/** How far down before there's a top worth going back to, in screens. */
const SCREENS = 1.5;
/** How much of a scroll counts as a change of direction, not a wobble. */
const NUDGE = 12;

/**
 * Back to the top of a long list. Out of the way while you scroll down
 * through it, and back the moment you start scrolling up - that's when you
 * want the top, and when a thumb swipe would otherwise take a dozen more.
 */
export function ToTop() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = scrollContainer();
    if (!el) return;
    let last = el.scrollTop;
    // Where the scroll last turned around, so a slow scroll up still adds up
    // to a nudge rather than a run of 2px moves that never do.
    let turn = last;
    let up = false;

    const onScroll = () => {
      // iOS bounces past both ends. The bounce back from the bottom reads as
      // a scroll up, which would pop the button on every fling to the end.
      const max = el.scrollHeight - el.clientHeight;
      const top = Math.min(Math.max(el.scrollTop, 0), max);
      if (top === last) return;

      const goingUp = top < last;
      if (goingUp !== up) {
        up = goingUp;
        turn = last;
      }
      last = top;

      if (top < el.clientHeight * SCREENS) setShown(false);
      else if (up && turn - top > NUDGE) setShown(true);
      else if (!up && top - turn > NUDGE) setShown(false);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const goUp = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    scrollContainer()?.scrollTo({
      top: 0,
      behavior: reduce.matches ? "auto" : "smooth",
    });
  };

  return (
    // Kept in the page while hidden so it can slide out rather than vanish.
    <button
      type="button"
      class="to-top icon-btn-round"
      data-shown={shown}
      aria-label="Back to top"
      aria-hidden={!shown}
      tabIndex={shown ? 0 : -1}
      onClick={goUp}
    >
      <Icon name="arrow-up" stroke={2} />
    </button>
  );
}
