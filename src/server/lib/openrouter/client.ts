import { env } from "~/env";
import { z } from "zod";
import {
  openRouterJsonResponseSchema,
  type OpenRouterMessage,
} from "../verification/types";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export class OpenRouterError extends Error {
  override name = "OpenRouterError";
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
  }
}

export type OpenRouterJsonCallInput<T> = {
  messages: OpenRouterMessage[];
  schema: z.ZodType<T>;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type OpenRouterJsonCallResult<T> = {
  model: string;
  rawText: string;
  parsed: T;
  requestId: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export function stripMarkdownFences(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;

  const firstNewline = trimmed.indexOf("\n");
  if (firstNewline === -1) return trimmed.replace(/^```[a-zA-Z]*\s*/, "").replace(/```$/, "");

  const withoutPrefix = trimmed.slice(firstNewline + 1);
  return withoutPrefix.replace(/```$/, "").trim();
}

export function extractJsonText(text: string) {
  const trimmed = stripMarkdownFences(text);
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return trimmed.slice(start, end + 1);
    }
    return trimmed;
  }
}

async function readResponseBody(response: Response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callOpenRouterJson<T>(
  input: OpenRouterJsonCallInput<T>,
): Promise<OpenRouterJsonCallResult<T>> {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new OpenRouterError("OPENROUTER_API_KEY is not configured");
  }

  const model = input.model ?? env.OPENROUTER_MODEL;
  const controller = new AbortController();
  const externalSignal = input.signal;
  const abortListener = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", abortListener, { once: true });
    }
  }
  const timeoutId =
    input.timeoutMs && input.timeoutMs > 0
      ? setTimeout(() => controller.abort(), input.timeoutMs)
      : null;
  const startedAt = Date.now();

  try {
    const requestBody = JSON.stringify({
      model,
      messages: input.messages,
      temperature: input.temperature ?? 0,
      max_tokens: input.maxOutputTokens ?? 512,
      response_format: { type: "json_object" },
    });

    let lastError: OpenRouterError | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_DELAY_MS * attempt);
      }

      const response = await fetch(OPENROUTER_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": env.OPENROUTER_REFERER ?? "http://localhost",
          "X-Title": "naming-things",
        },
        body: requestBody,
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      const bodyText = await readResponseBody(response);

      if (!response.ok) {
        lastError = new OpenRouterError(
          `OpenRouter request failed with status ${response.status}`,
          response.status,
          bodyText,
        );
        if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_RETRIES) {
          continue;
        }
        throw lastError;
      }

      const json = openRouterJsonResponseSchema.parse(JSON.parse(bodyText));
      const rawText = json.choices[0]?.message.content ?? "";
      const jsonText = extractJsonText(rawText);
      const parsedJson = JSON.parse(jsonText);
      const parsed = input.schema.parse(parsedJson);

      return {
        model: json.model ?? model,
        rawText,
        parsed,
        requestId: json.id ?? null,
        latencyMs,
        inputTokens: json.usage?.prompt_tokens ?? null,
        outputTokens: json.usage?.completion_tokens ?? null,
        totalTokens: json.usage?.total_tokens ?? null,
      };
    }

    throw lastError ?? new OpenRouterError("Retries exhausted");
  } catch (error) {
    if (error instanceof OpenRouterError) {
      throw error;
    }

    if (error instanceof SyntaxError) {
      throw new OpenRouterError(
        `Failed to parse OpenRouter response: ${error.message}`,
      );
    }

    if (error instanceof Error) {
      throw new OpenRouterError(error.message);
    }

    throw new OpenRouterError("Unknown OpenRouter error");
  } finally {
    if (externalSignal) {
      externalSignal.removeEventListener("abort", abortListener);
    }
    if (timeoutId) clearTimeout(timeoutId);
  }
}
