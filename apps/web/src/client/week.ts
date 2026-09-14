/**
 * Week maths for the plan screen.
 *
 * Everything here works in the phone's own timezone. `toISOString().slice(0,10)`
 * looks like the right way to get a `YYYY-MM-DD` and isn't: it converts to UTC
 * first, so anywhere west of Greenwich an evening plan lands on tomorrow.
 */

/** `YYYY-MM-DD` for a local date. */
export function dateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Midnight local, so day arithmetic never lands mid-day. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const next = startOfDay(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** The Monday of the week containing `date`. Sunday belongs to the week before. */
export function mondayOf(date: Date): Date {
  const day = startOfDay(date);
  // getDay(): 0 is Sunday, so Sunday goes back six days rather than forward one.
  const offset = day.getDay() === 0 ? -6 : 1 - day.getDay();
  return addDays(day, offset);
}

/** Monday through Sunday. */
export function weekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/**
 * The eight rows the plan draws: Monday through Sunday, then the Monday after.
 *
 * That last day belongs to the next week and shows up there again as its first
 * row. The duplicate is the point - on Saturday what you want to know is what
 * Monday looks like, and paging forward to find out loses the week you were
 * reading. The week itself is still the seven, which is what the header labels
 * and what the shop buys for.
 */
export function weekDaysWithPeek(monday: Date): Date[] {
  return Array.from({ length: 8 }, (_, i) => addDays(monday, i));
}

/** "Mon". */
export function dayName(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

/** "8 Sep" for one day of the strip's header. */
export function dayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * The header over the week. `formatRange` drops the month when both ends share
 * one ("Sep 7 - 13") and keeps both when they don't ("Sep 28 - Oct 4"), in
 * whatever order the phone's locale puts day and month. Doing that by hand
 * reads fine in one locale and backwards in the next.
 */
const RANGE = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});

export function weekLabel(monday: Date): string {
  return RANGE.formatRange(monday, addDays(monday, 6));
}

export function isToday(date: Date): boolean {
  return dateKey(date) === dateKey(new Date());
}
