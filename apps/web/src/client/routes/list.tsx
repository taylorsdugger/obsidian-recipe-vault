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

/**
 * Whether this row gets a − / + .
 *
 * Countables only. "2 lemons" steps; "1/2 tsp cumin" does not, because nobody
 * stands in a shop adding teaspoons, and a stepper on it would turn half a
 * teaspoon into one and a half. Measures are changed by typing, in the edit
 * box, where you can write whatever the recipe actually said.
 *
 * A fractional count ("1 1/2 onions") is left alone for the same reason.
 */
function countable(item: ListItem): boolean {
  return item.unit === "" && Number.isInteger(item.amount);
}

/** No number on the line means one of it. That's the default. */
function countOf(item: ListItem): number {
  return item.amount > 0 ? item.amount : 1;
}

/**
 * Rows grouped under one header per aisle.
 *
 * The server sends them in aisle order, so insertion order is store order.
 * Grouping by aisle rather than by runs of the same aisle means a list that
 * hasn't been sorted yet still gets one "Produce" header instead of three.
 */
function byAisle(items: ListItem[]): { label: string; items: ListItem[] }[] {
  const groups = new Map<string, { label: string; items: ListItem[] }>();
  for (const item of items) {
    const group = groups.get(item.aisle);
    if (group) group.items.push(item);
    else groups.set(item.aisle, { label: item.aisleLabel, items: [item] });
  }
  return [...groups.values()];
}

/**
 * Whether "Tidy up" has anything to do, which is the only time it's offered.
 *
 * Two things count. The lines have drifted out of aisle order - an aisle shows
 * up, then another, then the first one again. Or two rows answer to the same
 * name, which happens on a list built before the names were normalized and
 * matters more than it looks: the row id *is* the name, so the second row's
 * checkbox ticks the first row's line.
 */
function needsTidying(items: ListItem[]): boolean {
  const seenAisle = new Set<string>();
  const seenId = new Set<string>();
  let last = "";
  for (const item of items) {
    if (seenId.has(item.id)) return true;
    seenId.add(item.id);
    if (item.aisle !== last && seenAisle.has(item.aisle)) return true;
    seenAisle.add(item.aisle);
    last = item.aisle;
  }
  return false;
}

/** A row being rewritten: one text box over the whole width, and a way out. */
function EditRow({
  item,
  onSave,
  onRemove,
  onCancel,
  busy,
}: {
  item: ListItem;
  onSave: (text: string) => void;
  onRemove: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(item.raw);

  const save = (event: Event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSave(text);
  };

  return (
    <li class="space-y-2 px-4 py-3">
      <form class="flex gap-2" onSubmit={save}>
        <input
          class="field flex-1"
          value={draft}
          autofocus
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
          }}
        />
        <button
          class="btn-primary shrink-0"
          type="submit"
          disabled={busy || draft.trim().length === 0}
        >
          Save
        </button>
      </form>
      <div class="flex items-center justify-between">
        <button
          type="button"
          class="text-sm text-muted underline underline-offset-4"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          class="text-sm text-red-700 underline underline-offset-4 disabled:opacity-40"
          disabled={busy}
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
      {/* Where it came from, so you can see what you're about to overwrite. */}
      {item.sources.length > 0 && (
        <p class="text-xs text-faint">{item.sources.join(" · ")}</p>
      )}
    </li>
  );
}

