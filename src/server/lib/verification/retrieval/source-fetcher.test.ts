import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchSourceFetcher } from "./source-fetcher";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("FetchSourceFetcher", () => {
  it("uses the MediaWiki API for Wikipedia article URLs", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const requested = new URL(url.toString());
      expect(requested.hostname).toBe("en.wikipedia.org");
      expect(requested.pathname).toBe("/w/api.php");
      expect(requested.searchParams.get("action")).toBe("parse");
      expect(requested.searchParams.get("redirects")).toBe("1");
      expect(requested.searchParams.get("maxlag")).toBe("5");
      expect(requested.searchParams.get("page")).toBe(
        "List of Survivor (American TV series) contestants",
      );
      expect(new Headers(init?.headers).get("User-Agent")).toContain(
        "naming-things/0.1",
      );
      expect(new Headers(init?.headers).get("Api-User-Agent")).toContain(
        "naming-things/0.1",
      );

      return new Response(
        JSON.stringify({
          parse: {
            title: "List of Survivor (American TV series) contestants",
            pageid: 123,
            revid: 456,
            displaytitle: "List of Survivor contestants",
            text: { "*": "<table><tr><th>Name</th></tr></table>" },
            sections: [{ index: "1", line: "Contestants" }],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const snapshot = await new FetchSourceFetcher().fetch(
      "https://en.wikipedia.org/wiki/List_of_Survivor_(American_TV_series)_contestants",
    );

    expect(snapshot.contentType).toBe("application/vnd.mediawiki.parse+json");
    expect(snapshot.rawContent).toContain("<table>");
    expect(snapshot.url).toBe(
      "https://en.wikipedia.org/wiki/List_of_Survivor_(American_TV_series)_contestants",
    );
    expect(snapshot.metadata).toMatchObject({
      provider: "mediawiki",
      pageid: 123,
      revid: 456,
    });
  });

  it("falls back to generic fetch for non-Wikipedia URLs", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("<html>ok</html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const snapshot = await new FetchSourceFetcher().fetch(
      "https://example.com/source",
    );

    expect(snapshot.contentType).toBe("text/html");
    expect(snapshot.rawContent).toBe("<html>ok</html>");
    expect(snapshot.metadata).toBeUndefined();
  });
});
