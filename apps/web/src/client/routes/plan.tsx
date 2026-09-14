import { Fragment } from "preact";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";

import { api, type PlanEntry, type RecipeSummary } from "../api";
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
 * Kept to a single 44px line so a seven-day week fits on a phone screen. The
 * title wraps to two lines rather than truncating - "Roasted Beet Hummus
 * Recipe" cut to "Roasted Beet Hummus Rec..." tells you less than the second
 * line costs.
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
  /** The keyboard path: one slot up or down. */
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
      ref={(el) => onRow(entry.id, el as HTMLElement | null)}
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
        Order is the only thing standing in for breakfast, lunch and dinner,
        and the same handle carries a meal to another day.

        `touch-none` is what makes this work on a phone: without it the browser
        claims a vertical drag as a page scroll before the first pointermove
        lands, and the row never moves. It's on the handle alone, so the rest of
        the week still scrolls normally.
      */}
      <button
          type="button"
          aria-label={`Move ${recipe ? recipe.title : (entry.note ?? "this meal")}. Drag it to another slot or another day, or use the arrow keys to reorder the day.`}
          class="grid w-5 shrink-0 cursor-grab touch-none place-items-center self-stretch rounded text-faint transition-colors active:bg-canvas disabled:opacity-25"
          disabled={busy && !dragging}
          onPointerDown={(event) => onGrab(entry, event as PointerEvent)}
          onPointerMove={(event) => onDrag(event as PointerEvent)}
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
          <svg viewBox="0 0 10 16" class="size-3.5" aria-hidden="true">
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
          class="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left"
          onClick={() => navigate(`/recipes/${recipe.id}`)}
        >
          <RecipePhoto
            src={recipe.photoUrl}
            box="size-10 shrink-0 rounded-lg"
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
        <span class="min-w-0 flex-1 py-2 text-row leading-snug text-muted">
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
          class="icon-btn size-8 text-faint active:bg-canvas"
          disabled={busy}
          onClick={() => onLeftovers(entry)}
        >
          {/* An arrow into the next day. */}
          <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true">
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
        class="icon-btn size-8 text-faint active:bg-canvas"
        disabled={busy}
        onClick={() => onRemove(entry)}
      >
        <svg viewBox="0 0 16 16" class="size-3" aria-hidden="true">
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

/** A meal in the air: where it came from, where it's hovering, how far it's moved. */
interface Drag {
  id: string;
  fromDate: string;
  /** Its slot in the day it was picked up from. */
  from: number;
  toDate: string;
  /**
   * Where it would go in `toDate`, as an insert index into that day *as it is
   * now* - so on the same day, the dragged row still counts as occupying a
   * slot. The commit adjusts for that; the shifts below read it directly.
   */
  to: number;
  /** Pixels travelled, in the scroller's own coordinates rather than the viewport's. */
  dy: number;
  /** The dragged row's height, which is the size of the gap it leaves and opens. */
  height: number;
}

/** Where the meal actually lands once it's been lifted out of its own slot. */
function landsAt(drag: Drag): number {
  const sameDay = drag.fromDate === drag.toDate;
  return sameDay && drag.to > drag.from ? drag.to - 1 : drag.to;
}

/**
 * How far a row slides while something is being dragged.
 *
 * The DOM order never changes mid-drag, only transforms do. Reordering the list
 * under the finger would move the element the pointer is captured on and make
 * the whole thing jitter.
 */
function shiftOf(drag: Drag | null, date: string, index: number): number {
  if (!drag) return 0;

  if (drag.fromDate === drag.toDate) {
    if (date !== drag.fromDate) return 0;
    const to = landsAt(drag);
    if (index === drag.from) return drag.dy;
    if (index > drag.from && index <= to) return -drag.height;
    if (index < drag.from && index >= to) return drag.height;
    return 0;
  }

  // Across days: the day it left closes up behind it, the day it's over opens
  // a gap in front of it.
  if (date === drag.fromDate) {
    if (index === drag.from) return drag.dy;
    return index > drag.from ? -drag.height : 0;
  }
  if (date === drag.toDate) return index >= drag.to ? drag.height : 0;
  return 0;
}

/** The week's geometry, frozen when a meal is picked up. */
interface Grab {
  /** The finger's position at that moment, in scroller coordinates. */
  y: number;
  days: {
    date: string;
    top: number;
    bottom: number;
    rows: { top: number; height: number }[];
  }[];
}