function Row({
  item,
  onToggle,
  onCount,
  onEdit,
  busy,
}: {
  item: ListItem;
  onToggle: (item: ListItem) => void;
  onCount: (item: ListItem, count: number) => void;
  onEdit: (item: ListItem) => void;
  busy: boolean;
}) {
  const { amount, name } = splitAmount(item);
  // A stepper on something already in the basket is noise; you're done with it.
  const stepper = countable(item) && !item.checked;
  const count = countOf(item);

  return (
    <li class="flex items-center gap-0.5 pr-1.5">
      {/* The row is the hit area, not the box. */}
      <label class="flex min-h-14 flex-1 cursor-pointer items-center gap-3 py-2.5 pl-4">
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
            {/* The stepper is the number when there is one, so printing it
                here as well just says "3 lemons" next to a 3. */}
            {amount && !stepper && (
              <span class="text-muted tabular-nums">{amount} </span>
            )}
            <span class="font-medium">{name}</span>
          </span>
          {/* What was lifted off the name to merge it, then where it came
              from. One line: on a phone this is already the narrow part. */}
          {!item.checked && (item.detail || item.sources.length > 0) && (
            <span class="mt-0.5 block truncate text-xs text-faint">
              {[item.detail, ...item.sources].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
      </label>

      {/* Quiet on purpose. These repeat down the whole list, and the job on
          this screen is ticking things off, not counting them. */}
      {stepper && (
        <div class="flex shrink-0 items-center text-faint">
          <button
            type="button"
            aria-label={`One fewer ${item.name}`}
            class="icon-btn size-8 active:bg-canvas"
            disabled={busy || count <= 1}
            onClick={() => onCount(item, count - 1)}
          >
            <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true">
              <path
                d="M3.5 8 H12.5"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                fill="none"
              />
            </svg>
          </button>
          <span class="w-4 text-center text-sm font-medium text-muted tabular-nums">
            {count}
          </span>
          <button
            type="button"
            aria-label={`One more ${item.name}`}
            class="icon-btn size-8 active:bg-canvas"
            disabled={busy}
            onClick={() => onCount(item, count + 1)}
          >
            <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true">
              <path
                d="M3.5 8 H12.5 M8 3.5 V12.5"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                fill="none"
              />
            </svg>
          </button>
        </div>
      )}

      <button
        type="button"
        aria-label={`Edit ${item.name}`}
        class="icon-btn size-8 shrink-0 text-faint active:bg-canvas"
        onClick={() => onEdit(item)}
      >
        {/* A pencil. */}
        <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true">
          <path
            d="M11.5 2.5 L13.5 4.5 L5.5 12.5 L2.5 13.5 L3.5 10.5 Z"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linejoin="round"
            fill="none"
          />
        </svg>
      </button>
    </li>
  );
}

export function List() {
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState("");
  const [busy, setBusy] = useState(false);
  /** The row open in the edit box, by id. One at a time. */
  const [editing, setEditing] = useState<string | null>(null);

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
        if (!stopped)
          setError(err instanceof Error ? err.message : String(err));
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
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

  const setCount = async (item: ListItem, count: number) => {
    if (count < 1) return;
    setBusy(true);
    try {
      const res = await api.setListAmount(item.id, count);
      setItems(res.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async (item: ListItem, text: string) => {
    setBusy(true);
    try {
      const res = await api.editListItem(item.id, text);
      setItems(res.items);
      setEditing(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: ListItem) => {
    setBusy(true);
    try {
      await api.removeListItem(item.id);
      const res = await api.list();
      setItems(res.items);
      setEditing(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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

  const tidy = async () => {
    setBusy(true);
    try {
      const res = await api.tidyList();
      setItems(res.items);
      setError(null);
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

  /** One row, either as it reads or as it's being rewritten. */
  const row = (item: ListItem) =>
    editing === item.id ? (
      <EditRow
        key={item.id}
        item={item}
        busy={busy}
        onSave={(text) => void save(item, text)}
        onRemove={() => void remove(item)}
        onCancel={() => setEditing(null)}
      />
    ) : (
      <Row
        key={item.id}
        item={item}
        busy={busy}
        onToggle={(target) => void toggle(target)}
        onCount={(target, count) => void setCount(target, count)}
        onEdit={(target) => setEditing(target.id)}
      />
    );

  // Checked things drop to the bottom rather than holding their place. What's
  // left to find stays together at the top, which is the whole job in a shop.
  const todo = items?.filter((item) => !item.checked) ?? [];
  const done = items?.filter((item) => item.checked) ?? [];

  return (
    <div class="screen space-y-4 pb-8">
      <form class="flex gap-2" onSubmit={(event) => void add(event)}>
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
        <section class="space-y-4">
          <div class="flex items-baseline justify-between gap-3 px-1">
            <h1 class="text-lg font-semibold">To get</h1>
            {/* Only when there is something to fix; a list that's already
                combined and in order has nothing to offer here. */}
            {needsTidying(items ?? []) ? (
              <button
                type="button"
                class="shrink-0 text-sm text-muted underline underline-offset-4 disabled:opacity-40"
                disabled={busy}
                onClick={() => void tidy()}
              >
                Tidy up
              </button>
            ) : (
              <span class="text-sm text-faint tabular-nums">{todo.length}</span>
            )}
          </div>

          {/* One card per aisle. The header is what stops you walking back
              across the shop for the onion that came from the eighth recipe. */}
          {byAisle(todo).map((group) => (
            <div key={group.label} class="space-y-1.5">
              <h2 class="px-1 text-xs font-medium uppercase tracking-wide text-faint">
                {group.label}
              </h2>
              <ul class="card divide-y divide-line overflow-hidden">
                {group.items.map(row)}
              </ul>
            </div>
          ))}
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
              onClick={() => void clearChecked()}
            >
              Clear {done.length}
            </button>
          </div>
          <ul class="card divide-y divide-line overflow-hidden opacity-70">
            {done.map(row)}
          </ul>
        </section>
      )}
    </div>
  );
}
