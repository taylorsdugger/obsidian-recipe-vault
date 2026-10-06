import { requestUrl } from "obsidian";
import {
  buildChatMessages,
  buildEditMessages,
  cleanStringList,
  extractJsonBlock,
  openRouterContent,
  openRouterErrorMessage as getErrorMessage,
  OPENROUTER_URL,
  parseChatPayload,
  parseSuggestionPayload,
} from "@recipe-vault/core";
import type {
  ChatMessage,
  OpenRouterResponse,
  RecipeChatResult,
  RecipeEditSuggestion,
} from "@recipe-vault/core";

// The prompts and the parsing live in core, shared with the web app. What's
// left here is the request itself, through Obsidian's `requestUrl`.
export type { ChatMessage, RecipeChatResult, RecipeEditSuggestion };

export interface RecipeEditRequest {
  apiKey: string;
  model: string;
  prompt: string;
  recipeIngredient: string[];
  recipeInstructions: string[];
  timeoutMs: number;
  systemPrompt?: string;
}

export interface RecipeChatRequest {
  apiKey: string;
  model: string;
  /** Full conversation history including the latest user message. */
  messages: ChatMessage[];
  /** Current recipe, passed as context so replies can be recipe-aware. */
  recipeIngredient: string[];
  recipeInstructions: string[];
  /** Optional custom system prompt. Falls back to a default if omitted. */
  systemPrompt?: string;
  timeoutMs: number;
}

