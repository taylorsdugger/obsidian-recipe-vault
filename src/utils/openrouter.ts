import { requestUrl } from "obsidian";

export interface RecipeEditRequest {
  apiKey: string;
  model: string;
  prompt: string;
  recipeIngredient: string[];
  recipeInstructions: string[];
  timeoutMs: number;
}

export interface RecipeEditSuggestion {
  summary: string;
  recipeIngredient: string[];
  recipeInstructions: string[];
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

  if (recipeIngredient.length === 0 || recipeInstructions.length === 0) {
    throw new Error(
      "AI response did not include usable ingredient and instruction lists.",
    );
  }

  return {
    summary,
    recipeIngredient,
    recipeInstructions,
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
    recipeIngredient: ["string"],
    recipeInstructions: ["string"],
  };

  const systemPrompt =
    "You edit recipes. Return only valid JSON with this exact shape: " +
    JSON.stringify(schema) +
    ". Keep ingredient and instruction wording concise and practical.";

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
    "- Respect the user goal and preserve recipe intent.",
    "- If substituting ingredients, update steps accordingly.",
    "- Return complete replacement arrays for both ingredients and instructions.",
  ].join("\n");

  return [
    { role: "system", content: systemPrompt },
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
