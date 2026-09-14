import { useEffect, useState } from "preact/hooks";

import { api, type PlanListItem } from "../api";
import { Sheet } from "./sheet";

/**
 * "Shopping list for this week." Everything the week's recipes call for,
 * already merged the way the list merges, with every line checked. You uncheck
 * what's in the cupboard and confirm; the unchecked names go up as `exclude`.
 */
export function PlanListPreview({
  from,
  to,
  onDone,
  onClose,
}: {
  from: string;
  to: string;
  onDone: (summary: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<PlanListItem[] | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .planListPreview(from, to)
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message));
  }, [from, to]);

  const toggle = (name: string) => {
    setSkip((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await api.planToList(from, to, [...skip]);
      onDone(
        `${res.added} added to the list, ${res.merged} merged into what was there.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const wanted = (items?.length ?? 0) - skip.size;
  /**
   * One control, not two. With everything ticked the only useful move is to
   * clear it and pick the few you want; with anything unticked it's to start
   * over. So the label says whichever of those you're one tap away from.
   */
  const allOn = skip.size === 0;
  const toggleAll = () =>
    setSkip(allOn ? new Set((items ?? []).map((item) => item.name)) : new Set());

  return (
    <Sheet
      title="Shopping list for this week"
      onClose={onClose}
      footer={
        items &&
        items.length > 0 && (
          <button
            type="button"
            class="btn-primary w-full"
            disabled={busy || wanted === 0}
            onClick={confirm}
          >
            {wanted === 0 ? "Nothing selected" : `Add ${wanted} to the list`}
          </button>
        )
      }
    >
      <div class="space-y-3">
        {error && <p class="text-sm text-red-700">{error}</p>}

        {items && items.length === 0 && (
          <p class="py-8 text-center text-sm text-muted">
            Nothing planned this week has an Ingredients section.
          </p>
        )}

        {items && items.length > 0 && (
          <>
            <div class="flex items-baseline justify-between gap-3 px-1">
              <p class="min-w-0 text-sm text-muted">
                Uncheck anything you already have.
              </p>
              {/* Padded out to a real thumb target, then pulled back by the
                  same amount so it still sits on the hint's baseline. */}
              <button
                type="button"
                class="-my-2 shrink-0 px-1 py-2 text-sm text-muted underline underline-offset-4"
                onClick={toggleAll}
              >
                {allOn ? "Uncheck all" : "Select all"}
              </button>
            </div>
            <ul class="card divide-y divide-line overflow-hidden">
              {items.map((item) => {
                const off = skip.has(item.name);
                return (
                  <li key={item.name}>
                    {/* The row is the hit area, same as the list screen. */}
                    <label class="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5">
                      <input
                        type="checkbox"
                        class="check appearance-none"
                        checked={!off}
                        onChange={() => toggle(item.name)}
                      />
                      <span class="min-w-0 flex-1">
                        <span
                          class={`block leading-snug ${
                            off ? "text-faint line-through" : ""
                          }`}
                        >
                          {item.text}
                        </span>
                        {item.sources.length > 0 && (
                          <span class="mt-0.5 block truncate text-xs text-faint">
                            {item.sources.join(" · ")}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Sheet>
  );
}
