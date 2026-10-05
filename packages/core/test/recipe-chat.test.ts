import { describe, expect, it } from "vitest";

import {
  buildChatMessages,
  diffLines,
  editPromptFromChat,
  hasRecipeDiff,
  OFFER_EDIT_TOKEN,
  openRouterContent,
  parseChatPayload,
  parseSuggestionPayload,
} from "../src/ai/recipe-chat";

const LISTS = {
  recipeIngredient: ["1 cup milk", "2 eggs"],
  recipeInstructions: ["Whisk.", "Cook."],
};

describe("parseChatPayload", () => {
  it("takes the offer token off the reply and says it was there", () => {
    expect(
      parseChatPayload(`Swap in oat milk. Want me to update it? ${OFFER_EDIT_TOKEN}`),
    ).toEqual({ reply: "Swap in oat milk. Want me to update it?", offerEdit: true });
    expect(parseChatPayload("It keeps 3 days.")).toEqual({
      reply: "It keeps 3 days.",
      offerEdit: false,
    });
  });
});

describe("buildChatMessages", () => {
  it("sends the recipe as context and puts the token back on offers", () => {
    const messages = buildChatMessages({
      ...LISTS,
      messages: [
        { role: "user", content: "Dairy free?" },
        { role: "assistant", content: "Use oat milk.", offeredEdit: true },
        { role: "user", content: "Yes" },
      ],
    });
    expect(messages).toHaveLength(5);
    expect(messages[1].content).toContain("- 1 cup milk");
    expect(messages[3].content).toBe(`Use oat milk. ${OFFER_EDIT_TOKEN}`);
  });
});

describe("editPromptFromChat", () => {
  it("flattens the conversation into one instruction", () => {
    expect(
      editPromptFromChat([
        { role: "user", content: "Halve it" },
        { role: "assistant", content: "Sure" },
      ]),
    ).toBe(
      "Based on this conversation, update the recipe accordingly:\n\nUser: Halve it\nAssistant: Sure",
    );
  });
});

describe("parseSuggestionPayload", () => {
  it("reads JSON out of a fenced block", () => {
    const suggestion = parseSuggestionPayload(
      '```json\n{"summary":"Oat milk.","suggestEdits":"true","recipeIngredient":["1 cup oat milk"," 2 eggs "],"recipeInstructions":["Whisk.","Cook."]}\n```',
    );
    expect(suggestion).toEqual({
      summary: "Oat milk.",
      suggestEdits: true,
      recipeIngredient: ["1 cup oat milk", "2 eggs"],
      recipeInstructions: ["Whisk.", "Cook."],
    });
  });

  it("refuses a reply without both lists", () => {
    expect(() =>
      parseSuggestionPayload('{"recipeIngredient":["x"],"recipeInstructions":[]}'),
    ).toThrow("did not include usable");
    expect(() => parseSuggestionPayload("sorry")).toThrow("not valid JSON");
  });
});

describe("openRouterContent", () => {
  it("turns a bad status into words a person can act on", () => {
    expect(() => openRouterContent(401, undefined)).toThrow("API key");
    expect(() => openRouterContent(429, undefined)).toThrow("rate limit");
    expect(() =>
      openRouterContent(200, { choices: [{ message: { content: " " } }] }),
    ).toThrow("empty response");
  });
});

describe("diffLines and hasRecipeDiff", () => {
  it("shows only what changed, in order", () => {
    expect(diffLines(["a", "b", "c"], ["a", "x", "c", "d"])).toEqual([
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
      { kind: "added", text: "d" },
    ]);
    expect(diffLines(["a"], ["a"])).toEqual([]);
  });

  it("notices a change to either list", () => {
    expect(hasRecipeDiff(LISTS, { ...LISTS })).toBe(false);
    expect(
      hasRecipeDiff(LISTS, { ...LISTS, recipeInstructions: ["Whisk.", "Bake."] }),
    ).toBe(true);
  });
});
