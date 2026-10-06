import { eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  buildChatMessages,
  buildEditMessages,
  DEFAULT_AI_MODEL,
  editPromptFromChat,
  openRouterContent,
  OPENROUTER_URL,
  parseChatPayload,
  parseRecipeSections,
  parseSuggestionPayload,
} from "@recipe-vault/core";
import type {
  ChatMessage,
  OpenRouterResponse,
  RecipeLists,
} from "@recipe-vault/core";

import { db, schema } from "../db/client";
import type { AppBindings, Env } from "../env";

/** The plugin's default wait. A Worker can hold a request this long. */
const TIMEOUT_MS = 45_000;
/** Plenty for a conversation about one recipe, and a cap on what we pay for. */
const MAX_MESSAGES = 40;
const MAX_MESSAGE_LENGTH = 4000;

/** A failure with the status to send and the words a person should see. */
class AiError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 502 | 503 | 504,
  ) {
    super(message);
  }
}

/** The conversation as the client sent it, or an error saying what's wrong. */
function readMessages(body: unknown): ChatMessage[] {
  const raw = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AiError("Nothing to send.", 400);
  }
  if (raw.length > MAX_MESSAGES) {
    throw new AiError("This conversation is too long. Start a new one.", 400);
  }
  return raw.map((item: unknown) => {
    const m = item as Partial<ChatMessage> | null;
    if (
      !m ||
      (m.role !== "user" && m.role !== "assistant") ||
      typeof m.content !== "string" ||
      !m.content.trim() ||
      m.content.length > MAX_MESSAGE_LENGTH
    ) {
      throw new AiError("That message couldn't be read.", 400);
    }
    return {
      role: m.role,
      content: m.content,
      offeredEdit: m.role === "assistant" && m.offeredEdit === true,
    };
  });
}

/**
 * The recipe's two lists, read from the row rather than taken from the
 * client, so the model sees what's actually saved.
 */
async function recipeLists(env: Env, id: string): Promise<RecipeLists> {
  const [row] = await db(env.DB)
    .select({
      markdown: schema.recipes.markdown,
      vaultKey: schema.recipes.vaultKey,
    })
    .from(schema.recipes)
    .where(eq(schema.recipes.id, id))
    .limit(1);
  if (!row) throw new AiError("No such recipe.", 404);

  // An edit comes back as replacement Ingredients and Instructions sections,
  // and a .cook file has neither.
  if (row.vaultKey?.toLowerCase().endsWith(".cook")) {
    throw new AiError("Ask AI works on markdown notes, not .cook files.", 400);
  }
  const sections = parseRecipeSections(row.markdown);
  if (
    !sections ||
    sections.recipeIngredient.length === 0 ||
    sections.recipeInstructions.length === 0
  ) {
    throw new AiError(
      "Ask AI needs an Ingredients and an Instructions section with something in them.",
      400,
    );
  }
  return {
    recipeIngredient: sections.recipeIngredient,
    recipeInstructions: sections.recipeInstructions,
  };
}

/** Post to OpenRouter and hand back the reply's text. */
async function complete(
  env: Env,
  body: Record<string, unknown>,
): Promise<string> {
  const key = env.OPENROUTER_API_KEY;
  if (!key) throw new AiError("Ask AI isn't set up on this server.", 503);

  let response: Response;
  try {
    // `self.fetch`, as in http.ts: the community scanner lints this repo as
    // plugin code, where a bare `fetch` is meant to be `requestUrl`.
    response = await self.fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL?.trim() || DEFAULT_AI_MODEL,
        ...body,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new AiError(
        "AI request timed out. Try again with a simpler prompt.",
        504,
      );
    }
    throw new AiError("Couldn't reach OpenRouter. Try again.", 502);
  }

  const payload = (await response.json().catch(() => undefined)) as
    | OpenRouterResponse
    | undefined;
  try {
    return openRouterContent(response.status, payload);
  } catch (err) {
    throw new AiError(err instanceof Error ? err.message : String(err), 502);
  }
}

/**
 * Ask AI on the web. The same two calls the plugin makes, with the same
 * prompts out of core: a chat turn, and the edit a chat turn offered. The
 * edit only comes back as a suggestion - the client shows the diff, and
 * applying it is an ordinary save, so a note that moved in the vault since
 * still gets a 409.
 */
export const aiRoutes = new Hono<AppBindings>()
  .get("/status", (c) => c.json({ enabled: !!c.env.OPENROUTER_API_KEY }))

  .post("/recipes/:id/chat", async (c) => {
    try {
      const messages = readMessages(await c.req.json().catch(() => null));
      const lists = await recipeLists(c.env, c.req.param("id"));
      const content = await complete(c.env, {
        messages: buildChatMessages({ ...lists, messages }),
        temperature: 0.7,
      });
      return c.json(parseChatPayload(content));
    } catch (err) {
      if (err instanceof AiError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  })

  .post("/recipes/:id/edit", async (c) => {
    try {
      const messages = readMessages(await c.req.json().catch(() => null));
      const lists = await recipeLists(c.env, c.req.param("id"));
      const content = await complete(c.env, {
        messages: buildEditMessages({
          ...lists,
          prompt: editPromptFromChat(messages),
        }),
        temperature: 0.3,
        response_format: { type: "json_object" },
      });
      let suggestion;
      try {
        suggestion = parseSuggestionPayload(content);
      } catch (err) {
        throw new AiError(err instanceof Error ? err.message : String(err), 502);
      }
      // What the suggestion was made against, so the diff the client shows
      // is against the same lists.
      return c.json({ suggestion, original: lists });
    } catch (err) {
      if (err instanceof AiError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  });
