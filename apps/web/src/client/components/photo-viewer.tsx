import { useEffect } from "preact/hooks";

/**
 * A recipe's photo, filling the screen.
 *
 * The hero on the recipe screen is a fixed-height crop, because these photos
 * come from other people's sites and range from square to very tall - a tall
 * one shown whole would push the ingredients off the bottom. That crop is right
 * for the page and wrong when you actually want to look at the food, which is
 * what this is for: the same image, `contain` rather than `cover`, nothing else
 * on screen.
 */
export function PhotoViewer({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  // Escape closes it, and the page behind stops scrolling - the same two things
  // the bottom sheet does, for the same reason.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    // Over the tab bar as well, not just the page: this is the whole screen or
    // it isn't full screen. Solid black, not a scrim - at 95% the page's own
    // text bleeds through under the photo and you sit there reading it.
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={alt || "Recipe photo"}
    >
      {/* Anywhere closes it. On a phone the close button is a long reach from
          where your thumb is, and tapping the picture is what people try. */}
      <button
        type="button"
        class="absolute inset-0 cursor-zoom-out"
        aria-label="Close photo"
        onClick={onClose}
      />

      <img
        class="pointer-events-none max-h-full max-w-full object-contain"
        src={src}
        alt={alt}
      />

      {/* Clear of the notch, and of the home indicator on the other end. */}
      <button
        type="button"
        class="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 grid size-10 place-items-center rounded-full bg-black/50 text-white backdrop-blur"
        aria-label="Close photo"
        onClick={onClose}
      >
        <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true">
          <path
            d="M3 3 L13 13 M13 3 L3 13"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            fill="none"
          />
        </svg>
      </button>
    </div>
  );
}
