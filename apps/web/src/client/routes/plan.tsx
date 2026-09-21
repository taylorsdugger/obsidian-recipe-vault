import { Fragment } from "preact";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";

import {
  api,
  SLOTS,
  slotOf,
  type PlanEntry,
  type PlanEntryInput,
  type RecipeSummary,
  type Slot,
} from "../api";
import { PlanListPreview } from "../components/plan-list-preview";
import { RecipePhoto } from "../components/recipe-photo";
import { RecipePicker } from "../components/recipe-picker";
import { addLeftoversNextDay } from "../leftovers";
import { navigate } from "../router";
import { scrollContainer } from "../scroll";
import {
  addDays,
  dateKey,
  dayLabel,
  dayName,
  isToday,
  mondayOf,
  weekDaysWithPeek,
  weekLabel,
} from "../week";

/**
 * One planned meal. A recipe opens; a free-text note just sits there.
 *
 * One 56px row per meal, so the whole row is a thumb target and a seven-day
 * week still fits on a phone screen. The title wraps to two lines rather than
 * truncating - "Roasted Beet Hummus Recipe" cut to "Roasted Beet Hummus Rec..."
 * tells you less than the second line costs.
 */
function EntryRow({
  entry,
  onRemove,
  onLeftovers,
  onMove,
  onGrab,
  onDrag,
  onDrop,
  onRow,
  dragging,
  shift,
  busy,
}: {
  entry: PlanEntry;
  onRemove: (entry: PlanEntry) => void;
  onLeftovers: (entry: PlanEntry) => void;
  /** The keyboard path: one place up or down within its slot. */
  onMove: (entry: PlanEntry, delta: number) => void;
  onGrab: (entry: PlanEntry, event: PointerEvent) => void;
  onDrag: (event: PointerEvent) => void;
  onDrop: () => void;
  /** Hands the row's element up so a drag can measure where the slots are. */
  onRow: (id: string, el: HTMLElement | null) => void;
  dragging: boolean;
  /**
   * How far this row is offset, in pixels: the distance the finger has moved
   * for the row being dragged, and the gap it opens for everything else.
   */
  shift: number;
  busy: boolean;
}) {
  const recipe = entry.recipe;

  return (
    <li
      ref={(el) => onRow(entry.id, el)}
      class={`flex items-center gap-1 ${
        dragging ? "relative z-10 rounded-lg bg-surface shadow-md" : ""
      }`}
      style={
        shift || dragging
          ? {
              transform: `translateY(${shift}px)`,
              // The row under the finger tracks it exactly; the ones opening a
              // gap for it slide, or the day snaps between orders.
              transition: dragging ? "none" : "transform 140ms ease",
            }
          : undefined
      }
    >
      {/*
        Order within a slot, and the same handle carries a meal to another
        slot or another day.

        `touch-none` is what makes this work on a phone: without it the browser
        claims a vertical drag as a page scroll before the first pointermove
        lands, and the row never moves. It's on the handle alone, so the rest of
        the week still scrolls normally.
      */}
      <button
          type="button"
          aria-label={`Move ${recipe ? recipe.title : (entry.note ?? "this meal")}. Drag it to another slot or another day, or use the arrow keys to reorder the day.`}
          class="-ml-1 grid w-7 shrink-0 cursor-grab touch-none place-items-center self-stretch rounded-lg text-faint transition-colors active:bg-canvas active:text-muted disabled:opacity-25"
          disabled={busy && !dragging}
          onPointerDown={(event) => onGrab(entry, event)}
          onPointerMove={(event) => onDrag(event)}
          onPointerUp={onDrop}
          onPointerCancel={onDrop}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              onMove(entry, -1);
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              onMove(entry, 1);
            }
          }}
        >
          {/* A grip. Two columns of dots is the one glyph everyone reads as
              "pick this up". */}
          <svg viewBox="0 0 10 16" class="h-5 w-3.5" aria-hidden="true">
            <g fill="currentColor">
              <circle cx="3" cy="4" r="1.1" />
              <circle cx="7" cy="4" r="1.1" />
              <circle cx="3" cy="8" r="1.1" />
              <circle cx="7" cy="8" r="1.1" />
              <circle cx="3" cy="12" r="1.1" />
              <circle cx="7" cy="12" r="1.1" />
            </g>
          </svg>
        </button>

      {recipe ? (
        <button
          type="button"
          class="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 text-left"
          onClick={() => navigate(`/recipes/${recipe.id}`)}
        >
          <RecipePhoto
            src={recipe.photoUrl}
            box="size-11 shrink-0 rounded-lg"
            mark="size-5"
          />
          <span class="min-w-0 flex-1">
            <span class="line-clamp-2 text-row leading-snug font-medium">
              {entry.leftovers && <span class="text-faint">Leftovers · </span>}
              {recipe.title}
            </span>
            {/* Cook time is about cooking it, so a reheat doesn't show one. */}
            {recipe.cookTime && !entry.leftovers && (
              <span class="mt-0.5 block text-xs text-faint">
                {recipe.cookTime}
              </span>
            )}
          </span>
        </button>
      ) : (
        <span class="flex min-h-14 min-w-0 flex-1 items-center py-2 text-row leading-snug text-muted">
          {entry.note}
        </span>
      )}

      {/* Carry it into tomorrow. Same weight as the remove x - both are quiet
          row affordances, and this is the one you reach for more often. */}
      {recipe && !entry.leftovers && (
        <button
          type="button"
          aria-label="Leftovers tomorrow"
          title="Leftovers tomorrow"
          class="icon-btn size-10 text-muted active:bg-canvas"
          disabled={busy}
          onClick={() => onLeftovers(entry)}
        >
          {/* An arrow into the next day. */}
          <svg viewBox="0 0 16 16" class="size-5" aria-hidden="true">
            <path
              d="M2.5 8 H11 M7.5 4.5 L11 8 L7.5 11.5 M13.5 3.5 V12.5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              fill="none"
            />
          </svg>
        </button>
      )}

      {/* Quiet on purpose: removing is the rarest thing you do here, and a
          heavy glyph next to every meal made the week look like a to-do list. */}
      <button
        type="button"
        aria-label="Remove"
        class="icon-btn -mr-1.5 size-10 text-faint active:bg-canvas active:text-ink"
        disabled={busy}
        onClick={() => onRemove(entry)}
      >
        <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true">
          <path
            d="M3 3 L13 13 M13 3 L3 13"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            fill="none"
          />
        </svg>
      </button>
    </li>
  );
}

