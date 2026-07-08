import { requestUrl } from "obsidian";

export interface RecipeEditRequest {
  apiKey: string;
  model: string;
  prompt: string;
  recipeIngredient: string[];
  recipeInstructions: string[];
  timeoutMs: number;
  systemPrompt?: string;
}

export interface RecipeEditSuggestion {
  summary: string;
  recipeIngredient: string[];
  recipeInstructions: string[];
  suggestEdits: boolean;
}

interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenRouterChoice {
  message?: {
    content?: string;
  };
  finish_reason?: string;
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  error?: {
    message?: string;
  };
}

interface ParsedRecipeEditPayload {
  summary?: unknown;
  recipeIngredient?: unknown;
  recipeInstructions?: unknown;
  suggestEdits?: unknown;
}

function cleanBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function cleanStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function extractJsonBlock(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return raw.slice(start, end + 1).trim();
  }

  return raw.trim();
}

function parseSuggestionPayload(content: string): RecipeEditSuggestion {
  const jsonText = extractJsonBlock(content);
  let parsed: ParsedRecipeEditPayload;

  try {
    parsed = JSON.parse(jsonText) as ParsedRecipeEditPayload;
  } catch {
    throw new Error("AI response was not valid JSON.");
  }

  const recipeIngredient = cleanStringList(parsed.recipeIngredient);
  const recipeInstructions = cleanStringList(parsed.recipeInstructions);
  const summary =
    typeof parsed.summary === "string"
      ? parsed.summary.trim()
      : "Suggested changes generated.";
  const suggestEdits = cleanBoolean(parsed.suggestEdits);

  if (recipeIngredient.length === 0 || recipeInstructions.length === 0) {
    throw new Error(
      "AI response did not include usable ingredient and instruction lists.",
    );
  }

  return {
    summary,
    recipeIngredient,
    recipeInstructions,
    suggestEdits: suggestEdits ?? true,
  };
}

function getErrorMessage(status: number, bodyErrorMessage?: string): string {
  if (status === 401 || status === 403) {
    return "OpenRouter rejected the API key. Check your settings and try again.";
  }
  if (status === 429) {
    return "OpenRouter rate limit reached. Please wait and try again.";
  }
  if (status >= 500) {
    return "OpenRouter service error. Please try again shortly.";
  }
  return bodyErrorMessage?.trim() || "OpenRouter request failed.";
}

function buildMessages(req: RecipeEditRequest): OpenRouterMessage[] {
  const schema = {
    summary: "One short sentence explaining what changed.",
    suggestEdits:
      "Boolean. Use false when no ingredient/instruction edits are needed for the prompt.",
    recipeIngredient: ["string"],
    recipeInstructions: ["string"],
  };

  const baseSystem =
    "You edit recipes. Return only valid JSON with this exact shape: " +
    JSON.stringify(schema) +
    ". Keep ingredient and instruction wording concise and practical.";

  const systemContent = req.systemPrompt?.trim()
    ? `${req.systemPrompt.trim()}\n\n${baseSystem}`
    : baseSystem;

  const userPrompt = [
    "Goal:",
    req.prompt.trim(),
    "",
    "Current ingredients:",
    ...req.recipeIngredient.map((item) => `- ${item}`),
    "",
    "Current instructions:",
    ...req.recipeInstructions.map((item) => `- ${item}`),
    "",
    "Rules:",
    "- Always return all required fields.",
    "- If no edits are needed, set suggestEdits to false and return the original arrays unchanged.",
    "- Respect the user goal and preserve recipe intent.",
    "- If substituting ingredients, update steps accordingly.",
    "- Return complete replacement arrays for both ingredients and instructions.",
  ].join("\n");

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userPrompt },
  ];
}

