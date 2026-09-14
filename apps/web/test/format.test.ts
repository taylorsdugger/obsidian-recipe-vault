import { describe, expect, it } from "vitest";

import { madeToday } from "../src/client/format";
import { addDays, dateKey } from "../src/client/week";

/**
 * What greys out "Mark made". The trap is the same one the week maths has: a
 * date written in UTC is not the date you are standing in, and this has to say
 * "already done" for a dinner cooked this evening either way.
 */
describe("madeToday", () => {
  const today = dateKey(new Date());

  it("is true for today", () => {
    expect(madeToday(today)).toBe(true);
  });

  it("is false for a recipe never made, or made before today", () => {
    expect(madeToday(null)).toBe(false);
    expect(madeToday(dateKey(addDays(new Date(), -1)))).toBe(false);
    expect(madeToday("2024-01-01")).toBe(false);
  });

  it("counts a UTC-stamped tomorrow as today", () => {
    // What the Worker used to write for an evening west of Greenwich. The
    // button has to stay off, or the tap that just happened looks like it
    // didn't take.
    expect(madeToday(dateKey(addDays(new Date(), 1)))).toBe(true);
  });
});
