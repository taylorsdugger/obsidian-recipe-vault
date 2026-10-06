import { useEffect, useRef, useState } from "preact/hooks";

import { api, type ListItem } from "../api";
import { Icon } from "../components/icon";
import { splitAmount } from "../format";

/** Poll while the screen is open (locked decision 4). Five seconds is enough. */
const POLL_MS = 5000;

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
    <li class="space-y-2 py-3">
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
          class="btn-primary min-h-11 shrink-0 text-sm"
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
          class="text-sm text-danger underline underline-offset-4 disabled:opacity-40"
          disabled={busy}
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
      {/* Where it came from, so you can see what you're about to overwrite. */}
      {item.sources.length > 0 && (
        <p class="text-xs text-muted">{item.sources.join(" · ")}</p>
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
    <li class="flex items-center gap-0.5">
      {/* The row is the hit area, not the box. */}
      <label class="check-row min-w-0 flex-1 px-1 py-1.5">
        <input
          type="checkbox"
          class="check appearance-none"
          checked={item.checked}
          onChange={() => onToggle(item)}
        />
        <span class="min-w-0 flex-1">
          <span
            class={`block text-base leading-snug ${
              item.checked ? "text-muted line-through" : ""
            }`}
          >
            {item.checked && amount && (
              <span class="tabular-nums">{amount} </span>
            )}
            {name}
          </span>
          {/* What was lifted off the name to merge it, then where it came
              from. One line: on a phone this is already the narrow part. */}
          {!item.checked && (item.detail || item.sources.length > 0) && (
            <span class="mt-px block truncate text-xs text-muted">
              {[item.detail, ...item.sources].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
        {/* The amount sits on the right, where a column of them can be
            scanned. The stepper is the number when there is one, so printing
            it here as well would say "3" twice. */}
        {amount && !stepper && !item.checked && (
          <span class="shrink-0 text-sm text-muted tabular-nums">{amount}</span>
        )}
      </label>

      {/* Quiet on purpose. These repeat down the whole list, and the job on
          this screen is ticking things off, not counting them. */}
      {stepper && (
        <div class="flex shrink-0 items-center text-muted">
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
          <span class="w-4 text-center text-sm font-medium text-ink tabular-nums">
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
        class="icon-btn -mr-1 size-8 shrink-0 text-muted active:bg-canvas"
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
    // Clears the add bar docked above the tab bar.
    <div class="screen space-y-4 pb-28 lg:space-y-5 lg:pb-12">
      <header class="screen-title">
        <div class="min-w-0">
          <p class="truncate text-note text-muted">
            {items === null
              ? "\u00a0"
              : `${todo.length} to get · ${done.length} in cart`}
          </p>
          <h1 class="title-display">List</h1>
        </div>
        {/* Only when there is something to fix; a list that's already
            combined and in order has nothing to offer here. */}
        <div class="flex shrink-0 gap-2">
          {needsTidying(items ?? []) && (
            <button
              type="button"
              class="btn-quiet shrink-0"
              disabled={busy}
              onClick={() => void tidy()}
            >
              Tidy up
            </button>
          )}
          {/* On a phone this is a link at the top of the cart group. */}
          {done.length > 0 && (
            <button
              type="button"
              class="btn-quiet hidden min-h-12 px-5.5 text-row font-semibold lg:inline-flex"
              disabled={busy}
              onClick={() => void clearChecked()}
            >
              Clear checked
            </button>
          )}
        </div>
      </header>

      {/* Docked by the thumb, over the tab bar, where adding the thing you
          just remembered is one reach from wherever the list is scrolled.
          On a desktop it drops into the page under the title instead, which
          is why it sits here in the markup. */}
      <form
        class="action-bar lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none"
        onSubmit={(event) => void add(event)}
      >
        <div class="mx-auto flex w-full max-w-2xl items-center gap-2 lg:mx-0 lg:max-w-140">
          <input
            class="field-round flex-1"
            aria-label="Add an item"
            placeholder="Add an item"
            enterKeyHint="done"
            value={entry}
            onInput={(e) => setEntry((e.target as HTMLInputElement).value)}
          />
          <button
            class="btn-primary size-13 min-h-0 shrink-0 p-0"
            type="submit"
            aria-label="Add item"
            disabled={busy || entry.trim().length === 0}
          >
            <Icon name="plus" class="size-[22px]" stroke={2} />
          </button>
        </div>
      </form>

      {error && <p class="text-sm text-danger">{error}</p>}

      {items && items.length === 0 && (
        <div class="py-16 text-center">
          <p class="text-muted">Nothing on the list.</p>
          <p class="mt-1 text-sm text-muted">
            Add something below, or send ingredients from a recipe.
          </p>
        </div>
      )}

      {/* One group per aisle. The header is what stops you walking back
          across the shop for the onion that came from the eighth recipe.
          A desktop has the width for two columns of them, each a card. */}
      {(todo.length > 0 || done.length > 0) && (
        <div class="space-y-1.5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 lg:space-y-0">
          {byAisle(todo).map((group) => (
            <section
              key={group.label}
              class="lg:rounded-[20px] lg:border lg:border-line lg:bg-surface lg:px-2.5 lg:pt-3.5 lg:pb-2.5"
            >
              <h2 class="label flex justify-between px-1 pt-3 pb-1 text-muted lg:px-2 lg:pt-0 lg:pb-1.5">
                <span>{group.label}</span>
                <span class="tabular-nums">{group.items.length}</span>
              </h2>
              <ul class="divide-y divide-line lg:divide-y-0">
                {group.items.map(row)}
              </ul>
            </section>
          ))}

          {done.length > 0 && (
            <section class="lg:rounded-[20px] lg:border lg:border-line lg:bg-surface lg:px-2.5 lg:pt-3.5 lg:pb-2.5">
              <div class="flex items-baseline justify-between px-1 pt-3 pb-1 lg:px-2 lg:pt-0 lg:pb-1.5">
                <h2 class="label flex-1 text-muted">In cart</h2>
                <span class="label hidden text-muted tabular-nums lg:inline">
                  {done.length}
                </span>
                <button
                  type="button"
                  class="-my-2 py-2 text-sm text-muted underline underline-offset-4 lg:hidden disabled:opacity-40"
                  disabled={busy}
                  onClick={() => void clearChecked()}
                >
                  Clear {done.length}
                </button>
              </div>
              {/* The group already says they're in the cart, so the rows don't
              tint as well - a block of highlighted rows reads as selected. */}
              <ul class="divide-y divide-line lg:divide-y-0 [&_.check-row]:bg-transparent">
                {done.map(row)}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
