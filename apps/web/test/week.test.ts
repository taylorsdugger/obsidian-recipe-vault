import { describe, expect, it } from "vitest";

import {
  addDays,
  dateKey,
  mondayOf,
  weekDays,
  weekLabel,
} from "../src/client/week";

/**
 * The plan screen keys everything off these, and both traps here are silent:
 * a UTC conversion moves an evening onto tomorrow, and `getDay()` calls Sunday
 * zero, which puts it at the start of the wrong week.
 */
describe("week", () => {
  it("keys a date in local time, not UTC", () => {
    // 11pm on the 8th. `toISOString().slice(0, 10)` says the 9th anywhere east
    // of Greenwich, and this is the date a meal gets stored under.
    expect(dateKey(new Date(2026, 8, 8, 23, 0))).toBe("2026-09-08");
    expect(dateKey(new Date(2026, 0, 1, 0, 30))).toBe("2026-01-01");
  });

  it("puts Sunday at the end of its week, not the start", () => {
    // 2026-09-13 is a Sunday; its Monday is the 7th, not the 14th.
    expect(dateKey(mondayOf(new Date(2026, 8, 13)))).toBe("2026-09-07");
    expect(dateKey(mondayOf(new Date(2026, 8, 7)))).toBe("2026-09-07");
    expect(dateKey(mondayOf(new Date(2026, 8, 10)))).toBe("2026-09-07");
  });

  it("walks seven days from Monday", () => {
    const days = weekDays(mondayOf(new Date(2026, 8, 10)));
    expect(days).toHaveLength(7);
    expect(dateKey(days[0])).toBe("2026-09-07");
    expect(dateKey(days[6])).toBe("2026-09-13");
  });

  it("crosses a month and a year without drifting", () => {
    expect(dateKey(addDays(new Date(2026, 8, 30), 1))).toBe("2026-10-01");
    expect(dateKey(addDays(new Date(2026, 11, 31), 1))).toBe("2027-01-01");
    // A week spanning a spring-forward Sunday is still seven calendar days.
    const across = weekDays(mondayOf(new Date(2026, 2, 12)));
    expect(dateKey(across[6])).toBe("2026-03-15");
  });

  // Day and month swap order by locale, so this checks the shape rather than
  // the string: one month name for a week inside a month, two when it spans.
  it("drops the repeated month in the header", () => {
    const inside = weekLabel(new Date(2026, 8, 7));
    expect(inside).toContain("7");
    expect(inside).toContain("13");
    expect(inside.match(/Sep/g)).toHaveLength(1);

    const across = weekLabel(new Date(2026, 8, 28));
    expect(across).toContain("28");
    expect(across).toContain("4");
    expect(across).toMatch(/Sep/);
    expect(across).toMatch(/Oct/);
  });
});
