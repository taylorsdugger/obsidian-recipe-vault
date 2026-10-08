import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  migrateFillerWordSettings,
  type PluginSettings,
} from "../src/settings";

/**
 * Filler words used to be a dropdown: the built-in list or a custom list,
 * never both (#33). Saved settings from then have to keep producing the same
 * titles after the upgrade.
 */
describe("migrateFillerWordSettings", () => {
  const saved = (legacy: object) =>
    ({ ...structuredClone(DEFAULT_SETTINGS), ...legacy }) as PluginSettings;

  it("turns a custom list into extra words with the built-in list off", () => {
    const s = saved({ fillerWordsMode: "custom", customFillerWords: "spicy" });
    expect(migrateFillerWordSettings(s)).toBe(true);
    expect(s.useBuiltInFillerWords).toBe(false);
    expect(s.extraFillerWords).toBe("spicy");
    expect(s).not.toHaveProperty("fillerWordsMode");
    expect(s).not.toHaveProperty("customFillerWords");
  });

  it("keeps the built-in list on for auto mode", () => {
    const s = saved({ fillerWordsMode: "auto", customFillerWords: "" });
    expect(migrateFillerWordSettings(s)).toBe(true);
    expect(s.useBuiltInFillerWords).toBe(true);
    expect(s.extraFillerWords).toBe("");
    expect(s).not.toHaveProperty("fillerWordsMode");
  });

  it("leaves current settings alone", () => {
    const s = saved({});
    expect(migrateFillerWordSettings(s)).toBe(false);
    expect(s).toEqual(DEFAULT_SETTINGS);
  });
});