/** Post to OpenRouter and hand back the reply's text, or throw. */
async function complete(
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<string> {
  const response = await Promise.race([
    requestUrl({
      url: OPENROUTER_URL,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      throw: false,
    }),
    new Promise<never>((_resolve, reject) => {
      window.setTimeout(() => {
        reject(
          new Error("AI request timed out. Try again with a simpler prompt."),
        );
      }, timeoutMs);
    }),
  ]);

  return openRouterContent(
    response.status,
    response.json as OpenRouterResponse | undefined,
  );
}

export async function requestRecipeEditSuggestion(
  req: RecipeEditRequest,
): Promise<RecipeEditSuggestion> {
  const content = await complete(
    req.apiKey,
    {
      model: req.model,
      messages: buildEditMessages(req),
      temperature: 0.3,
      response_format: { type: "json_object" },
    },
    req.timeoutMs,
  );
  return parseSuggestionPayload(content);
}

export async function requestRecipeChatResponse(
  req: RecipeChatRequest,
): Promise<RecipeChatResult> {
  const content = await complete(
    req.apiKey,
    { model: req.model, messages: buildChatMessages(req), temperature: 0.7 },
    req.timeoutMs,
  );
  return parseChatPayload(content);
}

// ---------------------------------------------------------------------------
// Vision request — transcribe a recipe from photo(s)
// ---------------------------------------------------------------------------

export interface RecipeFromImageRequest {
  apiKey: string;
  model: string;
  /** Base64 data URLs, e.g. "data:image/jpeg;base64,...". One per page. */
  images: string[];
  timeoutMs: number;
  systemPrompt?: string;
}

export interface RecipeFromImageResult {
  name: string;
  recipeIngredient: string[];
  recipeInstructions: string[];
  totalTime: string;
  recipeYield: string;
  author: string;
  description: string;
}

interface ParsedRecipeFromImagePayload {
  name?: unknown;
  recipeIngredient?: unknown;
  recipeInstructions?: unknown;
  totalTime?: unknown;
  recipeYield?: unknown;
  author?: unknown;
  description?: unknown;
}

/**
 * OpenAI-compatible multimodal content parts. A vision user message is an array
 * of one text part plus one `image_url` part per photo — the shape OpenRouter
 * requires for image input.
 */
type VisionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface VisionMessage {
  role: "system" | "user";
  content: string | VisionContentPart[];
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildVisionMessages(req: RecipeFromImageRequest): VisionMessage[] {
  const schema = {
    name: "string",
    recipeIngredient: ["string"],
    recipeInstructions: ["string"],
    totalTime: "string",
    recipeYield: "string",
    author: "string",
    description: "string",
  };

  const baseSystem =
    "You transcribe recipes from photos of cookbook pages or recipe cards. " +
    "Return ONLY valid JSON matching this exact shape: " +
    JSON.stringify(schema) +
    ". Preserve fractions and exact quantities. Combine ingredient lines that " +
    "wrap across rows into a single entry. Keep instruction steps in order. If " +
    "a field is absent from the photo, use an empty string or empty array. Do " +
    "not invent ingredients or steps.";

  const systemContent = req.systemPrompt?.trim()
    ? `${req.systemPrompt.trim()}\n\n${baseSystem}`
    : baseSystem;

  const userText =
    req.images.length > 1
      ? "Transcribe the recipe shown across these photos into the required JSON. The images are pages of one recipe, in order."
      : "Transcribe the recipe shown in this photo into the required JSON.";

  const userContent: VisionContentPart[] = [
    { type: "text", text: userText },
    ...req.images.map(
      (url): VisionContentPart => ({ type: "image_url", image_url: { url } }),
    ),
  ];

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
}

function parseRecipeFromImagePayload(content: string): RecipeFromImageResult {
  const jsonText = extractJsonBlock(content);
  let parsed: ParsedRecipeFromImagePayload;

  try {
    parsed = JSON.parse(jsonText) as ParsedRecipeFromImagePayload;
  } catch {
    throw new Error("AI response was not valid JSON.");
  }

  const recipeIngredient = cleanStringList(parsed.recipeIngredient);
  const recipeInstructions = cleanStringList(parsed.recipeInstructions);

  if (recipeIngredient.length === 0 || recipeInstructions.length === 0) {
    throw new Error(
      "Couldn't read a recipe from that photo. Try a clearer, well-lit image.",
    );
  }

  return {
    name: cleanString(parsed.name),
    recipeIngredient,
    recipeInstructions,
    totalTime: cleanString(parsed.totalTime),
    recipeYield: cleanString(parsed.recipeYield),
    author: cleanString(parsed.author),
    description: cleanString(parsed.description),
  };
}

export async function requestRecipeFromImage(
  req: RecipeFromImageRequest,
): Promise<RecipeFromImageResult> {
  if (req.images.length === 0) {
    throw new Error("Add at least one photo before extracting the recipe.");
  }

  const response = await Promise.race([
    requestUrl({
      url: "https://openrouter.ai/api/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${req.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages: buildVisionMessages(req),
        temperature: 0.2,
        response_format: { type: "json_object" },
        // Recipes can be long; without an explicit cap the completion can be
        // truncated mid-JSON and fail to parse.
        max_tokens: 4000,
        // Transcription needs no chain-of-thought. Reasoning models (e.g.
        // Gemini 2.5) otherwise spend the token budget on hidden reasoning and
        // truncate the visible JSON. Ignored by non-reasoning models.
        reasoning: { enabled: false },
      }),
      throw: false,
    }),
    new Promise<never>((_resolve, reject) => {
      window.setTimeout(() => {
        reject(
          new Error("AI request timed out. Try again or use fewer photos."),
        );
      }, req.timeoutMs);
    }),
  ]);

  const payload = response.json as OpenRouterResponse | undefined;

  if (response.status < 200 || response.status >= 300) {
    throw new Error(getErrorMessage(response.status, payload?.error?.message));
  }

  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;
  if (!content?.trim()) {
    throw new Error("OpenRouter returned an empty response.");
  }

  if (choice?.finish_reason === "length") {
    throw new Error(
      "The recipe was too long for the model to finish. Try a model with a larger output limit, or split the recipe across fewer photos.",
    );
  }

  return parseRecipeFromImagePayload(content);
}
