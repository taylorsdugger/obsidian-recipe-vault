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
import { Icon } from "../components/icon";
import { PlanListPreview } from "../components/plan-list-preview";
import { RecipePhoto } from "../components/recipe-photo";
import { RecipePicker } from "../components/recipe-picker";
import { Sheet } from "../components/sheet";
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
  startOfDay,
  weekDaysWithPeek,
  weekLabel,
} from "../week";

/**
 * One planned meal. A recipe opens; a free-text note just sits there.
 *
 * One 56px row per meal, so the whole row is a thumb target and a seven-day
 * week still fits on a phone screen. The title wraps to two lines rather than
 * truncating - "Roasted Beet Hummus Recipe" cut to "Roasted Beet Hummus Rec..."
 * tells you less than the second line costs. The slot rides on the meta line
 * under it, so the day doesn't need a header per meal.
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
  shiftX,
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
  /** Sideways travel, for the row being dragged across the desktop's week. */
  shiftX: number;
  busy: boolean;
}) {
  const recipe = entry.recipe;
  // Cook time is about cooking it, so a reheat doesn't show one.
  const meta = [
    SLOT_LABEL[slotOf(entry)],
    recipe && !entry.leftovers ? recipe.cookTime : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const metaLine = (
    <span class="mt-0.5 flex items-center gap-1.5 text-note text-muted">
      {entry.leftovers && <span class="chip-soft">Leftovers</span>}
      <span class="truncate">{meta}</span>
    </span>
  );

  return (
    <li
      ref={(el) => onRow(entry.id, el)}
      class={`group flex items-center gap-1 lg:relative lg:items-stretch ${
        dragging ? "relative z-10 rounded-xl bg-surface shadow-md" : ""
      }`}
      style={
        shift || dragging
          ? {
              transform: `translate(${shiftX}px, ${shift}px)`,
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
        aria-label={`Move ${recipe ? recipe.title : entry.note ?? "this meal"}. Drag it to another slot or another day, or use the arrow keys to reorder the day.`}
        class="-ml-1.5 grid w-6 shrink-0 cursor-grab touch-none place-items-center self-stretch rounded-lg text-faint transition-colors active:bg-canvas active:text-muted disabled:opacity-25 lg:absolute lg:top-1 lg:left-1 lg:z-10 lg:ml-0 lg:h-8 lg:bg-surface/90 lg:text-muted lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
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
              "pick this up". Faint, because it's a texture on the row more
              than a thing to read. */}
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
          class="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-1 text-left lg:flex-col lg:items-stretch lg:gap-1.5 lg:py-0"
          onClick={() => navigate(`/recipes/${recipe.id}`)}
        >
          <RecipePhoto
            src={recipe.photoUrl}
            box="size-12 shrink-0 rounded-xl lg:h-21 lg:w-full lg:rounded-[14px]"
            mark="size-6"
          />
          <span class="min-w-0 flex-1">
            <span class="line-clamp-2 text-row leading-snug font-semibold lg:line-clamp-3 lg:text-sm lg:leading-[1.3]">
              {recipe.title}
            </span>
            {metaLine}
          </span>
        </button>
      ) : (
        <span class="flex min-h-14 min-w-0 flex-1 flex-col justify-center py-1">
          <span class="text-row leading-snug text-muted">{entry.note}</span>
          {metaLine}
        </span>
      )}

      {/* Carry it into tomorrow. Same weight as the remove x - both are quiet
          row affordances, and this is the one you reach for more often. */}
      {recipe && !entry.leftovers && (
        <button
          type="button"
          aria-label="Leftovers tomorrow"
          title="Leftovers tomorrow"
          class="icon-btn size-10 text-muted active:bg-canvas lg:absolute lg:top-1 lg:z-10 lg:size-8 lg:bg-surface/90 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 lg:right-10"
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
        class="icon-btn -mr-1.5 size-10 text-muted active:bg-canvas active:text-ink lg:absolute lg:top-1 lg:z-10 lg:size-8 lg:bg-surface/90 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 lg:right-1 lg:mr-0"
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
        d={
          dir === "left"
            ? "M12.5 4 L6.5 10 L12.5 16"
            : "M7.5 4 L13.5 10 L7.5 16"
        }
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Previous / next week, as one pill. The dock's on a phone, the header's on a desktop. */
function WeekPager({
  size,
  onPrev,
  onNext,
}: {
  /** The height, since the dock's is a thumb's and the header's a pointer's. */
  size: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div class="flex shrink-0 items-center rounded-full border border-line bg-surface">
      <button
        type="button"
        aria-label="Previous week"
        class={`grid w-12 place-items-center rounded-l-full active:bg-canvas ${size}`}
        onClick={onPrev}
      >
        <Chevron dir="left" />
      </button>
      <span class="px-0.5 text-sm font-semibold">Week</span>
      <button
        type="button"
        aria-label="Next week"
        class={`grid w-12 place-items-center rounded-r-full active:bg-canvas ${size}`}
        onClick={onNext}
      >
        <Chevron dir="right" />
      </button>
    </div>
  );
}

/** What a slot is called on a meal's meta line and on its add row. */
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
  /** Sideways, which only happens on the desktop, where the days are columns. */
  dx: number;
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
  x: number;
  /**
   * Every slot of every day, in the order they're drawn. On a phone they all
   * share one column. On a desktop each day is its own, so a slot is found by
   * its column first and its height second.
   */
  groups: {
    key: string;
    top: number;
    bottom: number;
    left: number;
    right: number;
    rows: { top: number; height: number; left: number; width: number }[];
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
  /** The "Plan a meal" sheet, which asks which day and slot before the picker. */
  const [choosing, setChoosing] = useState(false);
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
  const pointerX = useRef(0);
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
      window.history.state,
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
        return [
          {
            top: r.top + offset,
            height: r.height,
            left: r.left,
            width: r.width,
          },
        ];
      });
      return [
        {
          key: group.key,
          top: box.top + offset,
          bottom: box.bottom + offset,
          left: box.left,
          right: box.right,
          rows,
        },
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
    grabbed.current = {
      y: event.clientY + scrolled(),
      x: event.clientX,
      groups: measured,
    };
    pointerY.current = event.clientY;
    pointerX.current = event.clientX;
    dragRef.current = {
      id: entry.id,
      fromKey: key,
      from,
      toKey: key,
      to: from,
      dy: 0,
      dx: 0,
      height,
    };
    setDrag(dragRef.current);
    startEdgeScroll();
  };

  /**
   * Work out where the held meal is now: which slot, and which place in it.
   *
   * The test is a point on the dragged row, not the finger: grabbing a
   * two-line meal near its bottom edge would otherwise drop it into the next
   * slot a good 20px before it looked like it should.
   */
  const applyPointer = (clientX: number, clientY: number) => {
    const start = grabbed.current;
    const drag = dragRef.current;
    if (!drag || !start) return;

    const held = start.groups.find((g) => g.key === drag.fromKey)?.rows[
      drag.from
    ];
    if (!held) return;

    // Which column the meal is over. On a phone every slot is in the one
    // column, so this keeps them all. On a desktop it's one day's three, and
    // past the first or last column it's the nearest day.
    const dx = clientX - start.x;
    const across = held.left + held.width / 2 + dx;
    const columnGap = (g: Grab["groups"][number]) =>
      across < g.left ? g.left - across : Math.max(0, across - g.right);
    const closest = Math.min(...start.groups.map(columnGap));
    const column = start.groups.filter((g) => columnGap(g) === closest);

    const first = column[0];
    const last = column[column.length - 1];

    // The point that decides where the meal lands. A phone row's centre, so
    // a two-line meal grabbed near its bottom edge doesn't drop early. On a
    // desktop card that centre is 80px below the grip under the pointer, so
    // it's capped to a phone row's half height and stays near the pointer.
    //
    // Clamped to the week on that same point. Clamping the row's edges
    // instead meant a tall card could never get it into a short empty slot
    // at the bottom of a day, so nothing could be dropped onto an empty
    // dinner.
    const middle = held.top + Math.min(held.height / 2, 28);
    const dy = Math.max(
      first.top - middle,
      Math.min(last.bottom - 1 - middle, clientY + scrolled() - start.y),
    );
    const centre = middle + dy;

    // Between two slots - a day's padding, the divider - it goes to whichever
    // is closer. A past day's empty slots draw nothing and measure zero high,
    // so they're never a target: there'd be nothing there to show it landing.
    const over =
      column.find((g) => centre >= g.top && centre < g.bottom) ??
      nearest(column, centre) ??
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

    if (
      dy === drag.dy &&
      dx === drag.dx &&
      to === drag.to &&
      over.key === drag.toKey
    )
      return;
    dragRef.current = { ...drag, dy, dx, to, toKey: over.key };
    setDrag(dragRef.current);
  };

  const dragTo = (event: PointerEvent) => {
    pointerY.current = event.clientY;
    pointerX.current = event.clientX;
    applyPointer(event.clientX, event.clientY);
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
      if (above < EDGE_PX)
        by = -EDGE_SPEED * (1 - Math.max(above, 0) / EDGE_PX);
      else if (below < EDGE_PX)
        by = EDGE_SPEED * (1 - Math.max(below, 0) / EDGE_PX);

      if (by) {
        scroller.scrollTop += by;
        applyPointer(pointerX.current, pointerY.current);
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

  const todayStart = startOfDay(new Date());
  const weeksAway = Math.round(
    (monday.getTime() - mondayOf(todayStart).getTime()) / (7 * 86_400_000),
  );
  const title =
    weeksAway === 0
      ? "This week"
      : weeksAway === 1
        ? "Next week"
        : weeksAway === -1
          ? "Last week"
          : weeksAway > 0
            ? `In ${weeksAway} weeks`
            : `${-weeksAway} weeks ago`;

  return (
    // Clears the tab bar plus the bar sitting above it, so the last day's
    // "Add" is still tappable at the bottom of the scroll.
    <div class="screen pb-28 lg:pb-12">
      <header class="screen-title">
        <div class="min-w-0">
          <p class="flex items-baseline gap-2 text-note text-muted">
            <span class="truncate">{weekLabel(monday)}</span>
            {/* Paging is down in the dock, so the way back to now goes up
                here, next to the week it's taking you away from. */}
            {!thisWeek && (
              <button
                type="button"
                class="-my-2 shrink-0 py-2 font-semibold text-accent-ink"
                onClick={() => goto(mondayOf(new Date()))}
              >
                Back to this week
              </button>
            )}
          </p>
          <h1 class="title-display">{title}</h1>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          {/* The week's shop. Only when there's something to buy for. */}
          {planned && (
            <button
              type="button"
              class="btn-quiet shrink-0"
              onClick={() => setShopping(true)}
            >
              <Icon name="cart" class="size-[18px]" />
              Shop
            </button>
          )}
          {/* The dock's controls, for a desktop that has no dock. */}
          <div class="hidden items-center gap-2 lg:flex">
            <WeekPager
              size="h-11.5"
              onPrev={() => goto(addDays(monday, -7))}
              onNext={() => goto(addDays(monday, 7))}
            />
            <button
              type="button"
              class="btn-primary min-h-12 px-5.5 text-row"
              disabled={busy && !drag}
              onClick={() => setChoosing(true)}
            >
              <Icon name="plus" class="size-[18px]" stroke={2} />
              Plan a meal
            </button>
          </div>
        </div>
      </header>

      {error && <p class="px-1 pt-1 text-sm text-danger">{error}</p>}
      {status && (
        <p class="mt-2 rounded-xl bg-surface px-3 py-2 text-sm text-muted">
          {status}
        </p>
      )}

      {/* One list, not seven cards. A week has to read as a week, and seven
          separate cards cost 865px of scroll for 812px of screen. An agenda:
          the date down the left, the meals beside it. */}
      {/* On a desktop the week is seven columns side by side, and next
          week's Monday stays off it: the pager is right there. */}
      <ul class="divide-y divide-line lg:mt-2 lg:grid lg:grid-cols-7 lg:items-start lg:gap-3 lg:divide-y-0">
        {days.map((date, index) => {
          const key = dateKey(date);
          const today = isToday(date);
          const past = date < todayStart;
          // The eighth row is next week's Monday. Everything on it works the
          // same; the label above it is what says which week you're in.
          const peek = index === 7;

          return (
            // Keyed, because the divider makes this two siblings per day.
            <Fragment key={key}>
              {peek && (
                <li class="lg:hidden">
                  <button
                    type="button"
                    class="flex min-h-11 w-full items-center gap-3 px-1 text-left text-sm text-muted active:text-ink"
                    onClick={() => goto(addDays(monday, 7))}
                  >
                    <span class="font-semibold">Next week</span>
                    <span class="h-px flex-1 bg-line" />
                    <Chevron dir="right" class="size-4" />
                  </button>
                </li>
              )}
              {/* Gone by. Still there to look back on and drag from, but it
                  steps back so the eye lands on today. */}
              <li
                class={`grid grid-cols-[52px_minmax(0,1fr)] gap-3 py-2.5 lg:min-w-0 lg:flex-col lg:py-0 ${
                  past ? "opacity-55" : ""
                } ${peek ? "lg:hidden" : "lg:flex"}`}
              >
                {/* Fixed-width date gutter, so every day lines up down the
                    left however many meals it holds. On a desktop it's the
                    column's heading instead. */}
                <div class="flex flex-col items-center gap-0.5 pt-1 lg:items-start lg:gap-1 lg:border-b lg:border-line lg:px-0.5 lg:pt-0 lg:pb-1.5">
                  <span
                    class={`label ${today ? "text-accent-ink" : "text-muted"}`}
                  >
                    {dayName(date)}
                  </span>
                  <span
                    class={`grid size-[42px] place-items-center rounded-full font-display text-[1.75rem] leading-none font-medium lg:-ml-1.5 lg:size-10 lg:text-[1.6875rem] ${
                      today ? "bg-accent-soft text-accent-ink" : ""
                    }`}
                  >
                    {date.getDate()}
                  </span>
                </div>

                {/* Three slots, always, in eating order. A filled slot is just
                    its meals; an empty one is a quiet "+ Add lunch", which is
                    also what a dragged meal drops onto. Past days skip the add
                    rows - nobody plans yesterday's lunch from here, and "Plan
                    a meal" still can. */}
                <div class="min-w-0 lg:flex lg:flex-col lg:gap-2">
                  {SLOTS.map((slot) => {
                    const k = groupKey(key, slot);
                    const meals = groupOf(key, slot);
                    return (
                      <section
                        key={slot}
                        ref={(el) => registerGroup(k, el)}
                        aria-label={`${SLOT_LABEL[slot]}, ${dayName(date)} ${dayLabel(date)}`}
                        class={`-mx-1 rounded-xl px-1 transition-colors lg:empty:hidden ${
                          // The slot a held meal would land in. Worth saying
                          // out loud: an empty slot has no rows to slide
                          // aside, so without this there'd be no sign the
                          // drop was going to land there.
                          landingHere(k) ? "bg-accent-soft" : ""
                        }`}
                      >
                        {meals.length > 0 ? (
                          <ul class="flex flex-col gap-0.5 lg:gap-3">
                            {meals.map((entry, n) => (
                              <EntryRow
                                key={entry.id}
                                entry={entry}
                                onRemove={(target) => void remove(target)}
                                onLeftovers={(target) => void leftovers(target)}
                                onMove={(target, delta) =>
                                  void move(target, delta)
                                }
                                onGrab={grab}
                                onDrag={dragTo}
                                onDrop={drop}
                                onRow={registerRow}
                                dragging={drag?.id === entry.id}
                                shift={shiftOf(drag, k, n)}
                                shiftX={drag?.id === entry.id ? drag.dx : 0}
                                busy={busy}
                              />
                            ))}
                          </ul>
                        ) : (
                          !past && (
                            <button
                              type="button"
                              aria-label={`Add ${SLOT_LABEL[slot].toLowerCase()}, ${dayName(date)} ${dayLabel(date)}`}
                              class="add-inline w-full lg:min-h-10 lg:justify-center lg:gap-1.5 lg:rounded-xl lg:border lg:border-dashed lg:border-line lg:text-note"
                              disabled={busy && !drag}
                              onClick={() => setPicking({ date, slot })}
                            >
                              <Icon name="plus" class="size-4" stroke={2} />
                              Add {SLOT_LABEL[slot].toLowerCase()}
                            </button>
                          )
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

      {/* Paging and adding, down by the thumb. The arrows used to sit in the
          header, a long reach on a phone held in one hand. */}
      <div class="action-bar lg:hidden">
        <div class="mx-auto flex w-full max-w-2xl items-center gap-2">
          <WeekPager
            size="h-13"
            onPrev={() => goto(addDays(monday, -7))}
            onNext={() => goto(addDays(monday, 7))}
          />
          <button
            type="button"
            class="btn-primary flex-1"
            disabled={busy && !drag}
            onClick={() => setChoosing(true)}
          >
            <Icon name="plus" class="size-[18px]" stroke={2} />
            Plan a meal
          </button>
        </div>
      </div>

      {choosing && (
        <Sheet title="Plan a meal" onClose={() => setChoosing(false)}>
          {/* Any day and any slot, including a second dinner or a past day,
              which the add rows in the week don't offer. */}
          <ul class="divide-y divide-line">
            {days.slice(0, 7).map((date) => (
              <li key={dateKey(date)} class="flex items-center gap-3 py-2">
                <span class="w-14 shrink-0">
                  <span
                    class={`label block ${
                      isToday(date) ? "text-accent-ink" : "text-muted"
                    }`}
                  >
                    {dayName(date)}
                  </span>
                  <span class="text-sm font-semibold">{dayLabel(date)}</span>
                </span>
                <span class="grid flex-1 grid-cols-3 gap-1.5">
                  {SLOTS.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      class="pill justify-center px-2 text-note"
                      onClick={() => {
                        setChoosing(false);
                        setPicking({ date, slot });
                      }}
                    >
                      {SLOT_LABEL[slot]}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Sheet>
      )}

      {picking && (
        <RecipePicker
          title={`${SLOT_LABEL[picking.slot]} · ${dayName(picking.date)} ${dayLabel(picking.date)}`}
          onPick={(recipe: RecipeSummary) =>
            void addTo(picking.date, picking.slot, { recipeId: recipe.id })
          }
          onNote={(text) =>
            void addTo(picking.date, picking.slot, { note: text })
          }
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
 * The slot closest to a point, for when it's in a gap between two. Slots
 * that measured nothing are skipped.
 */
function nearest(
  groups: Grab["groups"],
  y: number,
): Grab["groups"][number] | undefined {
  let best: Grab["groups"][number] | undefined;
  let gap = Infinity;
  for (const group of groups) {
    if (group.bottom - group.top < 1) continue;
    const d = y < group.top ? group.top - y : Math.max(0, y - group.bottom);
    if (d < gap) {
      gap = d;
      best = group;
    }
  }
  return best;
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
