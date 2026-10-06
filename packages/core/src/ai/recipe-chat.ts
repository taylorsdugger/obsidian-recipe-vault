/**
 * Ask AI: the prompts and the parsing, shared by the plugin and the web app.
 *
 * Nothing here makes a request. The plugin sends these messages through
 * Obsidian's `requestUrl` and the web app through the Worker's `fetch`, and
 * both hand the reply back to the parsers below. Only the recipe's
 * Ingredients and Instructions lists go to the model, and an edit comes back
 * as whole replacements for those two lists - nothing else in the note moves.
 */

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** The plugin's default model, and the web app's unless it's told otherwise. */
export const DEFAULT_AI_MODEL = "google/gemini-3.5-flash-lite";

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  error?: { message?: string };
}

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

export interface RecipeLists {
  recipeIngredient: string[];
  recipeInstructions: string[];
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

export interface RecipeEditSuggestion extends RecipeLists {
  summary: string;
  suggestEdits: boolean;
}

/**
 * Sentinel the chat model appends when a recipe edit would help. Plain prose
 * plus a marker is far more reliable across OpenRouter models than forcing
 * JSON mode on a conversational reply (Gemini via Vertex can truncate JSON
 * responses to a couple of characters).
 */
export const OFFER_EDIT_TOKEN = "[OFFER_EDIT]";

export function cleanBoolean(value: unknown): boolean | null {
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

export function cleanStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

export function extractJsonBlock(raw: string): string {
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

export function openRouterErrorMessage(
  status: number,
  bodyErrorMessage?: string,
): string {
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

/** The reply's text, or the error a person should see instead. */
export function openRouterContent(
  status: number,
  payload: OpenRouterResponse | undefined,
): string {
  if (status < 200 || status >= 300) {
    throw new Error(openRouterErrorMessage(status, payload?.error?.message));
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (!content?.trim()) {
    throw new Error("OpenRouter returned an empty response.");
  }
  return content;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export function buildChatMessages(
  req: RecipeLists & { messages: ChatMessage[]; systemPrompt?: string },
): OpenRouterMessage[] {
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

  return [
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
}

export function parseChatPayload(content: string): RecipeChatResult {
  const offerEdit = content.includes(OFFER_EDIT_TOKEN);
  const reply = content.split(OFFER_EDIT_TOKEN).join("").trim();
  return { reply, offerEdit };
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

/** Turn the conversation into a single instruction for the edit model. */
export function editPromptFromChat(messages: ChatMessage[]): string {
  const transcript = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");
  return [
    "Based on this conversation, update the recipe accordingly:",
    "",
    transcript,
  ].join("\n");
}

export function buildEditMessages(
  req: RecipeLists & { prompt: string; systemPrompt?: string },
): OpenRouterMessage[] {
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

export function parseSuggestionPayload(content: string): RecipeEditSuggestion {
  const jsonText = extractJsonBlock(content);
  let parsed: {
    summary?: unknown;
    recipeIngredient?: unknown;
    recipeInstructions?: unknown;
    suggestEdits?: unknown;
  };

  try {
    parsed = JSON.parse(jsonText) as typeof parsed;
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

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

/** Whether the suggestion changes either list at all. */
export function hasRecipeDiff(before: RecipeLists, after: RecipeLists): boolean {
  const same = (a: string[], b: string[]) =>
    a.length === b.length && a.every((line, i) => line === b[i]);
  return !(
    same(before.recipeIngredient, after.recipeIngredient) &&
    same(before.recipeInstructions, after.recipeInstructions)
  );
}

export interface DiffLine {
  kind: "removed" | "added";
  text: string;
}

/**
 * The lines one list loses and gains on the way to the other, in order. A
 * longest-common-subsequence walk, so a line that only moved past an insert
 * isn't shown as removed and re-added.
 */
export function diffLines(before: string[], after: string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => 0),
  );

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (before[i] === after[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (before[i] === after[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ kind: "removed", text: before[i] });
      i++;
    } else {
      lines.push({ kind: "added", text: after[j] });
      j++;
    }
  }
  while (i < n) lines.push({ kind: "removed", text: before[i++] });
  while (j < m) lines.push({ kind: "added", text: after[j++] });
  return lines;
}
