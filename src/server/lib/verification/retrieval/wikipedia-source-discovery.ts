import { z } from "zod";
import type { CategorySpec } from "../types";
import { inspectSourceTables } from "./extractor";
import { FetchSourceFetcher, type SourceFetcher } from "./source-fetcher";
import { addWikimediaReadParams, fetchWikimediaApi } from "./wikimedia-api";

const wikipediaSearchSchema = z.object({
  query: z.object({
    search: z.array(
      z.object({
        ns: z.number(),
        title: z.string(),
        pageid: z.number().optional(),
        snippet: z.string().optional(),
      }),
    ),
  }),
});

export type WikipediaSourceDiscoveryOptions = {
  language?: string;
  maxResultsPerQuery?: number;
  maxCandidatesToEvaluate?: number;
  fetcher?: SourceFetcher;
};

export type WikipediaSourceCandidate = {
  id: string;
  url: string;
  title: string;
  sourceType:
    | "official"
    | "primary"
    | "structured_database"
    | "reputable_secondary"
    | "community"
    | "unknown";
  publishedAt: string | null;
  retrievedAt: string;
  snippet: string;
};

export type WikipediaSourceDiscoveryResult = {
  sources: WikipediaSourceCandidate[];
  recommendedUrl: string | null;
  queryLog: string[];
  error?: string | null;
};

type EvaluatedWikipediaSourceCandidate = {
  candidate: WikipediaSourceCandidate;
  score: number;
  originalIndex: number;
};

function stripHtml(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalWikipediaUrl(language: string, title: string) {
  return `https://${language}.wikipedia.org/wiki/${encodeURIComponent(
    title.replace(/\s+/g, "_"),
  )}`;
}

export function planWikipediaSourceQueries(spec: CategorySpec) {
  const normalized = spec.normalizedCategory;
  const raw = spec.rawCategory.trim().toLowerCase().replace(/\s+/g, " ");
  const queries = [
    normalized,
    `${normalized} list`,
    `${normalized} cast`,
    `${normalized} roster`,
    raw,
  ];

  return Array.from(
    new Set(
      queries
        .map((query) => query.trim())
        .filter((query) => query.length > 0),
    ),
  );
}

function isUsableArticleTitle(title: string) {
  const normalized = title.toLowerCase();
  return (
    !normalized.endsWith("(disambiguation)") &&
    !normalized.startsWith("wikipedia:") &&
    !normalized.startsWith("help:") &&
    !normalized.startsWith("template:") &&
    !normalized.startsWith("category:") &&
    !normalized.startsWith("file:")
  );
}

async function searchWikipedia(
  query: string,
  language: string,
  maxResults: number,
) {
  const apiUrl = new URL(`https://${language}.wikipedia.org/w/api.php`);
  apiUrl.searchParams.set("action", "query");
  apiUrl.searchParams.set("list", "search");
  apiUrl.searchParams.set("srsearch", query);
  apiUrl.searchParams.set("srnamespace", "0");
  apiUrl.searchParams.set("srlimit", String(maxResults));
  addWikimediaReadParams(apiUrl);

  const response = await fetchWikimediaApi(apiUrl);

  if (!response?.ok) {
    throw new Error(
      `Failed to search Wikipedia: HTTP ${response?.status ?? "unknown"}`,
    );
  }

  const parsed = wikipediaSearchSchema.parse(await response.json());
  return parsed.query.search.filter(
    (result) => result.ns === 0 && isUsableArticleTitle(result.title),
  );
}

function titleMatchScore(title: string, spec: CategorySpec) {
  const titleText = title.toLowerCase();
  const words = spec.normalizedCategory
    .split(/\s+/)
    .filter((word) => word.length > 2);
  return words.reduce(
    (score, word) => score + (titleText.includes(word) ? 5 : 0),
    0,
  );
}

export async function discoverWikipediaSources(
  spec: CategorySpec,
  options: WikipediaSourceDiscoveryOptions = {},
): Promise<WikipediaSourceDiscoveryResult> {
  const language = options.language ?? "en";
  const maxResultsPerQuery = options.maxResultsPerQuery ?? 8;
  const maxCandidatesToEvaluate = options.maxCandidatesToEvaluate ?? 8;
  const fetcher = options.fetcher ?? new FetchSourceFetcher();
  const queryLog = planWikipediaSourceQueries(spec).map(
    (query) => `wikipedia:${query}`,
  );

  const searchResults: Awaited<ReturnType<typeof searchWikipedia>>[] = [];
  for (const entry of queryLog) {
    searchResults.push(
      await searchWikipedia(
        entry.replace(/^wikipedia:/, ""),
        language,
        maxResultsPerQuery,
      ),
    );
  }

  const seenTitles = new Set<string>();
  const candidates = searchResults
    .flat()
    .filter((result) => {
      const key = result.title.toLowerCase();
      if (seenTitles.has(key)) return false;
      seenTitles.add(key);
      return true;
    })
    .slice(0, maxCandidatesToEvaluate);

  const evaluated: EvaluatedWikipediaSourceCandidate[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const requestedUrl = canonicalWikipediaUrl(language, candidate.title);
    const retrievedAt = new Date().toISOString();
    try {
      const snapshot = await fetcher.fetch(requestedUrl);
      const blocks = inspectSourceTables(spec, snapshot);
      const bestBlockScore = Math.max(0, ...blocks.map((block) => block.score));
      evaluated.push({
        candidate: {
          id: `wikipedia-${index + 1}`,
          url: snapshot.url,
          title:
            typeof snapshot.metadata?.title === "string"
              ? snapshot.metadata.title
              : candidate.title,
          sourceType:
            blocks.length > 0
              ? ("structured_database" as const)
              : ("reputable_secondary" as const),
          publishedAt: null,
          retrievedAt: snapshot.retrievedAt,
          snippet:
            blocks.length > 0
              ? `${blocks.length} extractable block${
                  blocks.length === 1 ? "" : "s"
                } found. ${stripHtml(candidate.snippet ?? "")}`.trim()
              : stripHtml(candidate.snippet ?? ""),
        },
        score:
          bestBlockScore +
          blocks.length * 10 +
          titleMatchScore(candidate.title, spec),
        originalIndex: index,
      });
    } catch (err) {
      evaluated.push({
        candidate: {
          id: `wikipedia-${index + 1}`,
          url: requestedUrl,
          title: candidate.title,
          sourceType: "unknown" as const,
          publishedAt: null,
          retrievedAt,
          snippet: `Could not evaluate page: ${
            err instanceof Error ? err.message : "Unknown error"
          }`,
        },
        score: titleMatchScore(candidate.title, spec) - 100,
        originalIndex: index,
      });
    }
  }

  const sources = evaluated
    .sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex)
    .map(({ candidate }, index) => ({
      ...candidate,
      id: candidate.id || `wikipedia-${index + 1}`,
    }));

  return {
    sources,
    recommendedUrl: sources[0]?.url ?? null,
    queryLog,
  };
}