export async function requestRecipeEditSuggestion(
  req: RecipeEditRequest,
): Promise<RecipeEditSuggestion> {
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
        messages: buildMessages(req),
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
      throw: false,
    }),
    new Promise<never>((_resolve, reject) => {
      window.setTimeout(() => {
        reject(
          new Error("AI request timed out. Try again with a simpler prompt."),
        );
      }, req.timeoutMs);
    }),
  ]);

  const payload = response.json as OpenRouterResponse | undefined;

  if (response.status < 200 || response.status >= 300) {
    throw new Error(getErrorMessage(response.status, payload?.error?.message));
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content?.trim()) {
    throw new Error("OpenRouter returned an empty response.");
  }

  return parseSuggestionPayload(content);
}

// ---------------------------------------------------------------------------
// Chat-only (non-edit) request
// ---------------------------------------------------------------------------

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /**
   * For assistant turns: whether this reply offered a recipe edit. Used to
   * re-attach the sentinel token to history so the model keeps emitting it on
   * later turns instead of imitating its own token-stripped prior replies.
   */
  offeredEdit?: boolean;
};

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

export interface RecipeChatResult {
  /** Natural-language answer to show in the chat log. */
  reply: string;
  /**
   * True when actually editing the recipe would help the user. The UI turns
   * this into a "Update the recipe" button; false keeps it a plain chat.
   */
  offerEdit: boolean;
}

/**
 * Sentinel the chat model appends when a recipe edit would help. Plain prose
 * plus a marker is far more reliable across OpenRouter models than forcing
 * JSON mode on a conversational reply (Gemini via Vertex can truncate JSON
 * responses to a couple of characters).
 */
const OFFER_EDIT_TOKEN = "[OFFER_EDIT]";

function parseChatPayload(content: string): RecipeChatResult {
  const offerEdit = content.includes(OFFER_EDIT_TOKEN);
  const reply = content.split(OFFER_EDIT_TOKEN).join("").trim();
  return { reply, offerEdit };
}

export async function requestRecipeChatResponse(
  req: RecipeChatRequest,
): Promise<RecipeChatResult> {
  const baseChatSystem =
    "You are a friendly cooking assistant chatting with the user about one specific recipe. " +
    "Reply in plain conversational text, concise and warm — like a knowledgeable friend texting back. " +
    "No markdown headings or bullet lists unless genuinely helpful. " +
    "Whenever your reply contains a concrete change that could be written straight into the recipe — " +
    "a substitution, scaling, a dietary change, or expanding/inlining an ingredient into its components " +
    "(e.g. spelling out a spice blend into individual spices) — " +
    `briefly ask whether they'd like you to update the recipe, and end your reply with the exact token ${OFFER_EDIT_TOKEN} on its own. ` +
    "For general questions, tips, explanations, or when no concrete recipe change is on the table, do not include the token.";

  const systemContent = req.systemPrompt?.trim()
    ? `${req.systemPrompt.trim()}\n\n${baseChatSystem}`
    : baseChatSystem;

  const recipeContext = [
    "Recipe for reference:",
    "",
    "Ingredients:",
    ...req.recipeIngredient.map((item) => `- ${item}`),
    "",
    "Instructions:",
    ...req.recipeInstructions.map((item) => `- ${item}`),
  ].join("\n");

  const messages: OpenRouterMessage[] = [
    { role: "system", content: systemContent },
    { role: "system", content: recipeContext },
    ...req.messages.map((msg) => ({
      role: msg.role,
      content:
        msg.role === "assistant" && msg.offeredEdit
          ? `${msg.content} ${OFFER_EDIT_TOKEN}`
          : msg.content,
    })),
  ];

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
        messages,
        temperature: 0.7,
      }),
      throw: false,
    }),
    new Promise<never>((_resolve, reject) => {
      window.setTimeout(() => {
        reject(
          new Error("AI request timed out. Try again with a simpler prompt."),
        );
      }, req.timeoutMs);
    }),
  ]);

  const payload = response.json as OpenRouterResponse | undefined;

  if (response.status < 200 || response.status >= 300) {
    throw new Error(getErrorMessage(response.status, payload?.error?.message));
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content?.trim()) {
    throw new Error("OpenRouter returned an empty response.");
  }

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
