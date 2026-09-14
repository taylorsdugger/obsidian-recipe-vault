import { useEffect } from "preact/hooks";
import { useScrollLock } from "../scroll";
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
  onNearEnd,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
  /**
   * Fired while the scroll is within a screenful of the bottom, for a list
   * that reveals more as you go. The sheet owns the scrolling element, so the
   * listener belongs here rather than in whatever is being scrolled.
   */
  onNearEnd?: () => void;
}) {
  // Escape closes it on a desktop keyboard, and the page behind stops
  // scrolling so a flick on the backdrop doesn't move the week underneath.
  useScrollLock();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
        <div
          class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4"
          onScroll={
            onNearEnd &&
            ((event) => {
              const el = event.currentTarget;
              if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
                onNearEnd();
              }
            })
          }
        >
          {children}
        </div>
        {footer && (
          <div class="shrink-0 border-t border-line bg-surface/95 p-3 backdrop-blur">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
