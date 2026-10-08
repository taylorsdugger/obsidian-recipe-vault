import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trackKeyboard } from "../src/client/keyboard";

/**
 * The keyboard is read off the visual viewport, so this fakes one: a phone
 * window 844 tall, and a viewport that shrinks and pans the way iOS's does
 * when a field takes focus.
 */
class FakeViewport extends EventTarget {
  height = 844;
  offsetTop = 0;
  scale = 1;

  move(next: Partial<Pick<FakeViewport, "height" | "offsetTop" | "scale">>) {
    Object.assign(this, next);
    this.dispatchEvent(new Event("resize"));
  }
}

let viewport: FakeViewport;
let vars: Map<string, string>;
let attrs: Set<string>;

beforeEach(() => {
  viewport = new FakeViewport();
  vars = new Map();
  attrs = new Set();
  vi.stubGlobal("window", { innerHeight: 844, visualViewport: viewport });
  vi.stubGlobal("document", {
    documentElement: {
      style: { setProperty: (k: string, v: string) => vars.set(k, v) },
      toggleAttribute: (name: string, on: boolean) =>
        on ? attrs.add(name) : attrs.delete(name),
    },
  });
  trackKeyboard();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("trackKeyboard", () => {
  it("says closed with nothing over the page", () => {
    expect(vars.get("--keyboard")).toBe("0px");
    expect(attrs.has("data-keyboard")).toBe(false);
  });

  it("measures a keyboard over the bottom of the window", () => {
    viewport.move({ height: 508 });
    expect(vars.get("--keyboard")).toBe("336px");
    expect(vars.get("--viewport-top")).toBe("0px");
    expect(attrs.has("data-keyboard")).toBe(true);
  });

  it("leaves out what the browser panned off the top", () => {
    // iOS slid the page up 200px to bring a docked field into view. The
    // keyboard is still the 336px under the visual viewport.
    viewport.move({ height: 508, offsetTop: 200 });
    expect(vars.get("--keyboard")).toBe("136px");
    expect(vars.get("--viewport-top")).toBe("200px");
  });

  it("stays open when the browser has panned nearly all the way", () => {
    viewport.move({ height: 508, offsetTop: 330 });
    expect(attrs.has("data-keyboard")).toBe(true);
    expect(vars.get("--keyboard")).toBe("6px");
  });

  it("ignores a toolbar settling by a few pixels", () => {
    viewport.move({ height: 790 });
    expect(attrs.has("data-keyboard")).toBe(false);
  });

  it("ignores a pinch zoom", () => {
    viewport.move({ height: 422, scale: 2 });
    expect(vars.get("--keyboard")).toBe("0px");
    expect(attrs.has("data-keyboard")).toBe(false);
  });

  it("clears when the keyboard goes away", () => {
    viewport.move({ height: 508 });
    viewport.move({ height: 844 });
    expect(vars.get("--keyboard")).toBe("0px");
    expect(attrs.has("data-keyboard")).toBe(false);
  });
});
