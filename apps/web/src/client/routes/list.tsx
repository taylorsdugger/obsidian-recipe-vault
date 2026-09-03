import { useEffect, useRef, useState } from "preact/hooks";

import { api, type ListItem } from "../api";

/** Poll while the screen is open (locked decision 4). Five seconds is enough. */
const POLL_MS = 5000;

export function List() {
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState("");
  const [busy, setBusy] = useState(false);

  /**
   * Ids the user just tapped, held until the server confirms. A poll landing
   * mid-flight would otherwise snap the checkbox back and make the tap feel
   * like it didn't take.
   */
  const pending = useRef<Set<string>>(new Set());

  useEffect(() => {
    let stopped = false;

    const load = async () => {
      try {
        const res = await api.list();
        if (stopped) return;
        setItems((current) =>
          res.items.map((item) => {
            if (!pending.current.has(item.id)) return item;
            const local = current?.find((c) => c.id === item.id);
            return local ? { ...item, checked: local.checked } : item;
          }),
        );
        setError(null);
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : String(err));
      }
    };

    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  const toggle = async (item: ListItem) => {
    const next = !item.checked;
    // Optimistic: flip it now, reconcile when the server answers.
    setItems(
      (current) =>
        current?.map((c) => (c.id === item.id ? { ...c, checked: next } : c)) ??
        null,
    );
    pending.current.add(item.id);
    try {
      await api.setChecked(item.id, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems(
        (current) =>
          current?.map((c) =>
            c.id === item.id ? { ...c, checked: item.checked } : c,
          ) ?? null,
      );
    } finally {
      pending.current.delete(item.id);
    }
  };

  const add = async (event: Event) => {
    event.preventDefault();
    const line = entry.trim();
    if (!line) return;
    setBusy(true);
    try {
      const res = await api.addToList([line]);
      setItems(res.items);
      setEntry("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const clearChecked = async () => {
    setBusy(true);
    try {
      await api.clearChecked();
      const res = await api.list();
      setItems(res.items);
    } finally {
      setBusy(false);
    }
  };

  const checkedCount = items?.filter((item) => item.checked).length ?? 0;

  return (
    <div class="space-y-4 p-4">
      <form class="flex gap-2" onSubmit={add}>
        <input
          class="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2"
          placeholder="Add an item"
          value={entry}
          onInput={(e) => setEntry((e.target as HTMLInputElement).value)}
        />
        <button
          class="shrink-0 rounded-lg bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
          type="submit"
          disabled={busy || entry.trim().length === 0}
        >
          Add
        </button>
      </form>

      {error && <p class="text-sm text-red-600">{error}</p>}

      {items && items.length === 0 && (
        <p class="py-8 text-center text-sm text-neutral-500">
          The list is empty.
        </p>
      )}

      <ul class="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
        {items?.map((item) => (
          <li key={item.id}>
            <label class="flex items-start gap-3 p-3">
              <input
                type="checkbox"
                class="mt-1"
                checked={item.checked}
                onChange={() => toggle(item)}
              />
              <span class="min-w-0 flex-1">
                <span
                  class={`block text-sm ${
                    item.checked ? "text-neutral-400 line-through" : ""
                  }`}
                >
                  {item.text}
                </span>
                {item.sources.length > 0 && (
                  <span class="block text-xs text-neutral-400">
                    {item.sources.join(", ")}
                  </span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>

      {checkedCount > 0 && (
        <button
          type="button"
          class="w-full rounded-lg bg-neutral-200 py-2 text-sm disabled:opacity-50"
          disabled={busy}
          onClick={clearChecked}
        >
          Clear {checkedCount} checked
        </button>
      )}
    </div>
  );
}
