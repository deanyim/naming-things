import { z } from "zod";
import { eq } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { players } from "~/server/db/schema";

export const playerRouter = createTRPCRouter({
  ensureSession: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        displayName: z.string().min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.players.findFirst({
        where: eq(players.sessionToken, input.sessionToken),
      });

      if (existing) {
        // Update display name if changed
        if (existing.displayName !== input.displayName) {
          await ctx.db
            .update(players)
            .set({ displayName: input.displayName })
            .where(eq(players.id, existing.id));
        }
        return { ...existing, displayName: input.displayName };
      }

      const [newPlayer] = await ctx.db
        .insert(players)
        .values({
          sessionToken: input.sessionToken,
          displayName: input.displayName,
        })
        .returning();

      return newPlayer!;
    }),

  getBySession: publicProcedure
    .input(z.object({ sessionToken: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const player = await ctx.db.query.players.findFirst({
        where: eq(players.sessionToken, input.sessionToken),
      });
      return player ?? null;
    }),
});
