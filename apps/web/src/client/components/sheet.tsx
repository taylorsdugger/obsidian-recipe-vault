import { useEffect } from "preact/hooks";
import type { ComponentChildren } from "preact";

/**
 * A bottom sheet. Both of the plan screen's modals slide up from the bottom
 * because that's where the thumb already is, and both cap at most of the
 * viewport so a long list scrolls inside the sheet rather than the page.
 */
export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
}) {
  // Escape closes it on a desktop keyboard, and the page behind stops
  // scrolling so a flick on the backdrop doesn't move the week underneath.
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
    <div class="fixed inset-0 z-30 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        class="absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      <div class="relative flex max-h-[85vh] flex-col rounded-t-3xl bg-canvas pb-[env(safe-area-inset-bottom)] shadow-xl">
        <div class="flex shrink-0 items-center justify-between px-4 pt-4 pb-3">
          <h2 class="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            class="text-sm text-muted underline underline-offset-4"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer && (
          <div class="shrink-0 border-t border-line bg-surface/95 p-3 backdrop-blur">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
