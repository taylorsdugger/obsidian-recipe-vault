import { useEffect, useRef, useState } from "preact/hooks";

import { api, type ListItem } from "../api";

/** Poll while the screen is open (locked decision 4). Five seconds is enough. */
const POLL_MS = 5000;

/**
 * Split "2 tbsp olive oil" into its amount and its name. The API sends both
 * the formatted line and the bare name, so this is a suffix trim rather than
 * a second parse. The amount reads as secondary; the thing you're looking for
 * on a shelf is the name.
 */
function splitAmount(item: ListItem): { amount: string; name: string } {
  const name = item.name;
  if (item.text.toLowerCase().endsWith(name.toLowerCase())) {
    return {
      amount: item.text.slice(0, item.text.length - name.length).trim(),
      name: item.text.slice(item.text.length - name.length),
    };
  }
  return { amount: "", name: item.text };
}

function Row({
  item,
  onToggle,
}: {
  item: ListItem;
  onToggle: (item: ListItem) => void;
}) {
  const { amount, name } = splitAmount(item);

  return (
    <li>
      {/* The row is the hit area, not the box. */}
      <label class="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5">
        <input
          type="checkbox"
          class="check appearance-none"
          checked={item.checked}
          onChange={() => onToggle(item)}
        />
        <span class="min-w-0 flex-1">
          <span
            class={`block leading-snug ${
              item.checked ? "text-faint line-through" : ""
            }`}
          >
            {amount && (
              <span class="text-muted tabular-nums">{amount} </span>
            )}
            <span class="font-medium">{name}</span>
          </span>
          {item.sources.length > 0 && !item.checked && (
            <span class="mt-0.5 block truncate text-xs text-faint">
              {item.sources.join(" · ")}
            </span>
          )}
        </span>
      </label>
    </li>
  );
}

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

  // Checked things drop to the bottom rather than holding their place. What's
  // left to find stays together at the top, which is the whole job in a shop.
  const todo = items?.filter((item) => !item.checked) ?? [];
  const done = items?.filter((item) => item.checked) ?? [];

  return (
    <div class="space-y-4 p-4 pb-8">
      <form class="flex gap-2" onSubmit={add}>
        <input
          class="field flex-1"
          placeholder="Add an item"
          value={entry}
          onInput={(e) => setEntry((e.target as HTMLInputElement).value)}
        />
        <button
          class="btn-primary shrink-0"
          type="submit"
          disabled={busy || entry.trim().length === 0}
        >
          Add
        </button>
      </form>

      {error && <p class="text-sm text-red-700">{error}</p>}

      {items && items.length === 0 && (
        <div class="py-16 text-center">
          <p class="text-muted">Nothing on the list.</p>
          <p class="mt-1 text-sm text-faint">
            Add something above, or send ingredients from a recipe.
          </p>
        </div>
      )}

      {todo.length > 0 && (
        <section class="space-y-2">
          <div class="flex items-baseline justify-between px-1">
            <h1 class="text-lg font-semibold">To get</h1>
            <span class="text-sm text-faint">{todo.length}</span>
          </div>
          <ul class="card divide-y divide-line overflow-hidden">
            {todo.map((item) => (
              <Row key={item.id} item={item} onToggle={toggle} />
            ))}
          </ul>
        </section>
      )}

      {done.length > 0 && (
        <section class="space-y-2">
          <div class="flex items-baseline justify-between px-1">
            <h2 class="text-sm font-medium text-muted">In the basket</h2>
            <button
              type="button"
              class="text-sm text-muted underline underline-offset-4 disabled:opacity-40"
              disabled={busy}
              onClick={clearChecked}
            >
              Clear {done.length}
            </button>
          </div>
          <ul class="card divide-y divide-line overflow-hidden opacity-70">
            {done.map((item) => (
              <Row key={item.id} item={item} onToggle={toggle} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
