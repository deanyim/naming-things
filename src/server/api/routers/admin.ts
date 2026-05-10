import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { categoryEvidencePackets } from "~/server/db/schema";
import { resolveCategorySpec } from "~/server/lib/verification/retrieval/category-resolver";
import {
  createCategoryEvidencePacket,
  getExistingCategoryEvidencePacket,
  mergeEvidenceFacts,
} from "~/server/lib/verification/retrieval/packets";
import { discoverWikipediaSources } from "~/server/lib/verification/retrieval/wikipedia-source-discovery";
import { FetchSourceFetcher } from "~/server/lib/verification/retrieval/source-fetcher";
import { inspectSourceTables } from "~/server/lib/verification/retrieval/extractor";
import type { EvidenceFact } from "~/server/lib/verification/types";

function dedupeSources<
  T extends {
    url: string;
    id: string;
  },
>(sources: T[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.url.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const adminRouter = createTRPCRouter({
  resolveEvidenceCategory: publicProcedure
    .input(z.object({ category: z.string().min(1).max(256) }))
    .query(({ input }) => {
      const spec = resolveCategorySpec(input.category);
      return {
        spec,
        buildable: spec.buildable,
      };
    }),

  discoverEvidenceSources: publicProcedure
    .input(z.object({ category: z.string().min(1).max(256) }))
    .mutation(async ({ input }) => {
      const spec = resolveCategorySpec(input.category);

      if (!spec.buildable) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            spec.notBuildableReason ??
            "This category is not buildable as a canonical dataset.",
        });
      }

      const knownSources =
        spec.knownSourceUrls?.map((url, index) => ({
          id: `known-${index + 1}`,
          url,
          title: url,
          sourceType: "structured_database" as const,
          publishedAt: null,
          retrievedAt: new Date().toISOString(),
          snippet: "Known source mapping.",
        })) ?? [];

      const result = await discoverWikipediaSources(spec, {
        maxResultsPerQuery: 8,
        maxCandidatesToEvaluate: 8,
      });
      const sources = dedupeSources([...knownSources, ...result.sources]).map(
        (source, index) => ({
          ...source,
          id: source.id || `source-${index + 1}`,
        }),
      );

      return {
        spec,
        ...result,
        recommendedUrl: knownSources[0]?.url ?? result.recommendedUrl,
        queryLog: [
          ...knownSources.map((source) => `known:${source.url}`),
          ...result.queryLog,
        ],
        sources,
      };
    }),

  buildEvidenceDataset: publicProcedure
    .input(
      z.object({
        category: z.string().min(1).max(256),
        sourceUrl: z.string().url().optional(),
        sourceUrls: z.array(z.string().url()).optional(),
        includeBlockIds: z.array(z.string()).optional(),
        excludeBlockIds: z.array(z.string()).optional(),
        forceRefresh: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.forceRefresh) {
        const existing = await getExistingCategoryEvidencePacket(
          ctx.db,
          input.category,
        );
        if (existing?.status === "ready") return existing;
      }

      const packet = await createCategoryEvidencePacket(ctx.db, input.category, {
        sourceUrl: input.sourceUrl,
        sourceUrls: input.sourceUrls,
        includeBlockIds: input.includeBlockIds,
        excludeBlockIds: input.excludeBlockIds,
        model: "wikipedia-mediawiki",
      });

      if (!packet) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This category is not buildable as a canonical dataset.",
        });
      }

      return packet;
    }),

  previewSourceTables: publicProcedure
    .input(
      z.object({
        category: z.string().min(1).max(256),
        sourceUrl: z.string().url().optional(),
        sourceUrls: z.array(z.string().url()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const spec = resolveCategorySpec(input.category);
      const fetcher = new FetchSourceFetcher();
      const urls = input.sourceUrls?.length
        ? input.sourceUrls
        : input.sourceUrl
          ? [input.sourceUrl]
          : [];

      if (urls.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "At least one source URL is required.",
        });
      }

      const sources = await Promise.all(
        urls.slice(0, 5).map(async (url) => {
          try {
            const snapshot = await fetcher.fetch(url);
            return {
              source: {
                url: snapshot.url,
                retrievedAt: snapshot.retrievedAt,
                contentHash: snapshot.contentHash,
                contentType: snapshot.contentType,
              },
              tables: inspectSourceTables(spec, snapshot).map((table) => ({
                ...table,
                selectionId: `${snapshot.url}#${table.blockId}`,
                sourceUrl: snapshot.url,
              })),
              error: null,
            };
          } catch (err) {
            return {
              source: {
                url,
                retrievedAt: new Date().toISOString(),
                contentHash: "",
                contentType: "unknown",
              },
              tables: [],
              error: err instanceof Error ? err.message : "Unknown error",
            };
          }
        }),
      );

      return {
        spec,
        sources,
        tables: sources.flatMap((source) => source.tables),
      };
    }),

  listEvidencePackets: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(25) }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(categoryEvidencePackets)
        .orderBy(desc(categoryEvidencePackets.createdAt))
        .limit(input.limit);
    }),

  getLatestEvidenceForCategory: publicProcedure
    .input(z.object({ category: z.string().min(1).max(256) }))
    .query(async ({ ctx, input }) => {
      return getExistingCategoryEvidencePacket(ctx.db, input.category, {
        includeStale: true,
      });
    }),

  getEvidencePacket: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const packet = await ctx.db.query.categoryEvidencePackets.findFirst({
        where: eq(categoryEvidencePackets.id, input.id),
      });
      if (!packet) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Evidence packet not found",
        });
      }
      return packet;
    }),

  mergeEvidenceFacts: publicProcedure
    .input(
      z.object({
        id: z.string().min(1),
        factIndexes: z.array(z.number().int().min(0)).min(2),
        primaryFactIndex: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const packet = await ctx.db.query.categoryEvidencePackets.findFirst({
        where: eq(categoryEvidencePackets.id, input.id),
      });
      if (!packet) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Evidence packet not found",
        });
      }

      let merged;
      try {
        merged = mergeEvidenceFacts(
          packet.facts as EvidenceFact[],
          input.factIndexes,
          input.primaryFactIndex,
        );
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Could not merge facts.",
        });
      }

      const queryLog = [
        ...packet.queryLog,
        `manual_merge:${merged.mergedFact.canonicalAnswer}<=${input.factIndexes.join(",")}`,
      ];

      const [updated] = await ctx.db
        .update(categoryEvidencePackets)
        .set({
          facts: merged.facts,
          queryLog,
        })
        .where(eq(categoryEvidencePackets.id, input.id))
        .returning();

      return updated ?? {
        ...packet,
        facts: merged.facts,
        queryLog,
      };
    }),
});
