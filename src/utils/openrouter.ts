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
  } catch (_error) {
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

export type ChatMessage = { role: "user" | "assistant"; content: string };

export interface RecipeChatRequest {
  apiKey: string;
  model: string;
  /** Full conversation history including the latest user message. */
  messages: ChatMessage[];
  /** Optional custom system prompt. Falls back to a default if omitted. */
  systemPrompt?: string;
  timeoutMs: number;
}

export async function requestRecipeChatResponse(
  req: RecipeChatRequest,
): Promise<string> {
  const systemContent =
    req.systemPrompt?.trim() ||
    "You are a helpful cooking assistant. Answer questions about recipes concisely and helpfully.";

  const messages: OpenRouterMessage[] = [
    { role: "system", content: systemContent },
    ...req.messages,
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

  return content.trim();
}
