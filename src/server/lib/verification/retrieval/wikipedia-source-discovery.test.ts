import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCategorySpec } from "./category-resolver";
import {
  discoverWikipediaSources,
  planWikipediaSourceQueries,
} from "./wikipedia-source-discovery";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("planWikipediaSourceQueries", () => {
  it("plans deterministic Wikipedia search queries", () => {
    const spec = resolveCategorySpec("Dune cast");

    expect(planWikipediaSourceQueries(spec)).toEqual([
      "dune cast",
      "dune cast list",
      "dune cast cast",
      "dune cast roster",
    ]);
  });
});

describe("discoverWikipediaSources", () => {
  it("ranks pages with extractable blocks above plain article matches", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const requested = new URL(url.toString());
      const action = requested.searchParams.get("action");
      expect(requested.searchParams.get("maxlag")).toBe("5");
      expect(new Headers(init?.headers).get("User-Agent")).toContain(
        "naming-things/0.1",
      );

      if (action === "query") {
        return new Response(
          JSON.stringify({
            query: {
              search: [
                {
                  ns: 0,
                  title: "Dune (2021 film)",
                  pageid: 1,
                  snippet: "Cast and production details.",
                },
                {
                  ns: 0,
                  title: "Dune",
                  pageid: 2,
                  snippet: "General article.",
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (action === "parse") {
        const page = requested.searchParams.get("page");
        const text =
          page === "Dune (2021 film)"
            ? `
              <h2 id="Cast">Cast</h2>
              <ul>
                <li><a href="/wiki/Timoth%C3%A9e_Chalamet">Timothée Chalamet</a> as Paul</li>
                <li><a href="/wiki/Rebecca_Ferguson">Rebecca Ferguson</a> as Jessica</li>
                <li><a href="/wiki/Oscar_Isaac">Oscar Isaac</a> as Leto</li>
              </ul>
            `
            : "<p>No usable cast list.</p>";

        return new Response(
          JSON.stringify({
            parse: {
              title: page,
              pageid: page === "Dune (2021 film)" ? 1 : 2,
              revid: 10,
              displaytitle: page,
              text: { "*": text },
              sections: [],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      throw new Error(`Unexpected URL ${requested}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await discoverWikipediaSources(resolveCategorySpec("Dune cast"), {
      maxResultsPerQuery: 2,
      maxCandidatesToEvaluate: 4,
    });

    expect(result.queryLog[0]).toBe("wikipedia:dune cast");
    expect(result.sources[0]).toMatchObject({
      url: "https://en.wikipedia.org/wiki/Dune_(2021_film)",
      title: "Dune (2021 film)",
      sourceType: "structured_database",
    });
    expect(result.sources[0]!.snippet).toContain("1 extractable block found");
    expect(result.recommendedUrl).toBe(
      "https://en.wikipedia.org/wiki/Dune_(2021_film)",
    );
  });

  it("searches and evaluates candidates in series", async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const fetchMock = vi.fn(async (url: string | URL) => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);

      const requested = new URL(url.toString());
      const action = requested.searchParams.get("action");
      await Promise.resolve();
      activeRequests -= 1;

      if (action === "query") {
        return new Response(
          JSON.stringify({
            query: {
              search: [
                {
                  ns: 0,
                  title: "Dune (2021 film)",
                  pageid: 1,
                  snippet: "Cast and production details.",
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          parse: {
            title: "Dune (2021 film)",
            pageid: 1,
            revid: 10,
            displaytitle: "Dune (2021 film)",
            text: { "*": "<h2>Cast</h2><ul><li>Timothée Chalamet as Paul</li></ul>" },
            sections: [],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await discoverWikipediaSources(resolveCategorySpec("Dune cast"), {
      maxResultsPerQuery: 1,
      maxCandidatesToEvaluate: 1,
    });

    expect(maxActiveRequests).toBe(1);
  });
});
