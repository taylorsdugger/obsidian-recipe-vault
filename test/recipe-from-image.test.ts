import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { requestRecipeFromImage } from "../src/utils/openrouter";
import {
  resetObsidianStub,
  setRequestUrl,
  type RequestUrlResponse,
} from "./helpers/obsidian-stub";

/**
 * Vision transcription requests ride the same `requestUrl` path as the rest of
 * the plugin, mocked here per-test. The timeout race uses `window.setTimeout`,
 * which the Node test env lacks — a no-op shim keeps the (always-mocked)
 * response the sole winner of `Promise.race`.
 */
beforeEach(() => {
  (globalThis as unknown as { window: { setTimeout: () => number } }).window = {
    setTimeout: () => 0,
  };
});

afterEach(() => resetObsidianStub());

/** Wrap model text as an OpenRouter chat-completions JSON response. */
function openRouterResponse(content: string, status = 200): RequestUrlResponse {
  return {
    status,
    text: "",
    arrayBuffer: new ArrayBuffer(0),
    headers: {},
    json: { choices: [{ message: { content } }] },
  };
}

/** Capture the parsed request body of the last `requestUrl` call. */
function captureBody(response: RequestUrlResponse): () => any {
  let lastBody: any;
  setRequestUrl((options: any) => {
    lastBody = JSON.parse(options.body);
    return response;
  });
  return () => lastBody;
}

const DATA_URL = "data:image/jpeg;base64,AAAA";

const validRecipe = {
  name: "Skillet Cornbread",
  recipeIngredient: ["1 cup cornmeal", "1/2 cup flour"],
  recipeInstructions: ["Mix dry goods.", "Bake at 400F."],
  totalTime: "PT30M",
  recipeYield: "8 slices",
  author: "Grandma",
  description: "A cast-iron classic.",
};

const baseReq = {
  apiKey: "sk-or-test",
  model: "google/gemini-2.5-flash-lite",
  timeoutMs: 45000,
};

describe("requestRecipeFromImage", () => {
  it("parses a valid JSON response into a RecipeFromImageResult", async () => {
    setRequestUrl(() => openRouterResponse(JSON.stringify(validRecipe)));

    const result = await requestRecipeFromImage({
      ...baseReq,
      images: [DATA_URL],
    });

    expect(result).toEqual({
      name: "Skillet Cornbread",
      recipeIngredient: ["1 cup cornmeal", "1/2 cup flour"],
      recipeInstructions: ["Mix dry goods.", "Bake at 400F."],
      totalTime: "PT30M",
      recipeYield: "8 slices",
      author: "Grandma",
      description: "A cast-iron classic.",
    });
  });

  it("parses JSON fenced in a markdown code block", async () => {
    const fenced = "```json\n" + JSON.stringify(validRecipe) + "\n```";
    setRequestUrl(() => openRouterResponse(fenced));

    const result = await requestRecipeFromImage({
      ...baseReq,
      images: [DATA_URL],
    });

    expect(result.name).toBe("Skillet Cornbread");
    expect(result.recipeIngredient).toHaveLength(2);
  });

  it("defaults absent optional fields to empty strings", async () => {
    setRequestUrl(() =>
      openRouterResponse(
        JSON.stringify({
          name: "Plain",
          recipeIngredient: ["salt"],
          recipeInstructions: ["Season."],
        }),
      ),
    );

    const result = await requestRecipeFromImage({
      ...baseReq,
      images: [DATA_URL],
    });

    expect(result.totalTime).toBe("");
    expect(result.recipeYield).toBe("");
    expect(result.author).toBe("");
    expect(result.description).toBe("");
  });

  it("throws a friendly error when ingredients are empty", async () => {
    setRequestUrl(() =>
      openRouterResponse(
        JSON.stringify({
          name: "Empty",
          recipeIngredient: [],
          recipeInstructions: ["Do nothing."],
        }),
      ),
    );

    await expect(
      requestRecipeFromImage({ ...baseReq, images: [DATA_URL] }),
    ).rejects.toThrow(/clearer, well-lit image/);
  });

  it("throws a friendly error when instructions are empty", async () => {
    setRequestUrl(() =>
      openRouterResponse(
        JSON.stringify({
          name: "Empty",
          recipeIngredient: ["water"],
          recipeInstructions: [],
        }),
      ),
    );

    await expect(
      requestRecipeFromImage({ ...baseReq, images: [DATA_URL] }),
    ).rejects.toThrow(/clearer, well-lit image/);
  });

  it("rejects before any request when no images are supplied", async () => {
    setRequestUrl(() => {
      throw new Error("requestUrl should not be called");
    });

    await expect(
      requestRecipeFromImage({ ...baseReq, images: [] }),
    ).rejects.toThrow(/at least one photo/);
  });

  it("maps a 401 to an API-key error", async () => {
    setRequestUrl(() => openRouterResponse("", 401));

    await expect(
      requestRecipeFromImage({ ...baseReq, images: [DATA_URL] }),
    ).rejects.toThrow(/rejected the API key/);
  });

  it("maps a 429 to a rate-limit error", async () => {
    setRequestUrl(() => openRouterResponse("", 429));

    await expect(
      requestRecipeFromImage({ ...baseReq, images: [DATA_URL] }),
    ).rejects.toThrow(/rate limit/);
  });

  it("maps a 500 to a service error", async () => {
    setRequestUrl(() => openRouterResponse("", 503));

    await expect(
      requestRecipeFromImage({ ...baseReq, images: [DATA_URL] }),
    ).rejects.toThrow(/service error/);
  });

  it("sends one image_url content part per image", async () => {
    const getBody = captureBody(
      openRouterResponse(JSON.stringify(validRecipe)),
    );

    await requestRecipeFromImage({
      ...baseReq,
      images: [
        DATA_URL,
        "data:image/png;base64,BBBB",
        "data:image/jpeg;base64,CCCC",
      ],
    });

    const body = getBody();
    const userMessage = body.messages.find((m: any) => m.role === "user");
    const imageParts = userMessage.content.filter(
      (part: any) => part.type === "image_url",
    );
    expect(imageParts).toHaveLength(3);
    expect(imageParts.map((p: any) => p.image_url.url)).toEqual([
      DATA_URL,
      "data:image/png;base64,BBBB",
      "data:image/jpeg;base64,CCCC",
    ]);
    // Exactly one text instruction precedes the images.
    expect(
      userMessage.content.filter((part: any) => part.type === "text"),
    ).toHaveLength(1);
  });

  it("prepends a custom system prompt when provided", async () => {
    const getBody = captureBody(
      openRouterResponse(JSON.stringify(validRecipe)),
    );

    await requestRecipeFromImage({
      ...baseReq,
      images: [DATA_URL],
      systemPrompt: "Always use metric units.",
    });

    const body = getBody();
    const systemMessage = body.messages.find((m: any) => m.role === "system");
    expect(systemMessage.content.startsWith("Always use metric units.")).toBe(
      true,
    );
  });
});
