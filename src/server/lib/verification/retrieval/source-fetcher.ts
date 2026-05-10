import { createHash } from "crypto";
import { z } from "zod";
import type { SourceSnapshot } from "../types";
import {
  addWikimediaReadParams,
  fetchWikimediaApi,
  wikimediaHeaders,
} from "./wikimedia-api";

export type SourceFetcher = {
  fetch(url: string): Promise<SourceSnapshot>;
};

const mediaWikiParseSchema = z.object({
  parse: z.object({
    title: z.string(),
    pageid: z.number().optional(),
    revid: z.number().optional(),
    displaytitle: z.string().optional(),
    text: z.union([
      z.string(),
      z.object({
        "*": z.string(),
      }),
    ]),
    sections: z
      .array(
        z.object({
          toclevel: z.number().optional(),
          level: z.string().optional(),
          line: z.string().optional(),
          number: z.string().optional(),
          index: z.string().optional(),
          anchor: z.string().optional(),
        }).passthrough(),
      )
      .optional(),
  }),
});

function hashContent(rawContent: string) {
  return createHash("sha256").update(rawContent).digest("hex");
}

function wikipediaApiInfo(sourceUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const match = host.match(/^([a-z0-9-]+)\.(?:m\.)?wikipedia\.org$/);
  if (!match) return null;

  let title = "";
  if (parsed.pathname.startsWith("/wiki/")) {
    title = parsed.pathname.slice("/wiki/".length);
  } else if (parsed.searchParams.get("title")) {
    title = parsed.searchParams.get("title") ?? "";
  }

  if (!title) return null;

  const language = match[1] ?? "en";
  const apiUrl = new URL(`https://${language}.wikipedia.org/w/api.php`);
  apiUrl.searchParams.set("action", "parse");
  apiUrl.searchParams.set("page", decodeURIComponent(title).replace(/_/g, " "));
  apiUrl.searchParams.set("prop", "text|sections|revid|displaytitle");
  apiUrl.searchParams.set("redirects", "1");
  addWikimediaReadParams(apiUrl);

  return {
    apiUrl,
    language,
    originalTitle: decodeURIComponent(title).replace(/_/g, " "),
  };
}

function canonicalWikipediaUrl(language: string, title: string) {
  return `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, "_"))}`;
}

export class FetchSourceFetcher implements SourceFetcher {
  async fetch(url: string): Promise<SourceSnapshot> {
    const wikipedia = wikipediaApiInfo(url);
    if (wikipedia) {
      return this.fetchWikipedia(wikipedia.apiUrl, url, wikipedia.language);
    }

    const response = await fetch(url, {
      headers: wikimediaHeaders(
        "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      ),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
    }

    const rawContent = await response.text();
    const contentType =
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
      "text/html";
    const contentHash = hashContent(rawContent);

    return {
      url,
      retrievedAt: new Date().toISOString(),
      contentHash,
      contentType,
      rawContent,
    };
  }

  private async fetchWikipedia(
    apiUrl: URL,
    sourceUrl: string,
    language: string,
  ): Promise<SourceSnapshot> {
    const response = await fetchWikimediaApi(apiUrl);

    if (!response?.ok) {
      throw new Error(
        `Failed to fetch MediaWiki API ${apiUrl}: HTTP ${response?.status ?? "unknown"}`,
      );
    }

    const json = mediaWikiParseSchema.parse(await response.json());
    const rawContent =
      typeof json.parse.text === "string"
        ? json.parse.text
        : json.parse.text["*"];
    const contentHash = hashContent(rawContent);
    const canonicalUrl = canonicalWikipediaUrl(language, json.parse.title);

    return {
      url: canonicalUrl,
      retrievedAt: new Date().toISOString(),
      contentHash,
      contentType: "application/vnd.mediawiki.parse+json",
      rawContent,
      normalizedContent: JSON.stringify({
        sourceUrl,
        apiUrl: apiUrl.toString(),
        title: json.parse.title,
        pageid: json.parse.pageid,
        revid: json.parse.revid,
        displaytitle: json.parse.displaytitle,
        sections: json.parse.sections ?? [],
      }),
      metadata: {
        provider: "mediawiki",
        sourceUrl,
        apiUrl: apiUrl.toString(),
        language,
        title: json.parse.title,
        pageid: json.parse.pageid,
        revid: json.parse.revid,
        displaytitle: json.parse.displaytitle,
        sections: json.parse.sections ?? [],
      },
    };
  }
}
