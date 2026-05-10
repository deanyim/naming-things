import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("~/env", () => ({
  env: {
    OPENROUTER_API_KEY: "test-key",
    OPENROUTER_MODEL: "test/model",
    OPENROUTER_REFERER: "http://localhost",
  },
}));

import { callOpenRouterJsonWithTools } from "./client";

describe("callOpenRouterJsonWithTools", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends tools and parses web search usage", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.tools).toEqual([
        {
          type: "openrouter:web_search",
          parameters: { engine: "auto" },
        },
      ]);

      return new Response(
        JSON.stringify({
          id: "req_123",
          model: "test/model",
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 2,
            total_tokens: 12,
            server_tool_use: {
              web_search_requests: 1,
            },
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callOpenRouterJsonWithTools({
      messages: [{ role: "user", content: "test" }],
      schema: z.object({ ok: z.boolean() }),
      tools: [
        {
          type: "openrouter:web_search",
          parameters: { engine: "auto" },
        },
      ],
    });

    expect(result.parsed.ok).toBe(true);
    expect(result.webSearchRequests).toBe(1);
  });
});
