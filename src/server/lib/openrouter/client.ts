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

export type JsonSchemaSpec = {
  name: string;
  schema: Record<string, unknown>;
};

export type OpenRouterJsonCallInput<T> = {
  messages: OpenRouterMessage[];
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** When provided, uses strict json_schema mode instead of json_object mode. */
  jsonSchema?: JsonSchemaSpec;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type OpenRouterTool = {
  type: string;
  parameters?: Record<string, unknown>;
};

export type OpenRouterToolJsonCallInput<T> = OpenRouterJsonCallInput<T> & {
  tools: OpenRouterTool[];
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

export type OpenRouterToolJsonCallResult<T> = OpenRouterJsonCallResult<T> & {
  webSearchRequests: number | null;
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
  return response.text();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateForLog(text: string, maxLength = 2000) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}... [truncated ${text.length - maxLength} chars]`;
}

async function callOpenRouterJsonInternal<T>(
  input: OpenRouterJsonCallInput<T> & { tools?: OpenRouterTool[] },
): Promise<OpenRouterToolJsonCallResult<T>> {
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
  let lastResponseBody = "";
  let lastResponseJson: unknown = null;
  let lastRawText = "";
  let lastExtractedJsonText = "";
  let lastRequestId: string | null = null;

  function logResponseHandlingFailure(message: string) {
    console.error("OpenRouter response handling failed", {
      message,
      model,
      requestId: lastRequestId,
      responseBody: truncateForLog(lastResponseBody),
      responseJson:
        lastResponseJson == null
          ? null
          : truncateForLog(JSON.stringify(lastResponseJson)),
      rawText: truncateForLog(lastRawText),
      extractedJsonText: truncateForLog(lastExtractedJsonText),
    });
  }

  try {
    const responseFormat = input.jsonSchema
      ? {
          type: "json_schema" as const,
          json_schema: {
            name: input.jsonSchema.name,
            strict: true,
            schema: input.jsonSchema.schema,
          },
        }
      : { type: "json_object" as const };

    const requestPayload = {
      model,
      messages: input.messages,
      temperature: input.temperature ?? 0,
      max_tokens: input.maxOutputTokens ?? 512,
      response_format: responseFormat,
      ...(input.tools ? { tools: input.tools } : {}),
    };
    const requestBody = JSON.stringify(requestPayload);

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
      lastResponseBody = bodyText;
      lastResponseJson = null;
      lastRawText = "";
      lastExtractedJsonText = "";
      lastRequestId = null;

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

      const responseJson = JSON.parse(bodyText);
      lastResponseJson = responseJson;
      const json = openRouterJsonResponseSchema.parse(responseJson);
      lastRequestId = json.id ?? null;
      const rawText = json.choices[0]?.message.content ?? "";
      lastRawText = rawText;
      const jsonText = extractJsonText(rawText);
      lastExtractedJsonText = jsonText;
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
        webSearchRequests:
          json.usage?.server_tool_use?.web_search_requests ?? null,
      };
    }

    throw lastError ?? new OpenRouterError("Retries exhausted");
  } catch (error) {
    if (error instanceof OpenRouterError) {
      throw error;
    }

    if (error instanceof z.ZodError) {
      logResponseHandlingFailure(error.message);
      throw new OpenRouterError(
        `OpenRouter response schema validation failed: ${error.message}`,
      );
    }

    if (error instanceof SyntaxError) {
      logResponseHandlingFailure(error.message);
      throw new OpenRouterError(
        `Failed to parse OpenRouter response: ${error.message}`,
      );
    }

    if (error instanceof Error) {
      logResponseHandlingFailure(error.message);
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

export async function callOpenRouterJson<T>(
  input: OpenRouterJsonCallInput<T>,
): Promise<OpenRouterJsonCallResult<T>> {
  const result = await callOpenRouterJsonInternal(input);
  return {
    model: result.model,
    rawText: result.rawText,
    parsed: result.parsed,
    requestId: result.requestId,
    latencyMs: result.latencyMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens: result.totalTokens,
  };
}

export async function callOpenRouterJsonWithTools<T>(
  input: OpenRouterToolJsonCallInput<T>,
): Promise<OpenRouterToolJsonCallResult<T>> {
  return callOpenRouterJsonInternal(input);
}
