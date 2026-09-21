import { useEffect, useState } from "preact/hooks";

/**
 * Holding the screen on while a screen is open.
 *
 * Cooking from the phone means it's propped on the counter and nobody is
 * touching it, so the display times out somewhere between the mise en place
 * and the first stir. The Screen Wake Lock API keeps it awake for as long as
 * the component that asked for it stays mounted.
 *
 * Two things about the lock. The browser takes it back whenever the page goes
 * hidden - switching apps, locking the phone - and does not hand it back on
 * return, so it has to be asked for again on every visibilitychange. And it
 * can just be refused: Safari before 16.4 has no API at all, and a phone in
 * low power mode says no. Every path here has to be fine without one.
 */
export function useWakeLock(enabled = true): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!enabled || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let gone = false;

    const acquire = async () => {
      if (gone || sentinel || document.visibilityState !== "visible") return;
      try {
        const next = await navigator.wakeLock.request("screen");
        // The screen unmounted while the request was in flight. Nothing is
        // watching this lock any more, so let it go.
        if (gone) {
          void next.release().catch(() => {});
          return;
        }
        sentinel = next;
        setHeld(true);
        next.addEventListener("release", () => {
          if (sentinel !== next) return;
          sentinel = null;
          setHeld(false);
        });
      } catch {
        // Low power mode, or the page lost visibility mid-request. Either way
        // the phone sleeps like it always did.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (sentinel) {
        const held = sentinel;
        sentinel = null;
        void held.release().catch(() => {});
      }
      setHeld(false);
    };
  }, [enabled]);

  return held;
}