/** A stroked chevron for the week nav and the peek row. Takes the text colour. */
function Chevron({
  dir,
  class: cls = "size-5",
}: {
  dir: "left" | "right";
  class?: string;
}) {
  return (
    <svg viewBox="0 0 20 20" class={cls} aria-hidden="true">
      <path
        d={dir === "left" ? "M12.5 4 L6.5 10 L12.5 16" : "M7.5 4 L13.5 10 L7.5 16"}
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** The header over a slot. Small, faint and uppercase, like the day name. */
const SLOT_LABEL: Record<Slot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

/**
 * One meal slot on one day, which is the unit a meal is dragged between.
 * `key` is `${date}:${slot}` - what the DOM measurements and the drag are
 * keyed on - and the two parts are what the writes need.
 */
interface Group {
  key: string;
  date: string;
  slot: Slot;
}

function groupKey(date: string, slot: Slot): string {
  return `${date}:${slot}`;
}

/** A meal in the air: where it came from, where it's hovering, how far it's moved. */
interface Drag {
  id: string;
  /** The slot it was picked up from, as a group key. */
  fromKey: string;
  /** Its index in that slot. */
  from: number;
  toKey: string;
  /**
   * Where it would go in `toKey`, as an insert index into that slot *as it is
   * now* - so in its own slot, the dragged row still counts as occupying a
   * place. The commit adjusts for that; the shifts below read it directly.
   */
  to: number;
  /** Pixels travelled, in the scroller's own coordinates rather than the viewport's. */
  dy: number;
  /** The dragged row's height, which is the size of the gap it leaves and opens. */
  height: number;
}

/** Where the meal actually lands once it's been lifted out of its own place. */
function landsAt(drag: Drag): number {
  const sameGroup = drag.fromKey === drag.toKey;
  return sameGroup && drag.to > drag.from ? drag.to - 1 : drag.to;
}

/**
 * How far a row slides while something is being dragged.
 *
 * The DOM order never changes mid-drag, only transforms do. Reordering the list
 * under the finger would move the element the pointer is captured on and make
 * the whole thing jitter.
 */
function shiftOf(drag: Drag | null, key: string, index: number): number {
  if (!drag) return 0;

  if (drag.fromKey === drag.toKey) {
    if (key !== drag.fromKey) return 0;
    const to = landsAt(drag);
    if (index === drag.from) return drag.dy;
    if (index > drag.from && index <= to) return -drag.height;
    if (index < drag.from && index >= to) return drag.height;
    return 0;
  }

  // Across slots: the one it left closes up behind it, the one it's over opens
  // a gap in front of it.
  if (key === drag.fromKey) {
    if (index === drag.from) return drag.dy;
    return index > drag.from ? -drag.height : 0;
  }
  if (key === drag.toKey) return index >= drag.to ? drag.height : 0;
  return 0;
}

/** The week's geometry, frozen when a meal is picked up. */
interface Grab {
  /** The finger's position at that moment, in scroller coordinates. */
  y: number;
  /** Every slot of every day, in the order they're drawn. */
  groups: {
    key: string;
    top: number;
    bottom: number;
    rows: { top: number; height: number }[];
  }[];
}

/** How close to an edge a held meal starts scrolling the week, and how fast. */
const EDGE_PX = 56;
const EDGE_SPEED = 12;

/**
 * The week plan. Monday to Sunday, three meals a day, previous and next.
 *
 * The week lives in the URL as `/plan?week=YYYY-MM-DD` so a reload or a back
 * tap lands on the week you were looking at rather than snapping to this one.
 */
export function Plan() {
  const [monday, setMonday] = useState(() => weekFromUrl());
  const [entries, setEntries] = useState<PlanEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ date: Date; slot: Slot } | null>(
    null,
  );
  const [shopping, setShopping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);

  /**
   * The live drag. State drives the render, but the handlers read this.
   *
   * A pointermove can arrive in the same tick as the pointerdown that started
   * the drag, before any re-render has happened, and a handler closing over
   * state would still see `null` and throw the move away.
   */
  const dragRef = useRef<Drag | null>(null);

  /** Each meal row's element, and each slot's, so a drag can measure the places. */
  const rowEls = useRef(new Map<string, HTMLElement>());
  const groupEls = useRef(new Map<string, HTMLElement>());
  /** The week's geometry as it stood when the meal was picked up. */
  const grabbed = useRef<Grab | null>(null);
  /** The last place the finger was, for the edge-scroll loop to re-read. */
  const pointerY = useRef(0);
  const scrolling = useRef(0);

  // Eight rows: the week, then a look at the Monday after it.
  const days = useMemo(() => weekDaysWithPeek(monday), [monday]);
  /** Every slot of every drawn day, in the order they appear on screen. */
  const groups = useMemo<Group[]>(
    () =>
      days.flatMap((date) =>
        SLOTS.map((slot) => ({
          key: groupKey(dateKey(date), slot),
          date: dateKey(date),
          slot,
        })),
      ),
    [days],
  );
  const thisWeek = dateKey(monday) === dateKey(mondayOf(new Date()));
  const from = dateKey(monday);
  /**
   * Two ends, on purpose. The fetch covers the peek row so it has something to
   * draw; the shop stops at Sunday. Buying for eight days here and eight days
   * again next week would put that Monday's dinner on the list twice.
   */
  const to = dateKey(addDays(monday, 6));
  const fetchTo = dateKey(addDays(monday, 7));

  const load = useCallback(async () => {
    try {
      const res = await api.plan(from, fetchTo);
      setEntries(res.entries);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [from, fetchTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const goto = (next: Date) => {
    setMonday(next);
    setEntries(null);
    setStatus(null);
    // replaceState, not a push: paging through weeks shouldn't fill the back
    // stack with every week you passed on the way.
    const thisWeek = dateKey(next) === dateKey(mondayOf(new Date()));
    window.history.replaceState(
      {},
      "",
      thisWeek ? "/plan" : `/plan?week=${dateKey(next)}`,
    );
  };

  /** Everything in one slot of one day, in the order the server stored it. */
  const groupOf = (date: string, slot: Slot) =>
    (entries ?? []).filter(
      (entry) => entry.date === date && slotOf(entry) === slot,
    );

  const byKey = (key: string) => {
    const group = groups.find((g) => g.key === key);
    return group ? groupOf(group.date, group.slot) : [];
  };

  /**
   * A whole day as the server wants it back: breakfast, then lunch, then
   * dinner, with any slot swapped for the version given here.
   *
   * The API stores one position sequence per day, so this is also what puts
   * a day's rows into slot order - a lunch added after dinner would otherwise
   * sit after it in the array and come back that way.
   */
  const dayWith = (
    date: string,
    changed: Partial<Record<Slot, PlanEntry[]>> = {},
  ): PlanEntry[] =>
    SLOTS.flatMap((slot) => changed[slot] ?? groupOf(date, slot));

  /** Draw a day in a new order now; the refetch that follows is the real answer. */
  const showDay = (date: string, ordered: PlanEntry[]) =>
    setEntries((current) => {
      if (!current) return current;
      const others = current.filter((e) => e.date !== date);
      // Stable sort, so `ordered`'s sequence inside the day survives.
      return [...others, ...ordered].sort((a, b) =>
        a.date.localeCompare(b.date),
      );
    });

  /**
   * Adding is a day replace: send the day as it is plus the new one. The API
   * only offers a whole-day PUT, and a day is at most a few rows.
   */
  const addTo = async (
    date: Date,
    slot: Slot,
    added: { recipeId?: string; note?: string },
  ) => {
    const key = dateKey(date);
    setBusy(true);
    setPicking(null);
    try {
      await api.setPlanDay(key, [
        ...dayWith(key).map(toInput),
        { ...added, slot },
      ]);
      await load();
      setStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Write a day back in a new order.
   *
   * The server takes position from the order of the array it's sent, so a
   * reorder is the same whole-day PUT as an add with the rows in a different
   * sequence. Which slot each row is in rides along on the row itself.
   */
  const commitOrder = async (date: string, ordered: PlanEntry[]) => {
    // A meal that springs back for a round trip after you dropped it reads as
    // a failed drag.
    showDay(date, ordered);

    setBusy(true);
    try {
      await api.setPlanDay(date, ordered.map(toInput));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await load();
    } finally {
      setBusy(false);
    }
  };

  /** One place up or down within its slot, for the arrow keys on the handle. */
  const move = async (entry: PlanEntry, delta: number) => {
    const slot = slotOf(entry);
    const group = groupOf(entry.date, slot);
    const at = group.findIndex((e) => e.id === entry.id);
    const swap = at + delta;
    if (at < 0 || swap < 0 || swap >= group.length) return;

    const next = [...group];
    [next[at], next[swap]] = [next[swap], next[at]];
    await commitOrder(entry.date, dayWith(entry.date, { [slot]: next }));
  };

  const registerRow = (id: string, el: HTMLElement | null) => {
    if (el) rowEls.current.set(id, el);
    else rowEls.current.delete(id);
  };

  /** True for the slot a meal is being carried to, when that isn't its own. */
  const landingHere = (key: string) =>
    !!drag && drag.toKey === key && drag.fromKey !== key;

  const registerGroup = (key: string, el: HTMLElement | null) => {
    if (el) groupEls.current.set(key, el);
    else groupEls.current.delete(key);
  };

  /** The scroller's offset, or zero before the shell has handed it over. */
  const scrolled = () => scrollContainer()?.scrollTop ?? 0;

  /**
   * Every slot and every meal, measured in the scroller's own coordinates.
   *
   * Content coordinates, not viewport ones, so the week can scroll under a
   * held meal without any of this going stale - which is the whole reason a
   * drag from Monday to Sunday is possible on a phone at all.
   */
  const measure = (): Grab["groups"] => {
    const offset = scrolled();
    return groups.flatMap((group) => {
      const el = groupEls.current.get(group.key);
      if (!el) return [];
      const box = el.getBoundingClientRect();
      const rows = groupOf(group.date, group.slot).flatMap((entry) => {
        const row = rowEls.current.get(entry.id);
        if (!row) return [];
        const r = row.getBoundingClientRect();
        return [{ top: r.top + offset, height: r.height }];
      });
      return [
        { key: group.key, top: box.top + offset, bottom: box.bottom + offset, rows },
      ];
    });
  };

  /**
   * Pick a meal up.
   *
   * The week is measured once, here, and the drag works in that frame from then
   * on. Re-measuring as it goes would read the transforms the drag itself is
   * applying and chase its own tail.
   */
  const grab = (entry: PlanEntry, event: PointerEvent) => {
    const row = rowEls.current.get(entry.id);
    const key = groupKey(entry.date, slotOf(entry));
    const from = byKey(key).findIndex((e) => e.id === entry.id);
    if (!row || from < 0) return;

    const measured = measure();
    if (measured.length === 0) return;

    // Capture, so the rest of the gesture keeps coming here even once the
    // finger has left the handle - which it does immediately. It throws on a
    // pointer the browser has already let go of, and a drag that can't capture
    // is still better than one that dies in an exception.
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Carry on uncaptured.
    }

    const height = row.getBoundingClientRect().height;
    grabbed.current = { y: event.clientY + scrolled(), groups: measured };
    pointerY.current = event.clientY;
    dragRef.current = {
      id: entry.id,
      fromKey: key,
      from,
      toKey: key,
      to: from,
      dy: 0,
      height,
    };
    setDrag(dragRef.current);
    startEdgeScroll();
  };

  /**
   * Work out where the held meal is now: which slot, and which place in it.
   *
   * The test is the dragged row's own centre, not the finger's: grabbing a
   * two-line meal near its bottom edge would otherwise drop it into the next
   * slot a good 20px before it looked like it should.
   */
  const applyPointer = (clientY: number) => {
    const start = grabbed.current;
    const drag = dragRef.current;
    if (!drag || !start) return;

    const first = start.groups[0];
    const last = start.groups[start.groups.length - 1];
    const held = start.groups.find((g) => g.key === drag.fromKey)?.rows[
      drag.from
    ];
    if (!held) return;

    // Clamped to the week: a meal can't be dragged off either end of it.
    const dy = Math.max(
      first.top - held.top,
      Math.min(last.bottom - (held.top + held.height), clientY + scrolled() - start.y),
    );
    const centre = held.top + held.height / 2 + dy;

    const over =
      start.groups.find((g) => centre >= g.top && centre < g.bottom) ??
      (centre < first.top ? first : last);

    // The first row whose middle the meal has passed. Falling off the end means
    // it goes last, which is what dragging below every meal in a slot looks like.
    let to = over.rows.length;
    for (let i = 0; i < over.rows.length; i++) {
      if (centre < over.rows[i].top + over.rows[i].height / 2) {
        to = i;
        break;
      }
    }

    if (dy === drag.dy && to === drag.to && over.key === drag.toKey) return;
    dragRef.current = { ...drag, dy, to, toKey: over.key };
    setDrag(dragRef.current);
  };

  const dragTo = (event: PointerEvent) => {
    pointerY.current = event.clientY;
    applyPointer(event.clientY);
  };

  /**
   * Scroll the week when a meal is held near the top or bottom of it.
   *
   * Without this a drag can only reach as far as one screen, and Monday to
   * Sunday is more than one screen on a phone.
   */
  const startEdgeScroll = () => {
    if (scrolling.current) return;
    const step = () => {
      const scroller = scrollContainer();
      if (!dragRef.current || !scroller) {
        scrolling.current = 0;
        return;
      }
      const box = scroller.getBoundingClientRect();
      const above = pointerY.current - box.top;
      const below = box.bottom - pointerY.current;

      let by = 0;
      if (above < EDGE_PX) by = -EDGE_SPEED * (1 - Math.max(above, 0) / EDGE_PX);
      else if (below < EDGE_PX)
        by = EDGE_SPEED * (1 - Math.max(below, 0) / EDGE_PX);

      if (by) {
        scroller.scrollTop += by;
        applyPointer(pointerY.current);
      }
      scrolling.current = window.requestAnimationFrame(step);
    };
    scrolling.current = window.requestAnimationFrame(step);
  };

  /** Let go. A drop back where it started writes nothing. */
  const drop = () => {
    const held = dragRef.current;
    dragRef.current = null;
    grabbed.current = null;
    if (scrolling.current) {
      window.cancelAnimationFrame(scrolling.current);
      scrolling.current = 0;
    }
    setDrag(null);
    if (!held) return;

    const source = groups.find((g) => g.key === held.fromKey);
    const target = groups.find((g) => g.key === held.toKey);
    if (!source || !target) return;

    // Same slot: a reorder.
    if (held.fromKey === held.toKey) {
      const at = landsAt(held);
      if (at === held.from) return;
      const next = [...groupOf(source.date, source.slot)];
      const [moved] = next.splice(held.from, 1);
      next.splice(at, 0, moved);
      void commitOrder(
        source.date,
        dayWith(source.date, { [source.slot]: next }),
      );
      return;
    }

    const was = groupOf(source.date, source.slot);
    const moved = was.find((e) => e.id === held.id);
    if (!moved) return;
    const nextSource = was.filter((e) => e.id !== held.id);
    const nextTarget = [...groupOf(target.date, target.slot)];
    nextTarget.splice(held.to, 0, {
      ...moved,
      date: target.date,
      slot: target.slot,
    });

    // Another slot on the same day: still one write.
    if (source.date === target.date) {
      void commitOrder(
        source.date,
        dayWith(source.date, {
          [source.slot]: nextSource,
          [target.slot]: nextTarget,
        }),
      );
      return;
    }

    void commitMove(
      source.date,
      dayWith(source.date, { [source.slot]: nextSource }),
      target.date,
      dayWith(target.date, { [target.slot]: nextTarget }),
    );
  };

  /**
   * Carry a meal from one day to another.
   *
   * Two writes, because the API replaces a day at a time. The new day goes
   * first on purpose: if the second write fails the meal is on both days, which
   * you can see and delete, where the other order would just lose it.
   */
  const commitMove = async (
    fromDate: string,
    nextSource: PlanEntry[],
    toDate: string,
    nextTarget: PlanEntry[],
  ) => {
    showDay(fromDate, nextSource);
    showDay(toDate, nextTarget);

    setBusy(true);
    try {
      await api.setPlanDay(toDate, nextTarget.map(toInput));
      await api.setPlanDay(fromDate, nextSource.map(toInput));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: PlanEntry) => {
    setBusy(true);
    // Drop it now. The refetch below is the real answer, but a meal that sits
    // there for a round trip after you tapped × reads as a missed tap.
    setEntries((current) => current?.filter((e) => e.id !== entry.id) ?? null);
    try {
      await api.removePlanEntry(entry.id);
    } catch {
      // A 404 means the other phone already removed it, which is the state we
      // just drew. Either way the refetch settles it.
    } finally {
      await load();
      setBusy(false);
    }
  };

  const leftovers = async (entry: PlanEntry) => {
    if (!entry.recipe) return;
    setBusy(true);
    try {
      const res = await addLeftoversNextDay(
        entry.date,
        entry.recipe,
        slotOf(entry),
      );
      setStatus(
        res.added
          ? `Leftovers added to ${dayLabel(new Date(`${res.date}T00:00:00`))}.`
          : `That day already has those leftovers.`,
      );
      // Tomorrow may be next week - Sunday's leftovers land on Monday - in
      // which case this refetch won't show it and the status line is all you get.
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Leftovers don't buy anything, so a week holding only reheats would open a
  // preview with nothing in it. The peek row doesn't count either - it isn't in
  // this week's shop, and offering to buy for a week with nothing but that row
  // planned would open an empty preview.
  const planned =
    entries?.some(
      (entry) => entry.recipe && !entry.leftovers && entry.date <= to,
    ) ?? false;

  return (
    // Clears the tab bar plus the shopping-list bar sitting above it, so the
    // last day's "Add" is still tappable at the bottom of the scroll.
    <div class="pb-28">
      <header class="screen-head">
        <div class="mx-auto flex max-w-2xl items-center gap-3 px-3 py-2">
          {/* Real buttons, not bare glyphs. The first version was a 9px "‹"
              in the corner of the header, which nobody could find and fewer
              could hit. */}
          <button
            type="button"
            aria-label="Previous week"
            class="icon-btn-quiet"
            onClick={() => goto(addDays(monday, -7))}
          >
            <Chevron dir="left" />
          </button>
          <div class="min-w-0 flex-1 text-center">
            <h1 class="truncate text-base leading-tight font-semibold">
              {weekLabel(monday)}
            </h1>
            {/* The line under the title is either a quiet "this week" or the
                way back to it, so the header is the same height either way. */}
            {thisWeek ? (
              <p class="text-xs text-faint">This week</p>
            ) : (
              <button
                type="button"
                class="-my-1 px-2 py-1 text-xs font-medium text-accent-ink underline underline-offset-4 active:text-ink"
                onClick={() => goto(mondayOf(new Date()))}
              >
                Back to this week
              </button>
            )}
          </div>
          <button
            type="button"
            aria-label="Next week"
            class="icon-btn-quiet"
            onClick={() => goto(addDays(monday, 7))}
          >
            <Chevron dir="right" />
          </button>
        </div>
      </header>

      {error && <p class="px-4 pt-3 text-sm text-red-700">{error}</p>}
      {status && (
        <p class="mx-3 mt-3 rounded-xl bg-surface px-3 py-2 text-sm text-muted">
          {status}
        </p>
      )}

      {/* One list, not seven cards. A week has to read as a week, and seven
          separate cards cost 865px of scroll for 812px of screen. */}
      {/* Capped and centred. Left full width, a 1100px row strands the remove
          button half a screen from the meal it belongs to. */}
      {/* Full bleed on a phone: the card's side margins and border were 26px
          the meal titles couldn't have, and the week already fills the screen
          edge to edge. It goes back to a card from `sm` up. */}
      <div class="screen">
        <ul class="card -mx-3 divide-y divide-line overflow-hidden rounded-none border-x-0 sm:mx-0 sm:rounded-2xl sm:border-x">
          {days.map((date, index) => {
            const key = dateKey(date);
            const today = isToday(date);
            // The eighth row is next week's Monday. Everything on it works the
            // same; the label above it is what says which week you're in.
            const peek = index === 7;

            return (
              // Keyed, because the divider makes this two siblings per day.
              <Fragment key={key}>
                {peek && (
                  <li class="border-t-2 border-line">
                    <button
                      type="button"
                      class="flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm text-muted active:bg-canvas"
                      onClick={() => goto(addDays(monday, 7))}
                    >
                      <span class="font-medium">Next week</span>
                      <span class="h-px flex-1 bg-line" />
                      <Chevron dir="right" class="size-4 text-faint" />
                    </button>
                  </li>
                )}
                <li class={`flex gap-2 px-3 py-2 ${today ? "bg-accent/6" : ""}`}>
                  {/* Fixed-width date gutter, so every day lines up down the
                      left however many meals it holds. */}
                  <div class="w-10 shrink-0 pt-1 text-center">
                    <div
                      class={`label leading-none ${
                        today ? "text-accent-ink" : "text-faint"
                      }`}
                    >
                      {dayName(date)}
                    </div>
                    <div
                      class={`mx-auto mt-1 grid size-8 place-items-center text-base leading-none font-semibold ${
                        today ? "rounded-full bg-accent text-white" : "text-ink"
                      }`}
                    >
                      {date.getDate()}
                    </div>
                  </div>

                  {/* Three slots, always, even when empty. The header is the
                      only thing that says where the next meal goes, and a slot
                      that only appeared once it had something in it would have
                      nowhere to drop a meal into. */}
                  <div class="min-w-0 flex-1">
                    {SLOTS.map((slot) => {
                      const k = groupKey(key, slot);
                      const meals = groupOf(key, slot);
                      return (
                        <section
                          key={slot}
                          ref={(el) => registerGroup(k, el)}
                          aria-label={`${SLOT_LABEL[slot]}, ${dayName(date)} ${dayLabel(date)}`}
                          class={`-mx-1 rounded-lg px-1 transition-colors ${
                            // The slot a held meal would land in. Worth saying
                            // out loud: an empty slot has no rows to slide
                            // aside, so without this there'd be no sign the
                            // drop was going to land there.
                            landingHere(k) ? "bg-accent/12" : ""
                          }`}
                        >
                          {/* The header carries the add. One row does both
                              jobs, where a header line plus an add line for
                              each of 21 slots would have doubled the scroll. */}
                          <div class="flex items-center justify-between">
                            <h3 class="label text-faint">{SLOT_LABEL[slot]}</h3>
                            <button
                              type="button"
                              aria-label={`Add to ${SLOT_LABEL[slot].toLowerCase()}, ${dayName(date)} ${dayLabel(date)}`}
                              class="icon-btn -mr-1.5 size-10 text-faint active:bg-canvas active:text-ink"
                              disabled={busy && !drag}
                              onClick={() => setPicking({ date, slot })}
                            >
                              <span class="add-inline-mark" aria-hidden="true">
                                +
                              </span>
                            </button>
                          </div>

                          {meals.length > 0 && (
                            <ul class="divide-y divide-line/70 pb-1">
                              {meals.map((entry, n) => (
                                <EntryRow
                                  key={entry.id}
                                  entry={entry}
                                  onRemove={(target) => void remove(target)}
                                  onLeftovers={(target) => void leftovers(target)}
                                  onMove={(target, delta) => void move(target, delta)}
                                  onGrab={grab}
                                  onDrag={dragTo}
                                  onDrop={drop}
                                  onRow={registerRow}
                                  dragging={drag?.id === entry.id}
                                  shift={shiftOf(drag, k, n)}
                                  busy={busy}
                                />
                              ))}
                            </ul>
                          )}
                        </section>
                      );
                    })}
                  </div>
                </li>
              </Fragment>
            );
          })}
        </ul>
      </div>

      {/* Above the tab bar, same place the recipe screen puts its send button. */}
      {planned && (
        <div class="action-bar">
          <div class="mx-auto w-full max-w-2xl">
            <button
              type="button"
              class="btn-primary w-full"
              onClick={() => setShopping(true)}
            >
              Shopping list for this week
            </button>
          </div>
        </div>
      )}

      {picking && (
        <RecipePicker
          title={`${SLOT_LABEL[picking.slot]} · ${dayName(picking.date)} ${dayLabel(picking.date)}`}
          onPick={(recipe: RecipeSummary) =>
            void addTo(picking.date, picking.slot, { recipeId: recipe.id })
          }
          onNote={(text) => void addTo(picking.date, picking.slot, { note: text })}
          onClose={() => setPicking(null)}
        />
      )}

      {shopping && (
        <PlanListPreview
          from={from}
          to={to}
          onClose={() => setShopping(false)}
          onDone={(summary) => {
            setShopping(false);
            setStatus(summary);
          }}
        />
      )}
    </div>
  );
}

/**
 * A stored entry as the whole-day PUT wants it back.
 *
 * `slot` and `leftovers` have to be carried through by hand. The day is
 * rewritten whole, so anything left off here is silently reset on the way
 * past - a missing slot comes back as dinner.
 */
function toInput(entry: PlanEntry): PlanEntryInput {
  return {
    recipeId: entry.recipe?.id ?? null,
    note: entry.note,
    slot: slotOf(entry),
    leftovers: entry.leftovers,
  };
}

/** `/plan?week=2026-09-07`, falling back to the week we're in. */
function weekFromUrl(): Date {
  const week = new URLSearchParams(window.location.search).get("week");
  if (week && /^\d{4}-\d{2}-\d{2}$/.test(week)) {
    const parsed = new Date(`${week}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) return mondayOf(parsed);
  }
  return mondayOf(new Date());
}