/** How close to an edge a held meal starts scrolling the week, and how fast. */
const EDGE_PX = 56;
const EDGE_SPEED = 12;

/**
 * The week plan. Monday to Sunday, one card per day, previous and next.
 *
 * The week lives in the URL as `/plan?week=YYYY-MM-DD` so a reload or a back
 * tap lands on the week you were looking at rather than snapping to this one.
 */
export function Plan() {
  const [monday, setMonday] = useState(() => weekFromUrl());
  const [entries, setEntries] = useState<PlanEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [picking, setPicking] = useState<Date | null>(null);
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

  /** Each meal row's element, and each day's, so a drag can measure the slots. */
  const rowEls = useRef(new Map<string, HTMLElement>());
  const dayEls = useRef(new Map<string, HTMLElement>());
  /** The week's geometry as it stood when the meal was picked up. */
  const grabbed = useRef<Grab | null>(null);
  /** The last place the finger was, for the edge-scroll loop to re-read. */
  const pointerY = useRef(0);
  const scrolling = useRef(0);

  // Eight rows: the week, then a look at the Monday after it.
  const days = useMemo(() => weekDaysWithPeek(monday), [monday]);
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

  /** Everything on one day, in the order the server stored it. */
  const entriesOn = (date: Date) =>
    (entries ?? []).filter((entry) => entry.date === dateKey(date));

  const dayOf = (key: string) =>
    (entries ?? []).filter((entry) => entry.date === key);

  /**
   * Adding is a day replace: send the day as it is plus the new one. The API
   * only offers a whole-day PUT, and a day is at most a few rows.
   */
  const addTo = async (
    date: Date,
    added: { recipeId?: string; note?: string },
  ) => {
    const day = entriesOn(date);
    setBusy(true);
    setPicking(null);
    try {
      await api.setPlanDay(dateKey(date), [...day.map(toInput), added]);
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
   * sequence. No new route, no migration - `position` has been on the row all
   * along, nothing was ever setting it to anything but the add order.
   */
  const commitOrder = async (date: string, ordered: PlanEntry[]) => {
    // Draw it now. A meal that springs back for a round trip after you dropped
    // it reads as a failed drag; the refetch below is the real answer.
    setEntries((current) => {
      if (!current) return current;
      const others = current.filter((e) => e.date !== date);
      // Stable sort, so `ordered`'s sequence inside the day survives.
      return [...others, ...ordered].sort((a, b) =>
        a.date.localeCompare(b.date),
      );
    });

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

  /** One slot up or down, for the arrow keys on the handle. */
  const move = async (entry: PlanEntry, delta: number) => {
    const day = dayOf(entry.date);
    const at = day.findIndex((e) => e.id === entry.id);
    const swap = at + delta;
    if (at < 0 || swap < 0 || swap >= day.length) return;

    const next = [...day];
    [next[at], next[swap]] = [next[swap], next[at]];
    await commitOrder(entry.date, next);
  };

  const registerRow = (id: string, el: HTMLElement | null) => {
    if (el) rowEls.current.set(id, el);
    else rowEls.current.delete(id);
  };

  /** True for the day a meal is being carried to, when that isn't its own. */
  const landingHere = (key: string) =>
    !!drag && drag.toDate === key && drag.fromDate !== key;

  const registerDay = (key: string, el: HTMLElement | null) => {
    if (el) dayEls.current.set(key, el);
    else dayEls.current.delete(key);
  };

  /** The scroller's offset, or zero before the shell has handed it over. */
  const scrolled = () => scrollContainer()?.scrollTop ?? 0;

  /**
   * Every day and every meal, measured in the scroller's own coordinates.
   *
   * Content coordinates, not viewport ones, so the week can scroll under a
   * held meal without any of this going stale - which is the whole reason a
   * drag from Monday to Sunday is possible on a phone at all.
   */
  const measure = (): Grab["days"] => {
    const offset = scrolled();
    return days.flatMap((date) => {
      const key = dateKey(date);
      const el = dayEls.current.get(key);
      if (!el) return [];
      const box = el.getBoundingClientRect();
      const rows = dayOf(key).flatMap((entry) => {
        const row = rowEls.current.get(entry.id);
        if (!row) return [];
        const r = row.getBoundingClientRect();
        return [{ top: r.top + offset, height: r.height }];
      });
      return [{ date: key, top: box.top + offset, bottom: box.bottom + offset, rows }];
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
    const from = dayOf(entry.date).findIndex((e) => e.id === entry.id);
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
    grabbed.current = { y: event.clientY + scrolled(), days: measured };
    pointerY.current = event.clientY;
    dragRef.current = {
      id: entry.id,
      fromDate: entry.date,
      from,
      toDate: entry.date,
      to: from,
      dy: 0,
      height,
    };
    setDrag(dragRef.current);
    startEdgeScroll();
  };

  /**
   * Work out where the held meal is now: which day, and which slot in it.
   *
   * The test is the dragged row's own centre, not the finger's: grabbing a
   * two-line meal near its bottom edge would otherwise drop it into the next
   * day a good 20px before it looked like it should.
   */
  const applyPointer = (clientY: number) => {
    const start = grabbed.current;
    const drag = dragRef.current;
    if (!drag || !start) return;

    const first = start.days[0];
    const last = start.days[start.days.length - 1];
    const held = start.days
      .find((d) => d.date === drag.fromDate)
      ?.rows[drag.from];
    if (!held) return;

    // Clamped to the week: a meal can't be dragged off either end of it.
    const dy = Math.max(
      first.top - held.top,
      Math.min(last.bottom - (held.top + held.height), clientY + scrolled() - start.y),
    );
    const centre = held.top + held.height / 2 + dy;

    const over =
      start.days.find((d) => centre >= d.top && centre < d.bottom) ??
      (centre < first.top ? first : last);

    // The first row whose middle the meal has passed. Falling off the end means
    // it goes last, which is what dragging below every meal on a day looks like.
    let to = over.rows.length;
    for (let i = 0; i < over.rows.length; i++) {
      if (centre < over.rows[i].top + over.rows[i].height / 2) {
        to = i;
        break;
      }
    }

    if (dy === drag.dy && to === drag.to && over.date === drag.toDate) return;
    dragRef.current = { ...drag, dy, to, toDate: over.date };
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
      scrolling.current = requestAnimationFrame(step);
    };
    scrolling.current = requestAnimationFrame(step);
  };

  /** Let go. A drop back where it started writes nothing. */
  const drop = () => {
    const held = dragRef.current;
    dragRef.current = null;
    grabbed.current = null;
    if (scrolling.current) {
      cancelAnimationFrame(scrolling.current);
      scrolling.current = 0;
    }
    setDrag(null);
    if (!held) return;

    if (held.fromDate === held.toDate) {
      const at = landsAt(held);
      if (at === held.from) return;
      const next = [...dayOf(held.fromDate)];
      const [moved] = next.splice(held.from, 1);
      next.splice(at, 0, moved);
      void commitOrder(held.fromDate, next);
      return;
    }

    void commitMove(held);
  };

  /**
   * Carry a meal from one day to another.
   *
   * Two writes, because the API replaces a day at a time. The new day goes
   * first on purpose: if the second write fails the meal is on both days, which
   * you can see and delete, where the other order would just lose it.
   */
  const commitMove = async (held: Drag) => {
    const source = dayOf(held.fromDate);
    const moved = source.find((e) => e.id === held.id);
    if (!moved) return;

    const nextSource = source.filter((e) => e.id !== held.id);
    const nextTarget = [...dayOf(held.toDate)];
    nextTarget.splice(held.to, 0, { ...moved, date: held.toDate });

    setEntries((current) => {
      if (!current) return current;
      const others = current.filter(
        (e) => e.date !== held.fromDate && e.date !== held.toDate,
      );
      return [...others, ...nextSource, ...nextTarget].sort((a, b) =>
        a.date.localeCompare(b.date),
      );
    });

    setBusy(true);
    try {
      await api.setPlanDay(held.toDate, nextTarget.map(toInput));
      await api.setPlanDay(held.fromDate, nextSource.map(toInput));
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
      const res = await addLeftoversNextDay(entry.date, entry.recipe);
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
    <div class="pb-24">
      <header class="screen-head">
        <div class="mx-auto flex max-w-2xl items-center gap-1 px-1.5 py-1.5">
          <button
            type="button"
            aria-label="Previous week"
            class="icon-btn size-9 text-muted active:bg-surface"
            onClick={() => goto(addDays(monday, -7))}
          >
            ‹
          </button>
          <div class="min-w-0 flex-1 text-center">
            <h1 class="truncate text-row font-semibold">{weekLabel(monday)}</h1>
          </div>
          {/* Sits where a second nav button would, so the header keeps its
            symmetry whether or not the jump-back is showing. */}
          {thisWeek ? (
            <div class="size-9 shrink-0" />
          ) : (
            <button
              type="button"
              class="grid h-9 shrink-0 place-items-center rounded-lg px-2 text-xs font-medium text-accent-ink active:bg-surface"
              onClick={() => goto(mondayOf(new Date()))}
            >
              Today
            </button>
          )}
          <button
            type="button"
            aria-label="Next week"
            class="icon-btn size-9 text-muted active:bg-surface"
            onClick={() => goto(addDays(monday, 7))}
          >
            ›
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
      <div class="screen">
        <ul class="card divide-y divide-line overflow-hidden">
          {days.map((date, index) => {
            const day = entriesOn(date);
            const today = isToday(date);
            // The eighth row is next week's Monday. Everything on it works the
            // same; the label above it is what says which week you're in.
            const peek = index === 7;

            return (
              // Keyed, because the divider makes this two siblings per day.
              <Fragment key={dateKey(date)}>
                {peek && (
                  <li class="border-t-2 border-line">
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 px-3 py-1.5 text-left"
                      onClick={() => goto(addDays(monday, 7))}
                    >
                      <span class="label text-faint">Next week</span>
                      <span class="h-px flex-1 bg-line" />
                      <span class="text-faint">›</span>
                    </button>
                  </li>
                )}
                <li
                  ref={(el) =>
                    registerDay(dateKey(date), el as HTMLElement | null)
                  }
                  class={`flex gap-3 px-3 py-1.5 ${today ? "bg-accent/6" : ""} ${
                    // The day a held meal would land on. Worth saying out loud:
                    // an empty day has no rows to slide aside, so without this
                    // there'd be no sign the drop was going to land there.
                    landingHere(dateKey(date)) ? "bg-accent/12" : ""
                  }`}
                >
                  {/* Fixed-width date gutter, so every day lines up down the
                      left however many meals it holds. */}
                  <div class="w-9 shrink-0 pt-1.5 text-center">
                    <div class="label leading-none text-faint">
                      {dayName(date)}
                    </div>
                    <div
                      class={`mx-auto mt-1 grid size-6 place-items-center text-sm leading-none font-semibold ${
                        today ? "rounded-full bg-accent text-white" : "text-ink"
                      }`}
                    >
                      {date.getDate()}
                    </div>
                  </div>

                  <div class="min-w-0 flex-1">
                    {day.length > 0 && (
                      <ul class="divide-y divide-line/70">
                        {day.map((entry, n) => (
                          <EntryRow
                            key={entry.id}
                            entry={entry}
                            onRemove={remove}
                            onLeftovers={leftovers}
                            onMove={(target, delta) => void move(target, delta)}
                            onGrab={grab}
                            onDrag={dragTo}
                            onDrop={drop}
                            onRow={registerRow}
                            dragging={drag?.id === entry.id}
                            shift={shiftOf(drag, dateKey(date), n)}
                            busy={busy}
                          />
                        ))}
                      </ul>
                    )}

                    {/* An inline affordance rather than a full-width row. Seven
                        of those were 308px, a third of the whole scroll. */}
                    <button
                      type="button"
                      class="add-inline"
                      onClick={() => setPicking(date)}
                    >
                      <span class="text-sm leading-none">+</span>
                      <span>{day.length > 0 ? "Add" : "Add a meal"}</span>
                    </button>
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
          title={`${dayName(picking)} ${dayLabel(picking)}`}
          onPick={(recipe: RecipeSummary) =>
            void addTo(picking, { recipeId: recipe.id })
          }
          onNote={(text) => void addTo(picking, { note: text })}
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
 * `leftovers` has to be carried through by hand. The day is rewritten whole,
 * so anything left off here is silently cleared on the way past.
 */
function toInput(entry: PlanEntry) {
  return {
    recipeId: entry.recipe?.id ?? null,
    note: entry.note,
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
