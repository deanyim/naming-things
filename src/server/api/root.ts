import { postRouter } from "~/server/api/routers/post";
import { playerRouter } from "~/server/api/routers/player";
import { gameRouter } from "~/server/api/routers/game";
import { soloRouter } from "~/server/api/routers/solo";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

export const appRouter = createTRPCRouter({
  post: postRouter,
  player: playerRouter,
  game: gameRouter,
  solo: soloRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
